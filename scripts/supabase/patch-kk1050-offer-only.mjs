#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const result = await client.query(`
  SELECT id, draft_payload, matched_asin
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
const matchedAsin = row.matched_asin || payload.merchant_suggested_asin || "B0GVC2K467";
payload.merchant_suggested_asin = matchedAsin;

await client.query(
  `UPDATE amazon_listing_drafts
   SET draft_payload = $1::jsonb,
       matched_asin = $2,
       requirements = 'LISTING_OFFER_ONLY',
       push_workflow = 'offer_on_asin',
       validation_errors = '[]'::jsonb,
       updated_at = now()
   WHERE id = $3`,
  [JSON.stringify(payload), matchedAsin, row.id],
);

console.log("Patched draft", row.id, "offer_on_asin", matchedAsin);
await client.end();
