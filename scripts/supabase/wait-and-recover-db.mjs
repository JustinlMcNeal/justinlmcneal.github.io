#!/usr/bin/env node
/**
 * Wait for Supabase DB to respond, then run emergency-recover-db.sql and restore crons.
 * Use after inventory page timeouts / connection pool exhaustion.
 *
 *   node scripts/supabase/wait-and-recover-db.mjs
 */
import { readFileSync } from "node:fs";
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

async function probeRest() {
  const env = loadEnv();
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${PROJECT_URL}/rest/v1/site_settings?select=key&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function runCli(args) {
  const result = spawnSync("npx", ["supabase@2.106.0", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return result;
}

async function main() {
  console.log("Waiting for Supabase REST to respond (restart DB in dashboard if stuck)…\n");

  for (let attempt = 1; attempt <= 30; attempt++) {
    const ok = await probeRest();
    if (ok) {
      console.log(`REST OK on attempt ${attempt}. Running emergency recovery…\n`);
      break;
    }
    console.log(`Attempt ${attempt}/30 — still down, retrying in 10s…`);
    if (attempt === 30) {
      console.error("\nDB still unreachable. Restart Postgres in Supabase Dashboard → Settings → Database, then re-run this script.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }

  const sqlFile = join(ROOT, "scripts/supabase/emergency-recover-db.sql");
  const recover = runCli(["db", "query", "--linked", "-f", sqlFile]);
  if (recover.status !== 0) {
    console.error("Emergency SQL failed:\n", recover.stdout || recover.stderr);
    console.error("\nIf CLI times out, paste scripts/supabase/emergency-recover-db.sql into Supabase Dashboard → SQL Editor.");
    process.exit(1);
  }
  console.log(recover.stdout?.trim() || "Emergency SQL applied.");

  console.log("\nApplying Phase 10AA permanent issues architecture (if not already live)…");
  const phase10aa = join(ROOT, "supabase/migrations/20261020_inventory_phase10aa_issues_snapshot.sql");
  const phase10ab = join(ROOT, "supabase/migrations/20261021_inventory_phase10ab_missing_sku_product_code.sql");
  for (const file of [phase10aa, phase10ab]) {
    const mig = runCli(["db", "query", "--linked", "-f", file]);
    if (mig.status !== 0) {
      console.warn(`Warning: ${file} may have partially failed (check if already applied):\n`, mig.stdout || mig.stderr);
    } else {
      console.log(`Applied: ${file.split(/[/\\]/).pop()}`);
    }
  }

  console.log("\nRestoring pg_cron jobs…");
  const cron = spawnSync("node", ["scripts/supabase/restore-pg-cron-jobs.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  console.log(cron.stdout?.trim() || cron.stderr?.trim() || "Cron restore finished.");

  console.log("\nDone. Hard-refresh inventory page. Phase 10AA snapshot architecture is the permanent fix — do not re-apply phase 10Z.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
