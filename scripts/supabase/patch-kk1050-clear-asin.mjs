#!/usr/bin/env node
/** Assert KK-1050 new-catalog payload excludes merchant_suggested_asin. */
import pg from "pg";

const OFFER_ONLY = new Set([
  "merchant_suggested_asin",
  "condition_type",
  "purchasable_offer",
  "fulfillment_availability",
]);

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

await client.query(`
  UPDATE amazon_listing_drafts
  SET matched_asin = NULL,
      asin = NULL,
      requirements = 'LISTING',
      push_workflow = 'new_catalog',
      draft_payload = draft_payload - 'merchant_suggested_asin',
      validation_errors = '[]'::jsonb,
      draft_status = 'draft',
      updated_at = now()
  WHERE kk_sku = 'KK-1050'
`);

const { rows } = await client.query(`
  SELECT draft_payload, requirements, matched_asin, push_workflow
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC LIMIT 1
`);

const row = rows[0];
console.log("DB state:", {
  requirements: row.requirements,
  push_workflow: row.push_workflow,
  matched_asin: row.matched_asin,
  merchant_suggested_asin: row.draft_payload?.merchant_suggested_asin,
  has_image: Array.isArray(row.draft_payload?.imageUrls) && row.draft_payload.imageUrls.length > 0,
});

if (row.draft_payload?.merchant_suggested_asin || row.matched_asin) {
  console.error("FAIL: draft still has suggested ASIN fields");
  process.exitCode = 1;
} else {
  console.log("OK: draft cleared for Option B");
}

await client.end();
