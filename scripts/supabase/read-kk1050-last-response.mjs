#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(`
  SELECT draft_payload, matched_asin, requirements, last_submission_response, last_validation_result
  FROM amazon_listing_drafts
  WHERE kk_sku = 'KK-1050'
  ORDER BY updated_at DESC LIMIT 1
`);

const row = rows[0];
console.log("requirements:", row?.requirements);
console.log("matched_asin:", row?.matched_asin);
console.log("\nlast_submission_response:", JSON.stringify(row?.last_submission_response, null, 2)?.slice(0, 8000));
console.log("\nlast_validation_result amazonIssues:", JSON.stringify(row?.last_validation_result?.amazonIssues, null, 2)?.slice(0, 4000));

await client.end();
