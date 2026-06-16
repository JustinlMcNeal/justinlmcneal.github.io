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
const props = schema.properties || {};

console.log("=== KEYCHAIN top-level required ===");
console.log(schema.required || []);

for (const key of [
  "externally_assigned_product_identifier",
  "supplier_declared_has_product_identifier_exemption",
  "gtin_exemption_reason",
  "merchant_suggested_asin",
]) {
  if (!props[key]) {
    console.log("\nNO property:", key);
    continue;
  }
  console.log(`\n=== ${key} ===`);
  console.log(JSON.stringify(props[key], null, 2).slice(0, 3000));
}

function walk(obj, path = "") {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj.then?.required)) {
    console.log("conditional required at", path, ":", obj.then.required);
  }
  for (const branch of ["allOf", "anyOf"]) {
    if (Array.isArray(obj[branch])) {
      obj[branch].forEach((entry, index) => walk(entry, `${path}/${branch}[${index}]`));
    }
  }
  if (obj.if) walk(obj.if, `${path}/if`);
  if (obj.then) walk(obj.then, `${path}/then`);
}

console.log("\n=== conditional rules (product id related) ===");
walk(schema);

const draft = await client.query(`
  SELECT draft_payload, last_submission_response
  FROM amazon_listing_drafts
  WHERE kk_sku ILIKE '%0066%'
  ORDER BY updated_at DESC
  LIMIT 1
`);
if (draft.rows[0]) {
  const sent = draft.rows[0].last_submission_response?.requestBody?.attributes || {};
  console.log("\n=== KK_0066 sent attrs (id related) ===");
  for (const key of Object.keys(sent).sort()) {
    if (/identifier|exemption|gtin|upc|ean|asin/i.test(key)) {
      console.log(key, JSON.stringify(sent[key]));
    }
  }
  console.log(
    "exemption in draft?",
    draft.rows[0].draft_payload?.supplier_declared_has_product_identifier_exemption,
  );
}

const keychains = await client.query(`
  SELECT seller_sku, asin, raw_listing->'attributes' AS attrs
  FROM amazon_listings
  WHERE product_type='KEYCHAIN'
  LIMIT 5
`);
for (const row of keychains.rows) {
  console.log("\n=== synced KEYCHAIN", row.seller_sku, row.asin, "===");
  const attrs = row.attrs || {};
  for (const key of [
    "externally_assigned_product_identifier",
    "supplier_declared_has_product_identifier_exemption",
  ]) {
    if (attrs[key]) console.log(key, JSON.stringify(attrs[key]));
  }
}

await client.end();
