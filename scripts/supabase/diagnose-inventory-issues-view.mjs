#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectPgClient } from "./dbConnect.mjs";

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
  for (const sql of [
    `SELECT issue_type, workflow_status FROM v_inventory_issues_with_state ORDER BY affected_count DESC LIMIT 3`,
    `SELECT issue_type FROM v_inventory_issues ORDER BY affected_count DESC LIMIT 3`,
    `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='v_inventory_issues_with_state'`,
    `SELECT pg_get_viewdef('public.v_inventory_issues_with_state'::regclass, true) AS def`,
  ]) {
    console.log("\n---", sql.slice(0, 80), "...");
    try {
      const r = await client.query(sql);
      console.log(JSON.stringify(r.rows, null, 2).slice(0, 2000));
    } catch (e) {
      console.error("ERROR:", e.message);
    }
  }
} finally {
  await client.end();
}
