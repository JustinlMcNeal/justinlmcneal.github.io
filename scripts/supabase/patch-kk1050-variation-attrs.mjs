#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const result = await client.query(`
  SELECT id, draft_payload
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC
  LIMIT 1
`);
const row = result.rows[0];
if (!row) {
  console.log("No KK-1050 draft found");
  await client.end();
  process.exit(0);
}

const payload = { ...(row.draft_payload || {}) };
delete payload.parentage_level;
delete payload.supplier_declared_dg_hz_regulation;
delete payload.child_parent_sku_relationship;
delete payload.variation_theme;
delete payload.package_level;
if (payload.toy_figure_type === "plush") payload.toy_figure_type = "stuffed_toy";

await client.query(
  `UPDATE amazon_listing_drafts
   SET draft_payload = $1::jsonb, updated_at = now()
   WHERE id = $2`,
  [JSON.stringify(payload), row.id],
);

console.log("Patched draft", row.id);
console.log("Has parentage_level:", "parentage_level" in payload);
console.log("Has dg_hz:", "supplier_declared_dg_hz_regulation" in payload);
await client.end();
