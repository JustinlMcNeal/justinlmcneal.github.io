#!/usr/bin/env node
/** Add common TOY_FIGURE defaults and re-run preview until VALID or no progress. */
import pg from "pg";

const PROJECT_REF = "yxdzvzscufkvewecvagq";
const DRAFT_ID = "c3024b93-26f0-4038-b90f-8fdcc2155e59";

const EXTRA_DEFAULTS = {
  package_level: "unit",
  batteries_required: "false",
  batteries_included: "false",
  unit_count: "1 Count",
};

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.${PROJECT_REF}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`SELECT draft_payload FROM amazon_listing_drafts WHERE id = $1`, [DRAFT_ID]);
const payload = { ...(rows[0]?.draft_payload || {}), ...EXTRA_DEFAULTS };

await client.query(
  `UPDATE amazon_listing_drafts SET draft_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
  [JSON.stringify(payload), DRAFT_ID],
);
console.log("Patched extras:", EXTRA_DEFAULTS);

await client.end();

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resp = await fetch(`https://${PROJECT_REF}.supabase.co/functions/v1/amazon-submit-draft-preview`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ draftId: DRAFT_ID }),
});
const body = await resp.json();
console.log("Status:", body.submissionStatus);
console.log("Issues:", JSON.stringify(body.amazonIssues, null, 2));

process.exit(body.submissionStatus === "VALID" ? 0 : 1);
