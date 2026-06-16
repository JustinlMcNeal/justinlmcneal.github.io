#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT product_type, schema_snapshot, updated_at
  FROM amazon_product_type_cache
  WHERE marketplace_id = 'ATVPDKIKX0DER'
    AND product_type = 'TOY_FIGURE'
  LIMIT 1
`);

const draft = await client.query(`
  SELECT product_type, draft_payload, validation_errors, last_submission_response
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC LIMIT 1
`);

console.log("Cache row:", rows[0] ? { product_type: rows[0].product_type, updated_at: rows[0].updated_at } : null);
const snap = JSON.stringify(rows[0]?.schema_snapshot || {});
for (const key of ["toy_figure_type", "subject_character", "color", "theme", "item_length", "item_dimensions", "item_type_keyword"]) {
  const idx = snap.indexOf(`"${key}"`);
  if (idx >= 0) console.log("\n---", key, "---\n", snap.slice(idx, idx + 1200));
}

console.log("\nDraft product_type:", draft.rows[0]?.product_type);
console.log("Draft keys:", Object.keys(draft.rows[0]?.draft_payload || {}));
const errors = draft.rows[0]?.validation_errors || [];
console.log("Recent errors:", errors.filter((e) => e.severity === "error").slice(0, 15));

await client.end();
