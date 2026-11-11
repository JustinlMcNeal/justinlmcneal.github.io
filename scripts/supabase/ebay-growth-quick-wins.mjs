#!/usr/bin/env node
/**
 * eBay quick wins from docs/ops/ebay-growth-plan.md.
 *
 *   node scripts/supabase/ebay-growth-quick-wins.mjs                 status / dry run
 *   node scripts/supabase/ebay-growth-quick-wins.mjs --apply --ads       promote every active listing at AD_RATE
 *   node scripts/supabase/ebay-growth-quick-wins.mjs --apply --handling  1-day handling on the shipping policies
 *   node scripts/supabase/ebay-growth-quick-wins.mjs --apply --price     KK-0017 Cat Ear Beanie price test
 *   node scripts/supabase/ebay-growth-quick-wins.mjs --apply --discount  "buy 2+ save 10%" on non-beanie listings
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
const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");

const AD_RATE = 8;
const HANDLING_DAYS = 1;
const HANDLING_POLICY_IDS = ["266551432012", "272807475012"];
const PRICE_TEST = { code: "KK-0017", priceCents: 1399 };
const BEANIE_CODES = new Set(["KK-0001", "KK-0016", "KK-0017", "KK-0022", "KK-0035"]);
const MIX_DISCOUNT = {
  name: "Mix & match - buy 2+ save 10%",
  description: "Buy 2+ accessories, save 10%",
  minQuantity: 2,
  percentOff: 10,
};
const MKTG_API = "https://api.ebay.com/sell/marketing/v1";
const ACCOUNT_API = "https://api.ebay.com/sell/account/v1";

const db = await connectPgClient();
const { rows: products } = await db.query(`
  SELECT id, code, name, ebay_listing_id, ebay_price_cents, ebay_item_group_key
  FROM products WHERE ebay_status = 'active' AND ebay_listing_id IS NOT NULL ORDER BY code`);

const { rows: [admin] } = await db.query(`
  SELECT email FROM auth.users
  WHERE COALESCE((raw_app_meta_data->>'is_admin')::boolean, false) = true
  ORDER BY created_at LIMIT 1`);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: link } = await sb.auth.admin.generateLink({ type: "magiclink", email: admin.email });
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: session } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
const jwt = session.session.access_token;

async function fn(name, body) {
  const r = await fetch(`${env.SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && data.success !== false, status: r.status, data };
}

await fn("ebay-refresh-token", {});
const { rows: [tok] } = await db.query(`SELECT access_token FROM marketplace_tokens WHERE platform='ebay'`);
async function ebay(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data, location: r.headers.get("Location") };
}

if (args.has("--ads") || !APPLY) {
  console.log(`\n== Promoted Listings → ${AD_RATE}% ==`);
  for (const p of products) {
    const cur = await fn("ebay-manage-ads", { action: "get_listing_ad", listingId: p.ebay_listing_id, productCode: p.code });
    const now = cur.data?.promoted ? `${cur.data.bidPercentage}%` : "none";
    if (cur.data?.promoted && Number(cur.data.bidPercentage) >= AD_RATE) {
      console.log(`${p.code}: already ${now}`);
      continue;
    }
    if (!APPLY || !args.has("--ads")) {
      console.log(`${p.code}: ${now} → ${AD_RATE}% (dry run)`);
      continue;
    }
    const r = await fn("ebay-manage-ads", { action: "set_listing_ad", listingId: p.ebay_listing_id, productCode: p.code, bidPercentage: AD_RATE });
    console.log(`${p.code}: ${now} → ${AD_RATE}% ${r.ok ? "ok" : `FAILED ${JSON.stringify(r.data).slice(0, 300)}`}`);
  }
}

if (args.has("--handling") || !APPLY) {
  console.log(`\n== Handling time → ${HANDLING_DAYS} day ==`);
  for (const id of HANDLING_POLICY_IDS) {
    const cur = await ebay("GET", `${ACCOUNT_API}/fulfillment_policy/${id}`);
    if (!cur.ok) throw new Error(`GET policy ${id} failed: ${JSON.stringify(cur.data)}`);
    const policy = cur.data;
    console.log(`${id} "${policy.name}": handling ${policy.handlingTime?.value} ${policy.handlingTime?.unit}`);
    if (Number(policy.handlingTime?.value) === HANDLING_DAYS || !APPLY || !args.has("--handling")) continue;
    const { fulfillmentPolicyId, warnings, ...body } = policy;
    body.handlingTime = { value: HANDLING_DAYS, unit: "DAY" };
    const r = await ebay("PUT", `${ACCOUNT_API}/fulfillment_policy/${id}`, body);
    console.log(`  → ${r.ok ? "ok" : `FAILED ${JSON.stringify(r.data).slice(0, 500)}`}`);
  }
}

if (args.has("--price") || !APPLY) {
  console.log(`\n== ${PRICE_TEST.code} price → $${(PRICE_TEST.priceCents / 100).toFixed(2)} ==`);
  const p = products.find((x) => x.code === PRICE_TEST.code);
  const { rows: offers } = await db.query(
    `SELECT ebay_sku, raw_payload_json->>'offerId' AS offer_id FROM ebay_listing_inventory_cache WHERE product_id = $1`,
    [p.id]
  );
  for (const o of offers) {
    if (!APPLY || !args.has("--price")) {
      console.log(`${o.ebay_sku} offer ${o.offer_id}: $${(p.ebay_price_cents / 100).toFixed(2)} → $${(PRICE_TEST.priceCents / 100).toFixed(2)} (dry run)`);
      continue;
    }
    const r = await fn("ebay-manage-listing", { action: "update_offer", offerId: o.offer_id, sku: o.ebay_sku, priceCents: PRICE_TEST.priceCents });
    console.log(`${o.ebay_sku}: ${r.ok ? "ok" : `FAILED ${JSON.stringify(r.data).slice(0, 300)}`}`);
  }
  if (APPLY && args.has("--price")) {
    await db.query(`UPDATE products SET ebay_price_cents = $2, updated_at = now() WHERE id = $1`, [p.id, PRICE_TEST.priceCents]);
  }
}

if (args.has("--discount") || !APPLY) {
  console.log(`\n== Order discount "${MIX_DISCOUNT.name}" ==`);
  const existing = [];
  for (const status of ["RUNNING", "SCHEDULED", "PAUSED"]) {
    const r = await ebay("GET", `${MKTG_API}/promotion?marketplace_id=EBAY_US&promotion_status=${status}&limit=100`);
    existing.push(...(r.data?.promotions || []));
  }
  const covered = new Set();
  for (const p of existing.filter((x) => x.promotionType === "ORDER_DISCOUNT")) {
    const detail = await ebay("GET", `${MKTG_API}/item_promotion/${p.promotionId}`);
    const ids = detail.data?.inventoryCriterion?.listingIds || [];
    ids.forEach((id) => covered.add(id));
    const codes = products.filter((x) => ids.includes(x.ebay_listing_id)).map((x) => x.code);
    console.log(`  existing: ${p.promotionStatus} "${p.name}" → ${codes.join(", ") || ids.length + " listings"}`);
  }
  const targets = products.filter((p) => !BEANIE_CODES.has(p.code) && !covered.has(p.ebay_listing_id));
  console.log(`  listings: ${targets.map((p) => p.code).join(", ")}`);
  if (existing.some((p) => p.name === MIX_DISCOUNT.name)) {
    console.log("  already exists, skipping");
  } else if (APPLY && args.has("--discount")) {
    const image = await fn("ebay-manage-listing", { action: "get_item", sku: "KK-0013" });
    const promotionImageUrl = image.data?.item?.product?.imageUrls?.[0] || image.data?.product?.imageUrls?.[0];
    const now = Date.now();
    const promo = {
      name: MIX_DISCOUNT.name,
      description: MIX_DISCOUNT.description,
      marketplaceId: "EBAY_US",
      promotionStatus: "SCHEDULED",
      promotionType: "ORDER_DISCOUNT",
      ...(promotionImageUrl ? { promotionImageUrl } : {}),
      startDate: new Date(now + 60_000).toISOString(),
      endDate: new Date(now + 365 * 86400000).toISOString(),
      discountRules: [{
        ruleOrder: 1,
        discountSpecification: { minQuantity: MIX_DISCOUNT.minQuantity },
        discountBenefit: { percentageOffOrder: String(MIX_DISCOUNT.percentOff) },
      }],
      inventoryCriterion: { inventoryCriterionType: "INVENTORY_BY_VALUE", listingIds: targets.map((p) => p.ebay_listing_id) },
    };
    const r = await ebay("POST", `${MKTG_API}/item_promotion`, promo);
    console.log(`  → ${r.ok ? `created ${r.data?.promotionId || r.location?.split("/").pop()}` : `FAILED ${JSON.stringify(r.data).slice(0, 500)}`}`);
  }
}

await db.end();
