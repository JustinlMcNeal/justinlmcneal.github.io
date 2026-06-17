#!/usr/bin/env node
/**
 * Apply Phase 060 inventory SQL migrations to remote Supabase.
 *
 * Usage (from repo root):
 *   node scripts/supabase/apply-phase060-migrations.mjs
 *
 * Default: `npx supabase db query --linked` (no DB password required when CLI is linked).
 * Fallback: APPLY_MIGRATIONS_VIA=pg and SUPABASE_DB_PASSWORD.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectPgClient, runLinkedSql, runLinkedSqlFile } from "./dbConnect.mjs";

const MIGRATION_FILES = [
  "20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql",
  "20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql",
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");

function loadEnv() {
  try {
    for (const line of readFileSync(join(repoRoot, ".env"), "utf8").split("\n")) {
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

function viewsToDropBeforeMigration(sql) {
  const views = [];
  for (const match of sql.matchAll(/CREATE OR REPLACE VIEW\s+(public\.\w+)/gi)) {
    views.push(match[1]);
  }
  return views;
}

async function applyViaPg(files) {
  const client = await connectPgClient();
  console.log("Connected via session pooler");
  try {
    for (const file of files) {
      const path = join(migrationsDir, file);
      const sql = readFileSync(path, "utf8");
      process.stdout.write(`Applying ${file} ... `);
      for (const view of viewsToDropBeforeMigration(sql)) {
        await client.query(`DROP VIEW IF EXISTS ${view} CASCADE`);
      }
      await client.query(sql);
      console.log("ok");
    }
  } finally {
    await client.end();
  }
}

function applyViaLinked(files) {
  console.log("Using linked Supabase CLI (supabase db query --linked)");
  for (const file of files) {
    const path = join(migrationsDir, file);
    const sql = readFileSync(path, "utf8");
    process.stdout.write(`Applying ${file} ... `);
    for (const view of viewsToDropBeforeMigration(sql)) {
      runLinkedSql(`DROP VIEW IF EXISTS ${view} CASCADE`, repoRoot);
    }
    runLinkedSqlFile(path, repoRoot);
    console.log("ok");
  }
}

async function main() {
  const mode = process.env.APPLY_MIGRATIONS_VIA || "linked";
  if (mode === "pg") {
    await applyViaPg(MIGRATION_FILES);
  } else {
    applyViaLinked(MIGRATION_FILES);
  }
  console.log("\nPhase 060 migrations applied.");
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message || err);
  process.exit(1);
});
