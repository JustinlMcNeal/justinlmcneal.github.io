#!/usr/bin/env node
/** Install Amazon order + finance pg_cron jobs (service role auth). */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(resolve(repoRoot, ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    // optional
  }
  return env;
}

function runSql(sql) {
  const r = spawnSync("npx", ["supabase", "db", "query", "--linked", sql], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const out = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
  if (r.status !== 0) throw new Error(out || "sql failed");
  return out;
}

const env = loadEnv();
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const base = env.SUPABASE_URL || "https://yxdzvzscufkvewecvagq.supabase.co";
if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env");

const headersJson = JSON.stringify({
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
}).replace(/'/g, "''");

for (const name of ["amazon-sync-orders-every-4h", "amazon-sync-finances-daily"]) {
  try {
    runSql(`SELECT cron.unschedule('${name}');`);
  } catch {
    // not scheduled yet
  }
}

runSql(
  `SELECT cron.schedule('amazon-sync-orders-every-4h', '0 */4 * * *', $$SELECT net.http_post(url := '${base}/functions/v1/amazon-sync-orders', headers := '${headersJson}'::jsonb, body := '{"days_back": 3}'::jsonb)$$);`,
);

runSql(
  `SELECT cron.schedule('amazon-sync-finances-daily', '0 7 * * *', $$SELECT net.http_post(url := '${base}/functions/v1/amazon-sync-finances', headers := '${headersJson}'::jsonb, body := '{"days_back": 30}'::jsonb)$$);`,
);

console.log(runSql(
  "SELECT jobname, schedule FROM cron.job WHERE jobname LIKE '%amazon%' OR jobname LIKE '%ebay%' OR jobname LIKE '%analytics%' ORDER BY jobname;",
));
