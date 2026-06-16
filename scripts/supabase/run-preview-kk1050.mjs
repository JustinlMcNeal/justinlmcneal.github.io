#!/usr/bin/env node
/** Call amazon-submit-draft-preview for KK-1050 and print result. */
import pg from "pg";

const PROJECT_REF = "yxdzvzscufkvewecvagq";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.${PROJECT_REF}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT id FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC LIMIT 1
`);
const draftId = rows[0]?.id;
if (!draftId) {
  console.error("Draft not found");
  await client.end();
  process.exit(1);
}

console.log("Preview draft:", draftId);

const resp = await fetch(
  `https://${PROJECT_REF}.supabase.co/functions/v1/amazon-submit-draft-preview`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ draftId }),
  },
);

const body = await resp.json();
console.log("HTTP", resp.status);
console.log(JSON.stringify(body, null, 2));

if (body?.lastSubmissionResponse?.requestBody?.attributes?.item_type_keyword) {
  console.log("\nitem_type_keyword sent:",
    JSON.stringify(body.lastSubmissionResponse.requestBody.attributes.item_type_keyword));
}

await client.end();
process.exit(resp.ok && body?.submissionStatus === "VALID" ? 0 : 1);
