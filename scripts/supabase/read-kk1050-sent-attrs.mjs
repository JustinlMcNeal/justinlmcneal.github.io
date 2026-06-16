#!/usr/bin/env node
import pg from "pg";
const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(`
  SELECT last_submission_response->'requestBody'->'attributes' AS attrs
  FROM amazon_listing_drafts WHERE kk_sku='KK-1050' ORDER BY updated_at DESC LIMIT 1
`);
const a = rows[0]?.attrs || {};
for (const k of Object.keys(a).sort()) console.log(k);
console.log("\n--- sample ---");
for (const k of ["item_package_dimensions","item_package_weight","package_level","batteries_required","item_type_keyword","theme","supplier_declared_has_product_identifier_exemption"]) {
  console.log(k, JSON.stringify(a[k]));
}
await client.end();
