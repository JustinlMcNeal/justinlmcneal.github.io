#!/usr/bin/env node
/**
 * Restore pg_cron jobs after emergency-recover-db.sql unscheduled all jobs.
 * Run: node scripts/supabase/restore-pg-cron-jobs.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT_URL = "https://yxdzvzscufkvewecvagq.supabase.co";

function loadEnv() {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(join(ROOT, name), "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i > 0) env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
      }
    } catch {
      // optional
    }
  }
  return env;
}

function escSqlLiteral(s) {
  return String(s).replace(/'/g, "''");
}

function authHeader(serviceKey) {
  return JSON.stringify({
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  });
}

function authHeaderWithCronSecret(serviceKey, cronSecret) {
  return `jsonb_build_object(
      'Authorization', 'Bearer ${escSqlLiteral(serviceKey)}',
      'Content-Type', 'application/json',
      'x-cron-secret', '${escSqlLiteral(cronSecret)}'
    )`;
}

function httpPostJob(name, schedule, url, headersExpr, body = "'{}'::jsonb") {
  return `
SELECT cron.schedule(
  '${name}',
  '${schedule}',
  $$SELECT net.http_post(
    url := '${url}',
    headers := ${headersExpr},
    body := ${body}
  )$$
);`;
}

const env = loadEnv();
const serviceKey =
  env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = env.CRON_SECRET || process.env.CRON_SECRET;

if (!serviceKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const h = `'${escSqlLiteral(authHeader(serviceKey))}'::jsonb`;
const hObj = `'${escSqlLiteral(JSON.stringify({
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
}))}'::jsonb`;

const jobs = [
  httpPostJob(
    "process-scheduled-social-posts",
    "* * * * *",
    `${PROJECT_URL}/functions/v1/process-scheduled-posts`,
    hObj,
  ),
  httpPostJob(
    "autopilot-fill-daily",
    "0 2 * * *",
    `${PROJECT_URL}/functions/v1/autopilot-fill`,
    hObj,
  ),
  httpPostJob(
    "refresh-social-tokens-daily",
    "0 3 * * *",
    `${PROJECT_URL}/functions/v1/refresh-tokens`,
    hObj,
  ),
  httpPostJob(
    "ebay-sync-orders-every-2h",
    "0 */2 * * *",
    `${PROJECT_URL}/functions/v1/ebay-sync-orders`,
    hObj,
    `'{"days_back": 3}'::jsonb`,
  ),
  httpPostJob(
    "amazon-sync-orders-every-4h",
    "0 */4 * * *",
    `${PROJECT_URL}/functions/v1/amazon-sync-orders`,
    hObj,
    `'{"days_back": 3}'::jsonb`,
  ),
  httpPostJob(
    "amazon-sync-finances-daily",
    "0 7 * * *",
    `${PROJECT_URL}/functions/v1/amazon-sync-finances`,
    hObj,
    `'{"days_back": 30}'::jsonb`,
  ),
  httpPostJob(
    "ebay-sync-finances-daily",
    "0 6 * * *",
    `${PROJECT_URL}/functions/v1/ebay-sync-finances`,
    hObj,
    `'{"days_back": 30}'::jsonb`,
  ),
  httpPostJob(
    "analytics-aggregate-daily",
    "20 8 * * *",
    `${PROJECT_URL}/functions/v1/analytics-aggregate`,
    hObj,
    `'{"days": 30, "refresh": true}'::jsonb`,
  ),
  httpPostJob(
    "sync-instagram-insights",
    "0 */6 * * *",
    `${PROJECT_URL}/functions/v1/instagram-insights`,
    hObj,
    `'{"syncAll": false}'::jsonb`,
  ),
  httpPostJob(
    "sms-coupon-reminder",
    "30 * * * *",
    `${PROJECT_URL}/functions/v1/sms-coupon-reminder`,
    hObj,
  ),
  httpPostJob(
    "sms-abandoned-cart-check",
    "*/5 * * * *",
    `${PROJECT_URL}/functions/v1/sms-abandoned-cart`,
    hObj,
  ),
  httpPostJob(
    "sms-welcome-series",
    "45 * * * *",
    `${PROJECT_URL}/functions/v1/sms-welcome-series`,
    hObj,
  ),
];

if (cronSecret) {
  const cronH = authHeaderWithCronSecret(serviceKey, cronSecret);
  jobs.push(
    httpPostJob(
      "marketplace-observations-refresh-every-6h",
      "0 */6 * * *",
      `${PROJECT_URL}/functions/v1/marketplace-refresh-observations-cron`,
      cronH,
      `'{"days_back": 14}'::jsonb`,
    ),
    httpPostJob(
      "inventory-returns-restock-digest-daily",
      "0 14 * * *",
      `${PROJECT_URL}/functions/v1/inventory-returns-restock-digest`,
      cronH,
      `'{"mode":"send","run_type":"daily"}'::jsonb`,
    ),
    httpPostJob(
      "inventory-returns-restock-digest-weekly",
      "0 14 * * 1",
      `${PROJECT_URL}/functions/v1/inventory-returns-restock-digest`,
      cronH,
      `'{"mode":"send","run_type":"weekly"}'::jsonb`,
    ),
    // Phase 061B — drain sale-triggered cross-channel qty pushes (KK/eBay/Amazon).
    // preview:false = live when SALE_CHANNEL_SYNC_ENABLED + channel live gates are on.
    httpPostJob(
      "process-sale-channel-sync-queue-every-10m",
      "*/10 * * * *",
      `${PROJECT_URL}/functions/v1/process-sale-channel-sync-queue`,
      cronH,
      `'{"limit": 20, "preview": false, "workerId": "pg_cron_sale_sync"}'::jsonb`,
    ),
  );
} else {
  console.warn("CRON_SECRET not in .env — skipping digest + marketplace observation + sale sync crons.");
}

const sql = `-- Restore pg_cron jobs (generated by restore-pg-cron-jobs.mjs)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

${jobs.join("\n")}

SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
`;

const tmp = join(ROOT, "scripts/supabase/.restore-pg-cron-jobs.generated.sql");
writeFileSync(tmp, sql);

console.log(`Scheduling ${jobs.length} cron jobs…`);
const result = spawnSync(
  "npx",
  ["supabase@2.106.0", "db", "query", "--linked", "-f", tmp],
  { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" },
);

try {
  unlinkSync(tmp);
} catch {
  // ignore
}

if (result.status !== 0) {
  console.error(result.stdout || result.stderr || "restore failed");
  process.exit(1);
}

console.log(result.stdout?.trim() || "Done.");
console.log(`\nRestored ${jobs.length} pg_cron jobs.`);
