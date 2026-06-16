#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const draft = await client.query(`
  SELECT last_submission_response, draft_payload
  FROM amazon_listing_drafts
  WHERE kk_sku ILIKE '%0066%'
  ORDER BY updated_at DESC LIMIT 1
`);
const sent = draft.rows[0]?.last_submission_response?.requestBody?.attributes || {};
const draftPayload = draft.rows[0]?.draft_payload || {};

console.log("draft included_components:", draftPayload.included_components);
console.log("sent keys:", Object.keys(sent).sort().join(", "));
console.log("\nfull sent payload:\n", JSON.stringify(sent, null, 2));

await client.end();
