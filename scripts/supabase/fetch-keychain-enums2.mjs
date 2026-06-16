#!/usr/bin/env node
import pg from "pg";

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

function getEnums(name) {
  const val = schema.properties?.[name]?.items?.properties?.value;
  const block = val?.anyOf?.find((x) => Array.isArray(x.enum));
  return block?.enum || val?.enum || null;
}

for (const name of ["closure", "size", "department", "model_number", "style", "color", "theme"]) {
  const enums = getEnums(name);
  console.log(name, enums ? enums.slice(0, 15).join(", ") : "(text)");
}
await client.end();
