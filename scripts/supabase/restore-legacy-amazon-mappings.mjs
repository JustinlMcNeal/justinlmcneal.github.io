/**
 * Restore Amazon listings stuck in `legacy` mapping after a mistaken hide-all bug.
 *
 * Usage:
 *   node scripts/supabase/restore-legacy-amazon-mappings.mjs --asin B0XXXXXXX
 *   node scripts/supabase/restore-legacy-amazon-mappings.mjs --sku YOGURT-PINK
 *   node scripts/supabase/restore-legacy-amazon-mappings.mjs --listing-id <uuid>
 *
 * Re-promotes the latest legacy row per listing back to `mapped`.
 * Does not touch listings marked `ignored`.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const envPath = resolve(process.cwd(), ".env");
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional .env
  }
}

loadEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
function arg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? String(args[idx + 1] || "").trim() : "";
}

const asin = arg("--asin");
const sku = arg("--sku");
const listingId = arg("--listing-id");

if (!asin && !sku && !listingId) {
  console.error("Pass --asin, --sku, or --listing-id");
  process.exit(1);
}

const sb = createClient(url, key);

let listingQuery = sb.from("amazon_listings").select("id, seller_sku, asin, amazon_title");
if (listingId) listingQuery = listingQuery.eq("id", listingId);
else if (asin) listingQuery = listingQuery.eq("asin", asin);
else listingQuery = listingQuery.eq("seller_sku", sku);

const { data: listings, error: listingErr } = await listingQuery;
if (listingErr) {
  console.error("Listing lookup failed:", listingErr.message);
  process.exit(1);
}

if (!listings?.length) {
  console.log("No listings matched.");
  process.exit(0);
}

for (const listing of listings) {
  const id = listing.id;

  const { data: ignored } = await sb
    .from("amazon_listing_mappings")
    .select("id")
    .eq("amazon_listing_id", id)
    .eq("mapping_status", "ignored")
    .limit(1);

  if (ignored?.length) {
    console.log(`Skip ${listing.seller_sku} (${id}) — marked ignored`);
    continue;
  }

  const { data: legacyRows, error: legacyErr } = await sb
    .from("amazon_listing_mappings")
    .select("id, kk_product_id, kk_sku, mapped_at, created_at")
    .eq("amazon_listing_id", id)
    .eq("mapping_status", "legacy")
    .order("mapped_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (legacyErr) {
    console.error(`Legacy lookup failed for ${id}:`, legacyErr.message);
    continue;
  }

  const row = legacyRows?.[0];
  if (!row?.id) {
    console.log(`No legacy mapping to restore for ${listing.seller_sku} (${id})`);
    continue;
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await sb
    .from("amazon_listing_mappings")
    .update({ mapping_status: "mapped", updated_at: now })
    .eq("id", row.id);

  if (updateErr) {
    console.error(`Restore failed for ${listing.seller_sku}:`, updateErr.message);
    continue;
  }

  console.log(
    `Restored mapped: ${listing.seller_sku} ASIN=${listing.asin} title="${listing.amazon_title}" mapping=${row.id}`,
  );
}
