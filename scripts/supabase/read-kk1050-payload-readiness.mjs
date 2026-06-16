#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT draft_payload
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC LIMIT 1
`);

const p = rows[0]?.draft_payload || {};
const keys = [
  "title", "brand", "description", "bulletPoints", "imageUrls",
  "toy_figure_type", "subject_character", "color", "theme",
  "item_length_width_height", "item_type_keyword", "country_of_origin",
  "supplier_declared_has_product_identifier_exemption",
  "cpsia_cautionary_statement", "merchant_suggested_asin",
];
for (const k of keys) {
  const v = p[k];
  const preview = Array.isArray(v) ? `array(${v.length})` : v;
  console.log(k + ":", preview ?? "(missing)");
}

await client.end();
