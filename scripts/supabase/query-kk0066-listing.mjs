#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(`
  SELECT seller_sku, asin, price, fbm_quantity, product_type,
         listing_status, listing_status_buyable,
         raw_listing->'attributes'->'merchant_suggested_asin' AS msa,
         raw_listing->'attributes'->'supplier_declared_has_product_identifier_exemption' AS ex
  FROM amazon_listings
  WHERE seller_sku ILIKE '%0066%'
  LIMIT 3
`);
console.log(JSON.stringify(rows, null, 2));
await client.end();
