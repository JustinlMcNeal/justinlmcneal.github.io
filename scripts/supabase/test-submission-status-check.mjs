#!/usr/bin/env node
import pg from "pg";

const id = "c3024b93-26f0-4038-b90f-8fdcc2155e59";
const client = new pg.Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.yxdzvzscufkvewecvagq.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

for (const status of ["VALID", "Valid", "valid", "INVALID", "ACCEPTED", "processing", "failed"]) {
  try {
    await client.query(
      "UPDATE amazon_listing_drafts SET submission_status = $1 WHERE id = $2",
      [status, id],
    );
    console.log("OK", status);
  } catch (e) {
    console.log("FAIL", status, e.message);
  }
}

await client.end();
