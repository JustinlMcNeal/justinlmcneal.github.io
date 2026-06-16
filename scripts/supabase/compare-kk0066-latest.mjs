#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const draft = await client.query(`
  SELECT id, draft_payload, last_submission_response, draft_status, submission_status
  FROM amazon_listing_drafts
  WHERE kk_sku ILIKE '%0066%'
  ORDER BY updated_at DESC LIMIT 1
`);
const row = draft.rows[0];
const sent = row?.last_submission_response?.requestBody?.attributes || {};
const sentKeys = new Set(Object.keys(sent));

const working = await client.query(`
  SELECT seller_sku, asin, raw_listing->'attributes' AS attrs
  FROM amazon_listings
  WHERE product_type='KEYCHAIN' AND asin IS NOT NULL
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 3
`);

console.log("KK_0066 status:", row?.draft_status, row?.submission_status);
console.log("sent keys:", [...sentKeys].sort().join(", "));

for (const w of working.rows) {
  const wAttrs = w.attrs || {};
  const wKeys = new Set(Object.keys(wAttrs));
  const onlyWork = [...wKeys].filter((k) => !sentKeys.has(k));
  const onlySent = [...sentKeys].filter((k) => !wKeys.has(k));
  console.log(`\n=== ${w.seller_sku} asin=${w.asin} brand=${wAttrs.brand?.[0]?.value} ===`);
  console.log("only on working:", onlyWork.sort().join(", ") || "(none)");
  console.log("only on KK_0066:", onlySent.sort().join(", ") || "(none)");
}

const compareKeys = [
  "supplier_declared_has_product_identifier_exemption",
  "externally_assigned_product_identifier",
  "included_components",
  "material",
  "item_weight",
  "item_package_dimensions",
  "item_package_weight",
  "item_shape",
  "number_of_pieces",
  "department",
  "size",
  "style",
  "brand",
  "merchant_suggested_asin",
  "package_level",
  "main_product_image_locator",
];

console.log("\n=== detailed compare (KK_0066 vs newest working) ===");
const wAttrs = working.rows[0]?.attrs || {};
for (const key of compareKeys) {
  const a = sent[key];
  const b = wAttrs[key];
  if (!a && !b) continue;
  console.log(`\n${key}:`);
  if (a) console.log("  sent:", JSON.stringify(a));
  if (b) console.log("  work:", JSON.stringify(b));
}

const issues = row?.last_submission_response?.response?.issues || [];
console.log("\n=== amazon issues ===");
for (const issue of issues) {
  console.log(issue.severity, issue.code, issue.attributeNames, issue.message?.slice(0, 160));
}

await client.end();
