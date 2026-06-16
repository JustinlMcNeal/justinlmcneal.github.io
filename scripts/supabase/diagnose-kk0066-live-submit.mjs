#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const draft = await client.query(`
  SELECT id, kk_sku, draft_status, submission_status, updated_at,
         last_submission_response, last_validation_result, validation_errors
  FROM amazon_listing_drafts
  WHERE kk_sku ILIKE '%0066%'
  ORDER BY updated_at DESC LIMIT 1
`);
const row = draft.rows[0];
console.log("draft:", row?.kk_sku, row?.draft_status, row?.submission_status, row?.updated_at);

const issues = await client.query(`
  SELECT source, severity, issue_code, message, status
  FROM amazon_listing_issues
  WHERE draft_id = $1 AND status = 'open'
  ORDER BY created_at DESC
`, [row.id]);
console.log("\nopen issues:");
for (const i of issues.rows) console.log(` [${i.severity}] ${i.source}/${i.issue_code}: ${i.message?.slice(0, 120)}`);

const resp = row?.last_submission_response || {};
console.log("\nlast submission mode:", resp.mode, "status:", resp.status);
console.log("issues in response:", resp.response?.issues?.length || 0);
if (resp.response?.issues?.length) {
  for (const i of resp.response.issues.slice(0, 8)) {
    console.log("-", i.severity, i.code, i.attributeNames, i.message?.slice(0, 120));
  }
}

const val = row?.last_validation_result || {};
console.log("\nvalidation result keys:", Object.keys(val));
console.log("previewedAt:", val.previewedAt, "amazonPreviewAt:", val.amazonPreviewAt);
console.log("productType in result:", val.productType);

const openErrors = issues.rows.filter((i) => i.severity === "error");
console.log("\nopen error count:", openErrors.length);

await client.end();
