#!/usr/bin/env node
/** Verify Phase 10AA issues architecture — core view fast, snapshots populated. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectPgClient } from "./supabase/dbConnect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnv() {
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
    }
  } catch {
    // optional
  }
}

loadEnv();

const client = await connectPgClient();
try {
  const t0 = Date.now();
  const issues = await client.query(
    `SELECT issue_type, affected_count FROM v_inventory_issues ORDER BY affected_count DESC LIMIT 8`,
  );
  const issuesMs = Date.now() - t0;

  const core = await client.query(`SELECT COUNT(*)::int AS n FROM v_inventory_issues_core`);
  const snap = await client.query(
    `SELECT COUNT(*)::int AS n, MAX(refreshed_at) AS refreshed_at FROM inventory_issue_snapshots`,
  );
  const cron = await client.query(
    `SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'inventory-issue-snapshots-every-15m'`,
  );

  console.log(`v_inventory_issues query: ${issuesMs}ms (${issues.rows.length} rows shown)`);
  console.log("Top issues:", issues.rows);
  console.log("Core issue groups:", core.rows[0]?.n);
  console.log("Snapshot rows:", snap.rows[0]);
  console.log("Cron job:", cron.rows[0] || "missing");

  if (issuesMs > 3000) {
    console.error("FAIL: issues view slower than 3s");
    process.exit(1);
  }
  if (!cron.rows[0]?.active) {
    console.error("FAIL: snapshot cron not active");
    process.exit(1);
  }
  console.log("\nPASS — Phase 10AA issues architecture OK");
} finally {
  await client.end();
}
