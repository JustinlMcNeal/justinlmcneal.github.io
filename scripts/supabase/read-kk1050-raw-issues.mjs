#!/usr/bin/env node
import pg from "pg";
const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(`
  SELECT last_submission_response->'response'->'issues' AS issues
  FROM amazon_listing_drafts WHERE kk_sku='KK-1050' ORDER BY updated_at DESC LIMIT 1
`);
console.log(JSON.stringify(rows[0]?.issues, null, 2));
await client.end();
