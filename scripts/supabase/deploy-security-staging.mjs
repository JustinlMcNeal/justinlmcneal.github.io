#!/usr/bin/env node
/**
 * Apply security phase migrations (20261101–20261104) to linked/staging DB.
 * Run: node scripts/supabase/deploy-security-staging.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { connectPgClient, runLinkedSqlFile, PROJECT_REF } from "./dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const MIGRATIONS = [
  "20261101_security_phase1_rpc_secret_lockdown.sql",
  "20261102_security_phase2_core_rls.sql",
  "20261103_security_phase3_security_invoker_views.sql",
  "20261104_security_phase4_policy_function_storage_hardening.sql",
  "20261105_security_hotfix_public_execute_and_storefront_stock.sql",
  "20261106_security_storefront_stock_function_grant.sql",
];

function loadEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0 && !process.env[t.slice(0, i).trim()]) {
      process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
}

async function isApplied(client, version) {
  const { rows } = await client.query(
    "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1",
    [version],
  );
  return rows.length > 0;
}

async function markApplied(client, version) {
  await client.query(
    "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
    [version],
  );
}

async function applyViaPg() {
  loadEnv();
  const client = await connectPgClient();
  const applied = [];
  try {
    for (const file of MIGRATIONS) {
      const version = file.split("_")[0];
      const path = join(ROOT, "supabase/migrations", file);
      if (!existsSync(path)) throw new Error(`Missing ${file}`);

      if (await isApplied(client, version)) {
        console.log(`skip ${file} (already applied)`);
        continue;
      }

      console.log(`apply ${file} ...`);
      const sql = readFileSync(path, "utf8");
      await client.query(sql);
      await markApplied(client, version);
      applied.push(file);
      console.log(`ok ${file}`);
    }
  } finally {
    await client.end();
  }
  return applied;
}

function applyViaCli() {
  const applied = [];
  for (const file of MIGRATIONS) {
    const path = join(ROOT, "supabase/migrations", file);
    if (!existsSync(path)) throw new Error(`Missing ${file}`);
    console.log(`apply via CLI ${file} ...`);
    runLinkedSqlFile(path, ROOT);
    applied.push(file);
    console.log(`ok ${file}`);
  }
  return applied;
}

async function main() {
  console.log(`Security migrations → project ${PROJECT_REF}\n`);
  try {
    const applied = await applyViaPg();
    console.log(`\nDone (${applied.length} new migration(s) via pooler).`);
  } catch (err) {
    console.warn(`Pooler apply failed: ${err.message}`);
    console.warn("Falling back to: npx supabase db query --linked -f ...\n");
    const applied = applyViaCli();
    console.log(`\nDone (${applied.length} migration(s) via linked CLI).`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
