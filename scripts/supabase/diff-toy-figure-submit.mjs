#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const draft = await client.query(`
  SELECT last_submission_response, draft_payload
  FROM amazon_listing_drafts WHERE kk_sku = 'KK-1050' ORDER BY updated_at DESC LIMIT 1
`);
const sentKeys = new Set(Object.keys(draft.rows[0]?.last_submission_response?.requestBody?.attributes || {}));

const cache = await client.query(`
  SELECT schema_url FROM amazon_product_type_cache
  WHERE marketplace_id = 'ATVPDKIKX0DER' AND product_type = 'TOY_FIGURE' AND requirements = 'LISTING'
  LIMIT 1
`);
const resp = await fetch(cache.rows[0].schema_url, { headers: { "user-agent": "test" } });
const schema = await resp.json();

console.log("Top required:", schema.required);
console.log("Sent count:", sentKeys.size);

function walk(obj, path = "", out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj.allOf)) obj.allOf.forEach((x, i) => walk(x, `${path}/allOf[${i}]`, out));
  if (Array.isArray(obj.anyOf)) obj.anyOf.forEach((x, i) => walk(x, `${path}/anyOf[${i}]`, out));
  if (obj.if) walk(obj.if, `${path}/if`, out);
  if (obj.then) {
    const req = obj.then.required;
    if (Array.isArray(req)) {
      for (const name of req) {
        if (typeof name === "string" && !sentKeys.has(name)) out.push({ name, path: `${path}/then` });
      }
    }
    walk(obj.then, `${path}/then`, out);
  }
  return out;
}

const conditionalMissing = walk(schema);
const unique = [...new Map(conditionalMissing.map((x) => [x.name, x])).values()];
console.log("\nConditional required not in submit:", unique.slice(0, 30));

const itk = schema.properties?.item_type_keyword?.items?.properties?.value;
console.log("\nitem_type_keyword enum sample:", itk?.enum?.slice?.(0, 20));
console.log("stuffed-animal-toys in enum?", itk?.enum?.includes("stuffed-animal-toys"));
console.log("plush-pillows in enum?", itk?.enum?.includes("plush-pillows"));

const props = schema.properties || {};
for (const key of ["supplier_declared_has_product_identifier_exemption", "externally_assigned_product_identifier", "gtin_exemption_reason", "merchant_suggested_asin"]) {
  if (props[key]) console.log("\nHas property:", key);
}

await client.end();
