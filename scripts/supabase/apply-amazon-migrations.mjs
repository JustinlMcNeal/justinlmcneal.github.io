#!/usr/bin/env node
/**
 * Apply KK Amazon SQL migrations directly to Supabase Postgres.
 *
 * Usage (from repo root):
 *   $env:SUPABASE_DB_PASSWORD="your-db-password"
 *   node scripts/supabase/apply-amazon-migrations.mjs
 *
 * Password: Supabase Dashboard → Project Settings → Database → Database password
 *
 * Note: This project often applies migrations outside schema_migrations history.
 * Files run in timestamp order; statements are idempotent where possible.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const PROJECT_REF = "yxdzvzscufkvewecvagq";

const MIGRATION_FILES = [
  "20260721_amazon_listings_schema.sql",
  "20260722_amazon_oauth_states.sql",
  "20260723_amazon_vault_read_rpc.sql",
  "20260724_amazon_unmapped_listings_view.sql",
  "20260725_amazon_drafts_issues_view.sql",
  "20260726_amazon_drafts_issues_view_ptd.sql",
  "20260727_amazon_drafts_issues_view_submit.sql",
  "20260728_amazon_ready_to_push_view.sql",
  "20260729_amazon_draft_verify_tracking.sql",
  "20260730_amazon_ready_to_push_eligibility.sql",
  "20260731_amazon_verify_max_attempts_alert.sql",
  "20260801_amazon_stale_listing_views.sql",
  "20260802_amazon_listing_profit_view.sql",
  "20260803_amazon_price_mismatch_view.sql",
  "20260804_amazon_inventory_mismatch_view.sql",
  "20260805_amazon_listing_health_view.sql",
  "20260806_amazon_fba_fulfillment_view.sql",
  "20260807_amazon_marketplaces_mx_ca.sql",
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");

function getConnectionString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error(
      "Set SUPABASE_DB_PASSWORD (or SUPABASE_DB_URL) before running.\n" +
        "Dashboard → Project Settings → Database → Database password",
    );
  }
  const encoded = encodeURIComponent(password);
  return `postgresql://postgres:${encoded}@db.${PROJECT_REF}.supabase.co:5432/postgres`;
}

function viewsToDropBeforeMigration(sql) {
  const views = [];
  for (const match of sql.matchAll(/CREATE OR REPLACE VIEW\s+(public\.\w+)/gi)) {
    views.push(match[1]);
  }
  return views;
}

async function main() {
  const startAt = process.argv[2] || "";
  const files = startAt
    ? MIGRATION_FILES.slice(MIGRATION_FILES.findIndex((file) => file.startsWith(startAt)))
    : MIGRATION_FILES;

  if (startAt && files.length === MIGRATION_FILES.length) {
    throw new Error(`Unknown migration prefix: ${startAt}`);
  }

  const client = new pg.Client({
    connectionString: getConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log(`Connected to Supabase Postgres (${PROJECT_REF})`);

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
    console.log("\nAll Amazon migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message || err);
  process.exit(1);
});
