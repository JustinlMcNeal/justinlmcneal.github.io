#!/usr/bin/env node
import pg from "pg";

const ref = "yxdzvzscufkvewecvagq";
const pw = process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD;
if (!pw) {
  console.error("No SUPABASE_DB_PASSWORD or PGPASSWORD in env");
  process.exit(1);
}

console.log("password length:", pw.length);
console.log("password char codes (first/last):", pw.charCodeAt(0), pw.charCodeAt(pw.length - 1));

const encoded = encodeURIComponent(pw);
const attempts = [
  ["direct-5432", `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres`],
  ["pooler-us-west-2-5432", `postgresql://postgres.${ref}:${encoded}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`],
  ["pooler-us-west-2-6543", `postgresql://postgres.${ref}:${encoded}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`],
  ["pooler-us-east-1-5432", `postgresql://postgres.${ref}:${encoded}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`],
];

for (const [name, cs] of attempts) {
  const client = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const r = await client.query("select current_user as user, version()");
    console.log(`${name}: OK as ${r.rows[0].user}`);
    await client.end();
    process.exit(0);
  } catch (e) {
    console.log(`${name}: FAIL ${e.code || ""} ${e.message}`);
    try { await client.end(); } catch { /* ignore */ }
  }
}

process.exit(1);
