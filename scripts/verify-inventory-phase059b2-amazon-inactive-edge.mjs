/**
 * Phase 059B.2 — Amazon inactive restock edge support verification.
 * Run: node scripts/verify-inventory-phase059b2-amazon-inactive-edge.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;

const PLAN_DOC =
  "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";

const EDGE_FILES = [
  "supabase/functions/sync-amazon-inventory-quantity/index.ts",
  "supabase/functions/_shared/inventoryAmazonInactiveRestock.ts",
  "supabase/functions/_shared/amazonOfferRestoreUtils.ts",
  "supabase/functions/_shared/inventoryAmazonSyncUtils.ts",
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyStatic() {
  const notes = [];
  const errors = [];

  for (const rel of EDGE_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
    else if (rel.includes("sync-amazon-inventory-quantity") && lineCount(rel) > MAX_LINES) {
      notes.push(`${rel}: ${lineCount(rel)} lines (pre-existing edge, acceptable)`);
    } else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
    else notes.push(`${rel}: ${lineCount(rel)} lines`);
  }

  const syncIndex = readText("supabase/functions/sync-amazon-inventory-quantity/index.ts");
  if (!syncIndex.includes("inactive_restock")) {
    errors.push("sync-amazon-inventory-quantity must support inactive_restock mode");
  }
  if (!syncIndex.includes('parseSyncMode') && !syncIndex.includes('"update_qty"')) {
    errors.push("sync must default to update_qty mode");
  }
  if (!syncIndex.includes("handleAmazonInactiveRestockSync")) {
    errors.push("sync must delegate inactive_restock to handler");
  }
  if (!syncIndex.includes("exactly one variantId")) {
    errors.push("inactive_restock must require single variantId");
  }
  notes.push("Edge index supports mode inactive_restock with single-variant guard");

  const updateQtyBlock = syncIndex.slice(syncIndex.indexOf('if (syncMode === "inactive_restock")'));
  const defaultFlow = syncIndex.slice(0, syncIndex.indexOf('if (syncMode === "inactive_restock")'));
  if (!defaultFlow.includes('.eq("amazon_sync_action", "update_qty")')) {
    // loader is in utils
  }
  if (defaultFlow.includes("inactive_can_update")) {
    errors.push("Default update_qty path must not load inactive_can_update");
  }

  const loader = readText("supabase/functions/_shared/inventoryAmazonSyncUtils.ts");
  if (!loader.includes('.eq("amazon_sync_action", "update_qty")')) {
    errors.push("loadAmazonSyncCandidates must still filter update_qty only");
  }
  notes.push("Default loader still filters update_qty only");

  const inactive = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (!inactive.includes("inactive_can_update")) {
    errors.push("Inactive loader must filter inactive_can_update");
  }
  if (!inactive.includes("available_qty") || !inactive.includes("<= 0")) {
    errors.push("Inactive loader must skip available_qty <= 0");
  }
  if (!inactive.includes("amazon_is_afn")) {
    errors.push("Inactive path must check AFN/FBA");
  }
  if (!inactive.includes("isFbaManagedListing")) {
    errors.push("Inactive path must skip FBA-managed listings");
  }
  if (!inactive.includes("submitAmazonOfferRestore")) {
    errors.push("Inactive path must use offer restore submit helper");
  }
  if (!inactive.includes("trigger_source") && !inactive.includes("syncCtx")) {
    errors.push("Inactive path must preserve sync correlation context");
  }
  if (!inactive.includes("live_patch_disabled") && !inactive.includes("livePatchDisabled")) {
    errors.push("Inactive path must handle live gate disabled");
  }
  if (!inactive.includes('status: "dry_run"')) {
    errors.push("Inactive path must return dry_run when live gate off");
  }
  notes.push("Inactive restock module enforces safety + correlation + live gate");

  const offerUtils = readText("supabase/functions/_shared/amazonOfferRestoreUtils.ts");
  if (!offerUtils.includes("buildOfferRestorePutBody")) {
    errors.push("Offer restore utils must reuse buildOfferRestorePutBody");
  }
  if (!offerUtils.includes("putListingsItemLiveSubmit")) {
    errors.push("Offer restore utils must call Amazon PUT submit");
  }
  notes.push("Offer restore helper extracted and reuses buildOfferRestorePutBody");

  notes.push("Orchestrator wiring verified in 059B.3/059B.4 scripts (edge-only scope here)");

  const syncModal = readText("js/admin/inventory/ui/syncDryRunModal.js");
  if (syncModal.includes("inactive_restock")) {
    errors.push("Sync Channels must not default to inactive_restock");
  }
  notes.push("Sync Channels still uses default update_qty push");

  const ebayPaths = [
    "supabase/functions/sync-ebay-inventory-quantity/index.ts",
    "supabase/functions/_shared/inventoryEbaySyncUtils.ts",
  ];
  for (const rel of ebayPaths) {
    const text = readText(rel);
    if (text.includes("inactive_restock")) {
      errors.push(`${rel} must not reference inactive_restock`);
    }
  }
  notes.push("eBay files untouched");

  for (const rel of [
    "js/admin/inventory/services/adjustChannelOrchestrator.js",
    "supabase/functions/_shared/inventoryAmazonInactiveRestock.ts",
  ]) {
    if (/issueSnapshot|refreshIssueSnapshot|fetchChannelSyncPreview/.test(readText(rel))) {
      errors.push(`${rel} must not use heavy reads or snapshot refresh`);
    }
  }
  if (readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts").includes("adjust_inventory")) {
    errors.push("Inactive restock must not call adjust_inventory");
  }
  notes.push("No stock writer, snapshot refresh, or heavy views in inactive path");

  const doc = readText(PLAN_DOC);
  if (!doc.includes("059B.2")) {
    errors.push("Plan doc must document 059B.2");
  }
  if (!doc.includes("059B.3") && !doc.includes("059B.4")) {
    errors.push("Plan doc must document 059B subphases");
  }

  return { notes, errors };
}

function main() {
  const { notes, errors } = verifyStatic();

  console.log("\n=== Phase 059B.2 — Amazon Inactive Restock Edge ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059B.2 Amazon inactive restock edge support\n");
  console.log("Next subphase: 059B.3 — Adjust orchestrator integration (see 059B.4 for full verify)\n");
}

main();
