#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const product = await client.query(`
  SELECT id, code, primary_image_url, catalog_image_url
  FROM products WHERE code = 'KK-1050' LIMIT 1
`);
console.log("Product:", product.rows[0]);

const listings = await client.query(`
  SELECT l.asin, l.seller_sku, l.product_type, m.kk_product_id
  FROM amazon_listings l
  LEFT JOIN amazon_listing_mappings m ON m.amazon_listing_id = l.id
  WHERE l.asin = 'B0GVC2K467'
     OR m.kk_product_id = (SELECT id FROM products WHERE code = 'KK-1050' LIMIT 1)
`);

console.log("Related listings:", listings.rows);

await client.end();
