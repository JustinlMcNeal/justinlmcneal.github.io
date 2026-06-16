#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const listings = await client.query(`
  SELECT seller_sku, product_type, asin,
         raw_listing->'attributes' AS attrs
  FROM amazon_listings
  WHERE product_type ILIKE '%TOY%'
     OR product_type ILIKE '%PLUSH%'
     OR product_type ILIKE '%STUFFED%'
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 5
`);

for (const row of listings.rows) {
  const attrs = row.attrs || {};
  console.log("\n===", row.seller_sku, row.product_type, row.asin, "===");
  for (const key of [
    "item_type_keyword",
    "toy_figure_type",
    "package_level",
    "batteries_required",
    "supplier_declared_has_product_identifier_exemption",
    "externally_assigned_product_identifier",
    "theme",
  ]) {
    if (attrs[key]) console.log(key, JSON.stringify(attrs[key]));
  }
}

await client.end();
