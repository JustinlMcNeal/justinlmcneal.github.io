#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const listings = await client.query(`
  SELECT asin, seller_sku, product_type, raw_listing
  FROM amazon_listings
  WHERE asin = 'B0GVC2K467'
     OR seller_sku ILIKE '%1050%'
     OR seller_sku ILIKE '%1025%'
  LIMIT 5
`);
for (const row of listings.rows) {
  console.log(row.asin, row.seller_sku, row.product_type);
  console.log(JSON.stringify(row.raw_listing, null, 2).slice(0, 5000));
}

const ptd = await client.query(`
  SELECT product_type, schema_snapshot->'requiredAttributes' AS required_attributes
  FROM amazon_product_type_cache
  WHERE marketplace_id = 'ATVPDKIKX0DER'
  ORDER BY product_type
`);
console.log("PTD cache:", JSON.stringify(ptd.rows, null, 2));

const draft = await client.query(`
  SELECT draft_payload->>'item_type_keyword' AS itk, matched_asin, draft_payload
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC
  LIMIT 1
`);
console.log("Draft itk:", draft.rows[0]?.itk);
console.log("Draft keys:", Object.keys(draft.rows[0]?.draft_payload || {}));
console.log("Draft payload sample:", JSON.stringify(draft.rows[0]?.draft_payload, null, 2).slice(0, 3000));

await client.end();
