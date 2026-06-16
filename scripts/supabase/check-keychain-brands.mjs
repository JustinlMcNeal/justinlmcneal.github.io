#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const brands = await client.query(`
  SELECT raw_listing->'attributes'->'brand'->0->>'value' AS brand,
         COUNT(*)::int AS cnt
  FROM amazon_listings
  WHERE product_type='KEYCHAIN'
  GROUP BY 1
  ORDER BY cnt DESC
`);
console.log("KEYCHAIN brands on account:");
for (const row of brands.rows) console.log(" ", row.brand, row.cnt);

const kk = await client.query(`
  SELECT seller_sku, asin,
         raw_listing->'attributes'->'brand'->0->>'value' AS brand,
         raw_listing->'attributes'->'supplier_declared_has_product_identifier_exemption' AS ex
  FROM amazon_listings
  WHERE raw_listing->'attributes'->'brand'->0->>'value' ILIKE '%karry%'
  LIMIT 10
`);
console.log("\nListings with Karry Kraze brand:", kk.rows.length);
for (const row of kk.rows) console.log(row.seller_sku, row.asin, row.brand, row.ex);

const cache = await client.query(`SELECT schema_url FROM amazon_product_type_cache WHERE product_type='KEYCHAIN' LIMIT 1`);
const schema = await (await fetch(cache.rows[0].schema_url)).json();
for (const [i, rule] of (schema.allOf || []).entries()) {
  const req = rule.then?.required || [];
  if (req.includes("item_weight") || req.includes("item_shape") || req.includes("number_of_pieces")) {
    console.log("\nallOf", i, "requires", req);
    console.log("if snippet:", JSON.stringify(rule.if).slice(0, 400));
  }
}

await client.end();
