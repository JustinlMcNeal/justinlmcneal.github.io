#!/usr/bin/env node
/**
 * Schedule (or replace) the sale-channel sync queue worker cron.
 * Run: node scripts/supabase/schedule-sale-channel-sync-cron.mjs
 *
 * Uses linked project via `supabase db query --linked`.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PROJECT_URL = "https://yxdzvzscufkvewecvagq.supabase.co";
const JOB_NAME = "process-sale-channel-sync-queue-every-10m";

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

function esc(s) {
  return String(s).replace(/'/g, "''");
}

const env = loadEnv();
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = env.CRON_SECRET || process.env.CRON_SECRET;

if (!serviceKey || !cronSecret) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY or CRON_SECRET in .env");
  process.exit(1);
}

const sql = `-- schedule-sale-channel-sync-cron.mjs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${JOB_NAME}') THEN
    PERFORM cron.unschedule('${JOB_NAME}');
  END IF;
END $$;

SELECT cron.schedule(
  '${JOB_NAME}',
  '*/10 * * * *',
  $$SELECT net.http_post(
    url := '${PROJECT_URL}/functions/v1/process-sale-channel-sync-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ${esc(serviceKey)}',
      'Content-Type', 'application/json',
      'x-cron-secret', '${esc(cronSecret)}'
    ),
    body := '{"limit": 20, "preview": false, "workerId": "pg_cron_sale_sync"}'::jsonb
  )$$
);

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = '${JOB_NAME}';
`;

const tmp = join(ROOT, "scripts/supabase/.schedule-sale-channel-sync-cron.generated.sql");
writeFileSync(tmp, sql);

console.log(`Scheduling ${JOB_NAME}…`);
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
  console.error(result.stdout || result.stderr || "schedule failed");
  process.exit(1);
}

console.log(result.stdout?.trim() || "Done.");
