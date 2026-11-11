#!/usr/bin/env node
/**
 * Holiday Promoted Listings rates (Nov 10 – Dec 15, 2026), then back to the 8% baseline.
 *
 *   node scripts/supabase/ebay-holiday-ad-rates.mjs                  dry run
 *   node scripts/supabase/ebay-holiday-ad-rates.mjs --apply          raise to holiday rates
 *   node scripts/supabase/ebay-holiday-ad-rates.mjs --revert --apply  every listing back to BASE_RATE
 *
 * Hats get the highest rate (peak season, most search traffic). KK-0017 stays at 10% because its
 * $13.99 price-test margin is thin. Listings with no stock are skipped.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { connectPgClient } from "./dbConnect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const env = process.env;
const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

const BASE_RATE = 8;
const HOLIDAY_RATES = {
  "KK-0001": 12, "KK-0016": 12, "KK-0022": 12, "KK-0035": 12, "KK-0070": 12,
  "KK-0017": 10,
  KK_0066: 10, "KK-0008": 10, "KK-0013": 10, "KK-0023": 10, "KK-0059": 10,
  "KK-0071": 10, "KK-0072": 10, "KK-0073": 10,
};

const db = await connectPgClient();
const { rows: products } = await db.query(`
  SELECT p.code, p.ebay_listing_id,
    (SELECT COALESCE(sum(stock), 0) FROM product_variants v WHERE v.product_id = p.id AND COALESCE(v.is_active, true)) AS stock
  FROM products p
  WHERE p.ebay_status = 'active' AND p.ebay_listing_id IS NOT NULL AND NOT COALESCE(p.ebay_do_not_list, false)
  ORDER BY p.code`);
const { rows: [admin] } = await db.query(`
  SELECT email FROM auth.users
  WHERE COALESCE((raw_app_meta_data->>'is_admin')::boolean, false) = true
  ORDER BY created_at LIMIT 1`);
await db.end();

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: link } = await sb.auth.admin.generateLink({ type: "magiclink", email: admin.email });
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: session } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = session.session.access_token;

async function ads(body) {
  const r = await fetch(`${env.SUPABASE_URL}/functions/v1/ebay-manage-ads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && data.success !== false, data };
}

for (const p of products) {
  const target = REVERT ? BASE_RATE : HOLIDAY_RATES[p.code];
  if (!target) continue;
  if (!REVERT && Number(p.stock) <= 0) {
    console.log(`${p.code}: no stock, skipped`);
    continue;
  }
  const cur = await ads({ action: "get_listing_ad", listingId: p.ebay_listing_id, productCode: p.code });
  const now = cur.data?.promoted ? Number(cur.data.bidPercentage) : null;
  if (now === target) {
    console.log(`${p.code}: already ${target}%`);
    continue;
  }
  if (!APPLY) {
    console.log(`${p.code}: ${now ?? "none"}% -> ${target}% (dry run)`);
    continue;
  }
  const r = await ads({ action: "set_listing_ad", listingId: p.ebay_listing_id, productCode: p.code, bidPercentage: target });
  console.log(`${p.code}: ${now ?? "none"}% -> ${target}% ${r.ok ? "ok" : `FAILED ${JSON.stringify(r.data).slice(0, 300)}`}`);
}
if (!APPLY) console.log("\nDry run. Re-run with --apply.");
