#!/usr/bin/env node
/**
 * Apply KK Amazon SQL migrations to remote Supabase Postgres.
 *
 * Usage (from repo root):
 *   node scripts/supabase/apply-amazon-migrations.mjs
 *   node scripts/supabase/apply-amazon-migrations.mjs 20260812
 *
 * Default: uses `npx supabase db query --linked` (Management API — no DB password needed).
 * Fallback: set APPLY_MIGRATIONS_VIA=pg and SUPABASE_DB_PASSWORD for pooler connection.
 *
 * If using pg mode, this project is in West US (Oregon):
 *   pooler host aws-0-us-west-2.pooler.supabase.com, user postgres.yxdzvzscufkvewecvagq
 * Direct db.*.supabase.co is IPv6-only and often fails on Windows (ETIMEDOUT).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectPgClient,
  runLinkedSql,
  runLinkedSqlFile,
} from "./dbConnect.mjs";

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
  "20260808_amazon_listing_main_image_url.sql",
  "20260809_amazon_missing_offer_health.sql",
  "20260810_amazon_manual_price_and_sku_absent.sql",
  "20260811_amazon_live_offer_price_view.sql",
  "20260812_amazon_orders_phase_bc.sql",
  "20260813_amazon_variants_phase1.sql",
  "20260814_amazon_variants_phase2.sql",
  "20260816_amazon_drafts_issues_verify_columns.sql",
  "20260817_amazon_ready_to_push_parent_draft.sql",
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");

function viewsToDropBeforeMigration(sql) {
  const views = [];
  for (const match of sql.matchAll(/CREATE OR REPLACE VIEW\s+(public\.\w+)/gi)) {
    views.push(match[1]);
  }
  return views;
}

async function applyViaPg(files) {
  const client = await connectPgClient();
  console.log("Connected via session pooler (aws-0-us-west-2)");

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

async function applyViaLinked(files) {
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
  const startAt = process.argv[2] || "";
  const files = startAt
    ? MIGRATION_FILES.slice(MIGRATION_FILES.findIndex((file) => file.startsWith(startAt)))
    : MIGRATION_FILES;

  if (startAt && files.length === MIGRATION_FILES.length) {
    throw new Error(`Unknown migration prefix: ${startAt}`);
  }

  const mode = process.env.APPLY_MIGRATIONS_VIA || "linked";

  if (mode === "pg") {
    await applyViaPg(files);
  } else {
    await applyViaLinked(files);
  }

  console.log("\nAll Amazon migrations applied.");
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message || err);
  process.exit(1);
});
