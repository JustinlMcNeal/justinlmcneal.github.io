#!/usr/bin/env node
import pg from "pg";

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Set SUPABASE_DB_PASSWORD");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(password)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const { rows } = await client.query(
  `SELECT schema_snapshot
   FROM amazon_product_type_cache
   WHERE product_type = 'TOYS_AND_GAMES'
     AND marketplace_id = 'ATVPDKIKX0DER'
   ORDER BY updated_at DESC
   LIMIT 1`,
);

const snap = rows[0]?.schema_snapshot;
if (!snap) {
  console.log("No cached schema");
  process.exit(0);
}

const str = JSON.stringify(snap);
const idx = str.indexOf("item_type_keyword");
console.log("Found at index:", idx);
if (idx >= 0) {
  console.log(str.slice(idx, idx + 4000));
}

await client.end();
