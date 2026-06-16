#!/usr/bin/env node
/** Restore KK-1050 draft to new_catalog with fixed attrs + product image. */
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const product = await client.query(`
  SELECT primary_image_url, catalog_image_url FROM products WHERE code = 'KK-1050' LIMIT 1
`);
const draft = await client.query(`
  SELECT id, draft_payload FROM amazon_listing_drafts WHERE kk_sku = 'KK-1050' ORDER BY updated_at DESC LIMIT 1
`);

const payload = { ...(draft.rows[0]?.draft_payload || {}) };
delete payload.merchant_suggested_asin;
payload.item_type_keyword = "plush-figure-toys";
payload.theme = "Floral";
payload.supplier_declared_has_product_identifier_exemption = "true";
payload.item_package_dimensions = payload.item_package_dimensions || payload.item_length_width_height || "8 x 6 x 4 in";
payload.item_package_weight = payload.item_package_weight || "0.5 pounds";
payload.package_level = "unit";
payload.batteries_required = "false";

const imageUrl = product.rows[0]?.primary_image_url || product.rows[0]?.catalog_image_url;
if (imageUrl?.startsWith("http")) payload.imageUrls = [imageUrl];

await client.query(
  `UPDATE amazon_listing_drafts
   SET draft_payload = $1::jsonb,
       matched_asin = NULL,
       asin = NULL,
       requirements = 'LISTING',
       push_workflow = 'new_catalog',
       draft_status = 'draft',
       submission_status = NULL,
       validation_errors = '[]'::jsonb,
       updated_at = now()
   WHERE id = $2`,
  [JSON.stringify(payload), draft.rows[0].id],
);

console.log("Restored draft", draft.rows[0].id, "for new_catalog preview");
await client.end();
