#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const cache = await client.query(`
  SELECT schema_url FROM amazon_product_type_cache
  WHERE product_type='KEYCHAIN' AND marketplace_id='ATVPDKIKX0DER' LIMIT 1
`);
const schema = await (await fetch(cache.rows[0].schema_url)).json();

console.log("=== allOf[3] (externally_assigned_product_identifier rule) ===");
console.log(JSON.stringify(schema.allOf?.[3], null, 2));

const draft = await client.query(`
  SELECT last_submission_response
  FROM amazon_listing_drafts
  WHERE kk_sku ILIKE '%0066%'
  ORDER BY updated_at DESC
  LIMIT 1
`);
const resp = draft.rows[0]?.last_submission_response || {};
const sent = resp.requestBody?.attributes || {};
const sentKeys = new Set(Object.keys(sent));
console.log("\n=== KK_0066 submission status ===", resp.submissionStatus);
console.log("\n=== KK_0066 Amazon issues ===");
console.log(JSON.stringify(resp.issues?.slice?.(0, 15), null, 2));

const working = await client.query(`
  SELECT seller_sku, asin, raw_listing->'attributes' AS attrs
  FROM amazon_listings
  WHERE product_type='KEYCHAIN' AND asin IS NOT NULL
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1
`);
const wAttrs = working.rows[0]?.attrs || {};
const wKeys = new Set(Object.keys(wAttrs));
console.log("\n=== Working KEYCHAIN", working.rows[0]?.seller_sku, working.rows[0]?.asin, "===");
console.log("keys:", [...wKeys].sort().join(", "));

const compare = [
  "item_type_keyword",
  "department",
  "import_designation",
  "size",
  "special_feature",
  "closure",
  "material",
  "style",
  "included_components",
  "item_package_dimensions",
  "item_package_weight",
  "main_product_image_locator",
  "model_number",
  "part_number",
  "supplier_declared_has_product_identifier_exemption",
  "externally_assigned_product_identifier",
  "package_level",
];
console.log("\n=== field compare (KK_0066 sent vs working listing) ===");
for (const key of compare) {
  const a = sent[key];
  const b = wAttrs[key];
  if (!a && !b) continue;
  console.log(`\n${key}:`);
  if (a) console.log("  sent:", JSON.stringify(a));
  if (b) console.log("  work:", JSON.stringify(b));
}

await client.end();
