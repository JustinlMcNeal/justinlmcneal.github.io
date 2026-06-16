#!/usr/bin/env node
import pg from "pg";
import fs from "node:fs";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(`
  SELECT schema_url FROM amazon_product_type_cache
  WHERE product_type='KEYCHAIN' AND marketplace_id='ATVPDKIKX0DER' LIMIT 1
`);
const schema = await (await fetch(rows[0].schema_url)).json();
for (const name of ["department", "size", "import_designation"]) {
  fs.writeFileSync(`scripts/supabase/tmp-keychain-${name}.json`, JSON.stringify(schema.properties[name], null, 2));
}
console.log("done");
await client.end();
