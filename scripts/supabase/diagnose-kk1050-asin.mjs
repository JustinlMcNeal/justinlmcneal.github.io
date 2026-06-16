#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const draft = await client.query(`
  SELECT id, seller_sku, product_type, matched_asin, push_workflow, requirements,
         draft_payload, validation_errors, last_submission_response
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC
  LIMIT 1
`);
const row = draft.rows[0];
console.log("Draft summary:", {
  id: row?.id,
  seller_sku: row?.seller_sku,
  product_type: row?.product_type,
  matched_asin: row?.matched_asin,
  push_workflow: row?.push_workflow,
  requirements: row?.requirements,
  merchant_suggested_asin: row?.draft_payload?.merchant_suggested_asin,
  exemption: row?.draft_payload?.supplier_declared_has_product_identifier_exemption,
  item_type_keyword: row?.draft_payload?.item_type_keyword,
  toy_figure_type: row?.draft_payload?.toy_figure_type,
});
console.log("\nErrors:", (row?.validation_errors || []).filter((e) => e.severity === "error"));

const listings = await client.query(`
  SELECT asin, seller_sku, product_type, listing_status, amazon_title
  FROM amazon_listings
  WHERE asin = 'B0GVC2K467'
     OR seller_sku IN ('KK-1025', 'KK-1050')
  ORDER BY updated_at DESC
`);
console.log("\nListings:", listings.rows);

const mappings = await client.query(`
  SELECT m.mapping_status, m.kk_sku, l.asin, l.seller_sku, l.product_type
  FROM amazon_listing_mappings m
  JOIN amazon_listings l ON l.id = m.amazon_listing_id
  WHERE l.asin = 'B0GVC2K467'
     OR m.kk_sku IN ('KK-1025', 'KK-1050')
`);
console.log("\nMappings:", mappings.rows);

await client.end();
