#!/usr/bin/env node
import pg from "pg";

const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(`
  UPDATE amazon_listing_drafts
  SET draft_status = 'ready_to_submit', updated_at = now()
  WHERE kk_sku ILIKE '%0066%'
    AND submission_status IN ('VALID', 'ACCEPTED')
  RETURNING kk_sku, draft_status, submission_status
`);
console.log(rows);
await client.end();
