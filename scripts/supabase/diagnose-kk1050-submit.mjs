#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const draft = await client.query(`
  SELECT id, seller_sku, product_type, matched_asin, requirements, push_workflow,
         submission_status, draft_status, draft_payload, validation_errors,
         last_submission_response
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC
  LIMIT 1
`);
const row = draft.rows[0];
console.log("Draft:", {
  id: row?.id,
  seller_sku: row?.seller_sku,
  product_type: row?.product_type,
  matched_asin: row?.matched_asin,
  requirements: row?.requirements,
  push_workflow: row?.push_workflow,
  submission_status: row?.submission_status,
  draft_status: row?.draft_status,
  merchant_suggested_asin: row?.draft_payload?.merchant_suggested_asin,
  exemption: row?.draft_payload?.supplier_declared_has_product_identifier_exemption,
});

const errors = (row?.validation_errors || []).filter((e) => e.severity === "error");
console.log("\nStored errors:", errors);

const amazonErrors = (row?.last_submission_response?.issues || row?.last_submission_response?.Issues || [])
  .slice?.(0, 5);
console.log("\nLast Amazon response issues:", JSON.stringify(amazonErrors, null, 2));
console.log("\nLast submission status:", row?.last_submission_response?.status || row?.submission_status);

const listing = await client.query(`
  SELECT asin, seller_sku, product_type, listing_status, amazon_title
  FROM amazon_listings WHERE asin = 'B0GVC2K467' LIMIT 1
`);
console.log("\nCatalog listing:", listing.rows[0]);

await client.end();
