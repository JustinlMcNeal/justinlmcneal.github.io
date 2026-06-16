#!/usr/bin/env node
/**
 * Phase 058 — eBay inventory column cache patch verification.
 * Run: node scripts/verify-inventory-ebay-column-cache.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectPgClient } from "./supabase/dbConnect.mjs";
import { runIssueViewSafetyChecks } from "./verify-inventory-issue-view-safety.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "supabase/migrations/20261022_inventory_phase058_ebay_workspace_column_cache.sql";

const FORBIDDEN_WORKSPACE_REFS = [
  "v_inventory_channel_sync_candidates",
  "v_inventory_issues_core",
  "v_inventory_bundle_component_return_workflow_guidance",
  "v_inventory_shipped_finalize_audit",
  "v_inventory_marketplace_restock_assist_candidates",
  "v_inventory_returns_restock_dashboard_summary",
  "inventory_issue_snapshots",
];

const REQUIRED_UI_FILES = [
  "js/admin/inventory/renderers/renderInventoryTable.js",
  "js/admin/inventory/services/mapWorkspaceRow.js",
  "js/admin/inventory/api/inventoryApi.js",
];

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifyMigrationSource() {
  const notes = [];
  const errors = [];
  if (!existsSync(join(ROOT, MIGRATION))) {
    errors.push(`Missing migration: ${MIGRATION}`);
    return { notes, errors };
  }
  const sql = read(MIGRATION).replace(/--[^\n]*/g, "");
  notes.push(`Migration present: ${MIGRATION.split("/").pop()}`);

  if (sql.includes("NULL::integer AS ebay_stock")) {
    errors.push("Migration still hardcodes NULL::integer AS ebay_stock");
  } else notes.push("Migration does not hardcode NULL ebay_stock");

  if (!sql.includes("ebay_listing_inventory_cache")) {
    errors.push("Migration must reference ebay_listing_inventory_cache");
  } else notes.push("Migration joins ebay_listing_inventory_cache");

  if (!sql.includes("ebay_stock_source")) {
    errors.push("Migration must expose ebay_stock_source");
  } else notes.push("Migration exposes ebay_stock_source metadata");

  for (const heavy of FORBIDDEN_WORKSPACE_REFS) {
    if (sql.includes(heavy)) {
      errors.push(`Workspace view must not reference heavy object: ${heavy}`);
    }
  }
  if (!errors.some((e) => e.includes("heavy object"))) {
    notes.push("No heavy issue/dashboard views in workspace migration");
  }

  return { notes, errors };
}

function verifyClientFiles() {
  const notes = [];
  const errors = [];

  const table = read("js/admin/inventory/renderers/renderInventoryTable.js");
  if (!table.includes("ebayChannelCell")) errors.push("renderInventoryTable missing ebayChannelCell");
  else notes.push("UI: ebayChannelCell renderer present");

  if (!table.includes("open-sync-channels")) {
    errors.push("renderInventoryTable missing Sync Channels action link");
  } else notes.push("UI: Sync Channels link in eBay column");

  if (table.includes("sync-ebay-listing-inventory-cache")) {
    errors.push("Inventory table must not call eBay cache edge function on load");
  } else notes.push("UI: no eBay API edge function on table render");

  const api = read("js/admin/inventory/api/inventoryApi.js");
  if (!api.includes("ebay_stock_source")) {
    errors.push("inventoryApi WORKSPACE_SELECT missing ebay metadata fields");
  } else notes.push("API: workspace select includes ebay cache metadata");

  const events = read("js/admin/inventory/events.js");
  if (!events.includes('action === "open-sync-channels"')) {
    errors.push("events.js missing open-sync-channels handler");
  } else notes.push("Events: open-sync-channels wired");

  for (const rel of REQUIRED_UI_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
  }

  return { notes, errors };
}

async function verifyLiveDb() {
  const notes = [];
  const errors = [];
  let client;
  try {
    client = await connectPgClient();
  } catch (err) {
    notes.push(`DB skipped: ${err instanceof Error ? err.message : String(err)}`);
    return { notes, errors };
  }

  try {
    const def = await client.query(`
      SELECT pg_get_viewdef('public.v_inventory_workspace'::regclass, true) AS def
    `);
    const viewSql = def.rows[0]?.def || "";
    if (viewSql.includes("NULL::integer AS ebay_stock")) {
      errors.push("Live v_inventory_workspace still hardcodes NULL ebay_stock — apply migration");
    } else notes.push("Live workspace view uses computed ebay_stock");

    if (!viewSql.includes("ebay_listing_inventory_cache")) {
      errors.push("Live workspace view missing ebay_listing_inventory_cache join");
    } else notes.push("Live workspace joins ebay cache table");

    for (const heavy of FORBIDDEN_WORKSPACE_REFS) {
      if (viewSql.includes(heavy)) {
        errors.push(`Live workspace references forbidden object: ${heavy}`);
      }
    }

    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_inventory_workspace'
        AND column_name IN ('ebay_stock', 'ebay_stock_source', 'ebay_stock_is_stale', 'ebay_stock_tooltip')
      ORDER BY column_name
    `);
    const names = cols.rows.map((r) => r.column_name);
    for (const c of ["ebay_stock", "ebay_stock_source", "ebay_stock_is_stale", "ebay_stock_tooltip"]) {
      if (!names.includes(c)) errors.push(`Live workspace missing column: ${c}`);
    }
    if (names.length === 4) notes.push("Live workspace has all ebay metadata columns");

    const cachedZero = await client.query(`
      SELECT COUNT(*)::int AS n FROM v_inventory_workspace WHERE ebay_stock = 0
    `);
    notes.push(`Live rows with cached ebay_stock=0: ${cachedZero.rows[0]?.n ?? "?"}`);

    const missingDash = await client.query(`
      SELECT COUNT(*)::int AS n FROM v_inventory_workspace WHERE ebay_stock IS NULL
    `);
    notes.push(`Live rows with ebay_stock NULL (UI —): ${missingDash.rows[0]?.n ?? "?"}`);
  } finally {
    await client.end().catch(() => {});
  }

  return { notes, errors };
}

async function main() {
  const allNotes = [];
  const allErrors = [];

  for (const fn of [verifyMigrationSource, verifyClientFiles]) {
    const { notes, errors } = fn();
    allNotes.push(...notes);
    allErrors.push(...errors);
  }

  const db = await verifyLiveDb();
  allNotes.push(...db.notes);
  allErrors.push(...db.errors);

  try {
    const safety = await runIssueViewSafetyChecks();
    allNotes.push(...(safety.notes || []));
    allErrors.push(...(safety.errors || []));
  } catch (err) {
    allNotes.push(`Issue view safety: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("=== verify-inventory-ebay-column-cache ===\n");
  for (const n of allNotes) console.log(`  ✓ ${n}`);
  for (const e of allErrors) console.log(`  ✗ ${e}`);

  if (allErrors.length) {
    console.log(`\nFAIL (${allErrors.length} error(s))`);
    process.exit(1);
  }
  console.log("\nPASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
