#!/usr/bin/env node
import pg from "pg";

const FIELDS = [
  "department",
  "import_designation",
  "size",
  "special_feature",
  "closure",
  "item_type_keyword",
  "target_gender",
];

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT schema_url, schema_snapshot
  FROM amazon_product_type_cache
  WHERE product_type = 'KEYCHAIN' AND marketplace_id = 'ATVPDKIKX0DER'
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1
`);

const url = rows[0]?.schema_url;
if (!url) {
  console.log("No KEYCHAIN cache");
  await client.end();
  process.exit(1);
}

const resp = await fetch(url, { headers: { "user-agent": "enum-fetch" } });
const schema = await resp.json();

for (const name of FIELDS) {
  const prop = schema.properties?.[name];
  const anyOf = prop?.items?.properties?.value?.anyOf;
  const enumBlock = anyOf?.find((x) => Array.isArray(x.enum));
  const enumNames = enumBlock?.enumNames;
  const enums = enumBlock?.enum;
  console.log("\n===", name, "===");
  if (enums) {
    console.log(enums.slice(0, 25).join(", "));
    if (enumNames) console.log("names:", enumNames.slice(0, 8).join(" | "));
  } else {
    console.log("(free text or nested)");
  }
}

console.log("\nTop required:", schema.required?.slice(0, 15));
await client.end();
