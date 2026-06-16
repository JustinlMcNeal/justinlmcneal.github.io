#!/usr/bin/env node
/** Fix KK-1050 item_type_keyword + theme for TOY_FIGURE new-catalog preview. */
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT id, draft_payload
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC LIMIT 1
`);

const row = rows[0];
if (!row) {
  console.log("No draft found");
  await client.end();
  process.exit(1);
}

const payload = { ...(row.draft_payload || {}) };
const before = {
  item_type_keyword: payload.item_type_keyword,
  theme: payload.theme,
};

payload.item_type_keyword = "plush-figure-toys";
if (String(payload.theme || "").trim().toLowerCase() === "flowers") {
  payload.theme = "Floral";
}

await client.query(
  `UPDATE amazon_listing_drafts
   SET draft_payload = $1::jsonb,
       submission_status = NULL,
       validation_errors = '[]'::jsonb,
       draft_status = 'draft',
       updated_at = now()
   WHERE id = $2`,
  [JSON.stringify(payload), row.id],
);

console.log("Patched draft", row.id);
console.log("Before:", before);
console.log("After:", {
  item_type_keyword: payload.item_type_keyword,
  theme: payload.theme,
});

await client.end();
