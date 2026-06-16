#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const issues = await client.query(`
  SELECT field_name, severity, message, raw_issue, created_at
  FROM amazon_listing_issues
  WHERE draft_id = 'c3024b93-26f0-4038-b90f-8fdcc2155e59'
  ORDER BY created_at DESC
  LIMIT 10
`);
console.log(JSON.stringify(issues.rows, null, 2));

await client.end();
