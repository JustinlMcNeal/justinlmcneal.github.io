#!/usr/bin/env node
/** Try offer-only preview on existing ASIN B0GVC2K467 for KK-1050. */
import pg from "pg";

const PROJECT_REF = "yxdzvzscufkvewecvagq";
const DRAFT_ID = "c3024b93-26f0-4038-b90f-8fdcc2155e59";
const ASIN = "B0GVC2K467";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.${PROJECT_REF}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`SELECT draft_payload FROM amazon_listing_drafts WHERE id = $1`, [DRAFT_ID]);
const payload = { ...(rows[0]?.draft_payload || {}), merchant_suggested_asin: ASIN };

await client.query(
  `UPDATE amazon_listing_drafts
   SET draft_payload = $1::jsonb,
       matched_asin = $2,
       requirements = 'LISTING_OFFER_ONLY',
       push_workflow = 'offer_on_asin',
       updated_at = now()
   WHERE id = $3`,
  [JSON.stringify(payload), ASIN, DRAFT_ID],
);
console.log("Switched to offer_on_asin with", ASIN);
await client.end();

const resp = await fetch(`https://${PROJECT_REF}.supabase.co/functions/v1/amazon-submit-draft-preview`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ draftId: DRAFT_ID }),
});
const body = await resp.json();
console.log("Status:", body.submissionStatus);
console.log("Issues:", JSON.stringify(body.amazonIssues, null, 2));
