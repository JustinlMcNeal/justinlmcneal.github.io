#!/usr/bin/env node
/**
 * Apply inventory Returns/Restock migrations (10Q–10X + prerequisites) via linked CLI.
 * Usage: node scripts/supabase/apply-inventory-returns-migrations.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectPgClient, runLinkedSql, runLinkedSqlFile } from "./dbConnect.mjs";

const MIGRATION_FILES = [
  "20260822_approve_parcel_import_cpi_fx_guard.sql",
  "20260822_update_order_summary_landed_cpi.sql",
  "20260823_inventory_phase3a_read_views.sql",
  "20260824_inventory_phase3b_workspace_issues.sql",
  "20260825_inventory_phase3c_channel_status.sql",
  "20260826_inventory_phase4_adjust_inventory.sql",
  "20260827_inventory_phase5_parcel_receive_summary.sql",
  "20260828_inventory_phase6b_reservations_read.sql",
  "20260829_inventory_phase6c_stripe_idempotency_shadow.sql",
  "20260830_inventory_phase6d_prep_cutover_readiness.sql",
  "20260831_inventory_phase6d_validation_readiness.sql",
  "20260901_inventory_phase6d_execute_cutover.sql",
  "20260902_inventory_phase6e_fulfillment_finalize.sql",
  "20260903_inventory_phase7a_channel_sync_candidates.sql",
  "20260904_inventory_phase7b_kk_available_stock.sql",
  "20260905_inventory_phase7c_channel_sync_logs.sql",
  "20260906_inventory_phase7d_ebay_cache.sql",
  "20260907_inventory_phase7e_ebay_relist_assist.sql",
  "20260908_inventory_phase7f_ebay_quantity_sync.sql",
  "20260909_inventory_phase8a_issue_workflows.sql",
  "20260910_inventory_phase8b_issue_resolution_tracking.sql",
  "20260911_inventory_phase8c_mapping_assist.sql",
  "20260912_inventory_phase8d_reservation_retry.sql",
  "20260913_inventory_phase8e_shipped_finalize_audit.sql",
  "20260914_inventory_phase8f_manual_finalize_assist.sql",
  "20260915_inventory_phase8g_ebay_safe_mapping_hints.sql",
  "20260916_inventory_phase8h_bulk_mapping_visibility.sql",
  "20260917_inventory_phase9a_post_map_workflow_assist.sql",
  "20260918_inventory_phase9b_post_map_action_queue.sql",
  "20260919_inventory_phase9c_queue_resolution_assist.sql",
  "20260920_inventory_phase10a_bundle_preview.sql",
  "20260921_inventory_phase10b_bundle_rule_management.sql",
  "20260922_inventory_phase10c_virtual_bundle_shadow.sql",
  "20260923_inventory_phase10d_checkout_shadow.sql",
  "20260924_inventory_phase10e_live_readiness.sql",
  "20260924_inventory_phase10e_live_readiness_view.sql",
  "20260925_inventory_phase10f_live_bundle_core.sql",
  "20260925_inventory_phase10f_live_bundle_issues.sql",
  "20260925_inventory_phase10f_live_bundle_views.sql",
  "20260926_inventory_phase10g_bundle_component_returns_restock.sql",
  "20260926_inventory_phase10g_returns_issues.sql",
  "20260927_inventory_phase10h_return_guidance.sql",
  "20260928_inventory_phase10j_return_workflow_issues.sql",
  "20260928_inventory_phase10j_rma_return_workflow.sql",
  "20260929_inventory_phase10k_order_refund_details.sql",
  "20260929_inventory_phase10k_refund_issues.sql",
  "20261001_inventory_phase10l_refund_sync_source.sql",
  "20261002_inventory_phase10m_marketplace_refund_observations.sql",
  "20261002_inventory_phase10m_return_guidance_marketplace.sql",
  "20261003_inventory_phase10m_marketplace_issues.sql",
  "20261004_inventory_phase10n_marketplace_refund_observations_table.sql",
  "20261005_inventory_phase10n_backfill_rpc.sql",
  "20261006_inventory_phase10n_observations_view.sql",
  "20261007_inventory_phase10n_return_guidance_persisted.sql",
  "20261008_inventory_phase10o_line_extraction_backfill.sql",
  "20261009_inventory_phase10o_return_guidance_line_level.sql",
  "20261010_inventory_phase10p_observation_cron_webhooks.sql",
  "20261011_inventory_phase10q_marketplace_restock_assist.sql",
  "20261012_inventory_phase10r_marketplace_restock_assist_queue.sql",
  "20261013_inventory_phase10s_restock_assist_audit_analytics.sql",
  "20261014_inventory_phase10t_restock_channel_followup.sql",
  "20261015_inventory_phase10u_returns_restock_dashboard.sql",
  "20261016_inventory_phase10v_dashboard_deeplinks_exports.sql",
  "20261017_inventory_phase10w_returns_restock_digest.sql",
  "20261018_inventory_phase10x_dashboard_pagination.sql",
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

async function objectExists(client, name, kind) {
  if (kind === "function") {
    const r = await client.query(`SELECT 1 FROM pg_proc WHERE proname = $1`, [name]);
    return r.rows.length > 0;
  }
  if (kind === "view") {
    const r = await client.query(
      `SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = $1`,
      [name],
    );
    return r.rows.length > 0;
  }
  return false;
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

async function applyViaLinked(files) {
  console.log("Using linked Supabase CLI");
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

async function verify(client) {
  const checks = [
    ["v_inventory_returns_restock_dashboard_worklist", "view"],
    ["v_inventory_returns_restock_dashboard_summary", "view"],
    ["get_returns_restock_dashboard_worklist_page", "function"],
    ["v_inventory_returns_restock_digest_summary", "view"],
  ];
  for (const [name, kind] of checks) {
    const ok = await objectExists(client, name, kind);
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    if (!ok) throw new Error(`Missing after deploy: ${name}`);
  }
}

async function main() {
  const mode = process.env.APPLY_MIGRATIONS_VIA || "linked";
  const files = MIGRATION_FILES;

  if (mode === "pg") {
    await applyViaPg(files);
    const client = await connectPgClient();
    try {
      console.log("\nPost-deploy checks:");
      await verify(client);
    } finally {
      await client.end();
    }
  } else {
    await applyViaLinked(files);
    if (process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_DB_URL) {
      const client = await connectPgClient();
      try {
        console.log("\nPost-deploy checks:");
        await verify(client);
      } finally {
        await client.end();
      }
    } else {
      console.log("\nPost-deploy checks skipped (set SUPABASE_DB_PASSWORD for pg verify)");
    }
  }

  console.log("\nInventory Returns/Restock migrations applied.");
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message || err);
  process.exit(1);
});
