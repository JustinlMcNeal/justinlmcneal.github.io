#!/usr/bin/env node
/** Switch KK-1050 to Option B: new catalog with GTIN exemption (no suggested ASIN). */
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const product = await client.query(`
  SELECT id, code, primary_image_url, catalog_image_url
  FROM products WHERE code = 'KK-1050' LIMIT 1
`);

const draft = await client.query(`
  SELECT id, draft_payload
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC LIMIT 1
`);

const row = draft.rows[0];
if (!row) {
  console.log("No draft");
  await client.end();
  process.exit(0);
}

const payload = { ...(row.draft_payload || {}) };
delete payload.merchant_suggested_asin;

const imageUrl = product.rows[0]?.primary_image_url || product.rows[0]?.catalog_image_url;
if (imageUrl && typeof imageUrl === "string" && imageUrl.startsWith("http")) {
  payload.imageUrls = [imageUrl];
  console.log("Added image:", imageUrl.slice(0, 80) + "...");
} else {
  console.log("WARNING: No product image found — Amazon new ASIN will likely fail without images");
}

payload.supplier_declared_has_product_identifier_exemption = "true";
payload.toy_figure_type = payload.toy_figure_type || "stuffed_toy";
payload.item_type_keyword = "plush-figure-toys";
if (String(payload.theme || "").trim().toLowerCase() === "flowers") {
  payload.theme = "Floral";
}

await client.query(
  `UPDATE amazon_listing_drafts
   SET draft_payload = $1::jsonb,
       matched_asin = NULL,
       asin = NULL,
       requirements = 'LISTING',
       push_workflow = 'new_catalog',
       submission_status = NULL,
       validation_errors = '[]'::jsonb,
       draft_status = 'draft',
       updated_at = now()
   WHERE id = $2`,
  [JSON.stringify(payload), row.id],
);

console.log("Switched draft", row.id, "to new_catalog (Option B), cleared B0GVC2K467");
await client.end();
