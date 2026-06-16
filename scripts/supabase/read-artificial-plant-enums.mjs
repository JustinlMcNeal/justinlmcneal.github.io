#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT schema_url, schema_snapshot
  FROM amazon_product_type_cache
  WHERE marketplace_id = 'ATVPDKIKX0DER'
    AND product_type = 'ARTIFICIAL_PLANT'
    AND requirements = 'LISTING'
  LIMIT 1
`);

const row = rows[0];
console.log("has cache:", Boolean(row));
if (!row?.schema_url) {
  await client.end();
  process.exit(0);
}

const resp = await fetch(row.schema_url, { headers: { "user-agent": "KarryKraze-AmazonPTD/1.0" } });
const schema = await resp.json();

function collectEnums(prop) {
  const items = prop?.items;
  const value = items?.properties?.value;
  if (Array.isArray(value?.enum)) return value.enum;
  const type = items?.properties?.type;
  const nested = type?.items?.properties?.value;
  if (Array.isArray(nested?.enum)) return nested.enum;
  return [];
}

const attrs = [
  "indoor_outdoor_usage",
  "container",
  "specific_uses_for_product",
  "plant_or_animal_product_type",
  "item_shape",
];

for (const name of attrs) {
  const enums = collectEnums(schema.properties?.[name]);
  console.log(`${name}:`, JSON.stringify(enums));
}

await client.end();
