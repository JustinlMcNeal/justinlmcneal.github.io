#!/usr/bin/env node
import pg from "pg";

const id = process.argv[2] || "c3024b93-26f0-4038-b90f-8fdcc2155e59";
const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows } = await client.query(
  `SELECT submission_status, draft_status, last_submission_response, validation_errors, last_validation_result
   FROM amazon_listing_drafts WHERE id = $1`,
  [id],
);

console.log(JSON.stringify(rows[0], null, 2));
await client.end();
