#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const draft = await client.query(`
  SELECT id, kk_sku, draft_status, draft_payload, last_submission_response, submission_status
  FROM amazon_listing_drafts
  WHERE kk_sku ILIKE '%0066%'
  ORDER BY updated_at DESC
  LIMIT 1
`);
const row = draft.rows[0];
console.log("draft", row?.kk_sku, row?.draft_status, row?.submission_status, row?.id);

const issues = await client.query(`
  SELECT severity, issue_code, message, attribute_names, source, status
  FROM amazon_listing_issues
  WHERE draft_id = $1
  ORDER BY created_at DESC
  LIMIT 20
`, [row.id]);
console.log("\n=== open/recent issues ===");
for (const issue of issues.rows) {
  console.log(`[${issue.severity}] ${issue.issue_code}: ${issue.message}`);
}

const resp = row?.last_submission_response || {};
console.log("\n=== last submission keys ===", Object.keys(resp));
console.log("status", resp.status, "rawStatus", resp.rawStatus);
const amazonIssues = resp.response?.issues || [];
console.log("amazon issues count", amazonIssues.length);
for (const issue of amazonIssues.slice(0, 12)) {
  console.log("-", issue.severity, issue.code, JSON.stringify(issue.attributeNames), issue.message?.slice?.(0, 140));
}

await client.end();
