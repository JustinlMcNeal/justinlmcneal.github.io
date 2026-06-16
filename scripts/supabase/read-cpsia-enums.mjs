#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT product_type, schema_url, schema_snapshot
  FROM amazon_product_type_cache
  WHERE marketplace_id = 'ATVPDKIKX0DER'
  ORDER BY updated_at DESC
  LIMIT 5
`);

function collectEnums(obj, keyMatch, path = "", out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj.enum) && /cpsia/i.test(path)) {
    out.push({ path, enum: obj.enum });
  }
  for (const [key, value] of Object.entries(obj)) {
    const next = path ? `${path}.${key}` : key;
    if (/cpsia/i.test(key) || /cpsia/i.test(next)) {
      collectEnums(value, keyMatch, next, out);
    } else if (typeof value === "object") {
      collectEnums(value, keyMatch, next, out);
    }
  }
  return out;
}

for (const row of rows) {
  console.log("\n===", row.product_type, "===");
  const snap = row.schema_snapshot || {};
  const str = JSON.stringify(snap);
  const idx = str.indexOf("cpsia");
  if (idx >= 0) console.log(str.slice(idx, idx + 2000));
  const enums = collectEnums(snap, "cpsia");
  if (enums.length) console.log("Enums:", JSON.stringify(enums, null, 2));
}

const draft = await client.query(`
  SELECT product_type, draft_payload->>'cpsia_cautionary_statement' AS cpsia
  FROM amazon_listing_drafts WHERE kk_sku = 'KK-1050' ORDER BY updated_at DESC LIMIT 1
`);
console.log("\nDraft:", draft.rows[0]);

await client.end();
