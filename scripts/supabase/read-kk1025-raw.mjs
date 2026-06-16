#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT seller_sku, product_type, asin, raw_listing
  FROM amazon_listings WHERE asin = 'B0GVC2K467' LIMIT 1
`);
console.log(JSON.stringify(rows[0]?.raw_listing, null, 2)?.slice(0, 12000));

await client.end();
