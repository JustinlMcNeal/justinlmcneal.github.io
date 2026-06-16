#!/usr/bin/env node
import pg from "pg";
import fs from "fs";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT schema_url, schema_snapshot
  FROM amazon_product_type_cache
  WHERE marketplace_id = 'ATVPDKIKX0DER'
    AND product_type = 'TOY_FIGURE'
  LIMIT 1
`);

const row = rows[0];
console.log("schema_url:", row?.schema_url);

function collectEnums(obj, keyNeedle, path = "", out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj.enum) && keyNeedle.test(path)) {
    out.push({ path, enum: obj.enum });
  }
  for (const [key, value] of Object.entries(obj)) {
    const next = path ? `${path}.${key}` : key;
    if (typeof value === "object") collectEnums(value, keyNeedle, next, out);
  }
  return out;
}

if (row?.schema_url) {
  const resp = await fetch(row.schema_url, {
    headers: { "user-agent": "KarryKraze-AmazonPTD/1.0" },
  });
  console.log("fetch status:", resp.status);
  const schema = await resp.json();
  fs.writeFileSync("scripts/supabase/tmp-toy-figure-full-schema.json", JSON.stringify(schema, null, 2));
  const enums = collectEnums(schema, /toy_figure_type/i);
  console.log("toy_figure_type enums:", JSON.stringify(enums, null, 2));
  const prop = schema?.properties?.toy_figure_type;
  console.log("property snippet:", JSON.stringify(prop, null, 2)?.slice(0, 4000));
}

await client.end();
