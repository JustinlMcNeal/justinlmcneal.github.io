#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

for (const productType of ["PRODUCT", "TOY_FIGURE"]) {
  for (const requirements of ["LISTING_OFFER_ONLY", "LISTING"]) {
    const { rows } = await client.query(
      `SELECT schema_snapshot, schema_url
       FROM amazon_product_type_cache
       WHERE marketplace_id = 'ATVPDKIKX0DER'
         AND product_type = $1
         AND requirements = $2
       LIMIT 1`,
      [productType, requirements],
    );
    const row = rows[0];
    console.log(`\n=== ${productType} / ${requirements} ===`);
    const snap = row?.schema_snapshot || {};
    console.log("cached requiredAttributes:", snap.requiredAttributes?.length, snap.requiredAttributes?.slice?.(0, 15));
    if (row?.schema_url) {
      try {
        const resp = await fetch(row.schema_url, { headers: { "user-agent": "KarryKraze-AmazonPTD/1.0" } });
        const schema = await resp.json();
        console.log("schema.required:", schema.required);
        console.log("propertyGroups keys:", Object.keys(schema.propertyGroups || {}).slice(0, 8));
      } catch (err) {
        console.log("schema fetch failed:", err.message);
      }
    }
  }
}

await client.end();
