/**
 * Phase 059B.1 — Amazon inactive restock audit + design alignment.
 * Verifies audit documentation and that Option A was implemented per design.
 *
 * Run: node scripts/verify-inventory-phase059b1-amazon-inactive-audit.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PLAN_DOC =
  "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";

const REQUIRED_DOC_SECTIONS = [
  "059B.1 — Amazon inactive audit + edge design ✅",
  "Audit findings — how `inactive_can_update` is determined",
  "Audit findings — current 7C sync excludes inactive listings",
  "Audit findings — existing offer restore",
  "Selected implementation approach for 059B.2",
  "Safety rules (059B — mandatory)",
  "Failure handling (059B)",
  "Verification plan — 059B.2 through 059B.5",
  "buildOfferRestorePutBody",
  "mode?: \"update_qty\" | \"inactive_restock\"",
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifyDoc() {
  const notes = [];
  const errors = [];

  if (!existsSync(join(ROOT, PLAN_DOC))) {
    errors.push(`Missing plan doc: ${PLAN_DOC}`);
    return { notes, errors };
  }

  const doc = readText(PLAN_DOC);

  if (!doc.includes("059B.1 complete") && !doc.includes("059B.1 — Amazon inactive audit")) {
    errors.push("Plan doc must document 059B.1 audit");
  }
  if (!doc.includes("059A") || !doc.includes("frozen")) {
    errors.push("Plan doc must preserve 059A frozen guardrails");
  }

  for (const section of REQUIRED_DOC_SECTIONS) {
    if (!doc.includes(section)) {
      errors.push(`Plan doc missing audit section: ${section}`);
    }
  }
  notes.push("059B.1 audit section present in plan doc");

  if (!doc.includes("Option A — extend `sync-amazon-inventory-quantity`")) {
    errors.push("Plan doc must document Option A for 059B.2");
  }
  notes.push("Implementation approach documented (Option A extend existing sync)");

  return { notes, errors };
}

function verifyDesignImplementation() {
  const notes = [];
  const errors = [];

  const syncIndex = readText("supabase/functions/sync-amazon-inventory-quantity/index.ts");
  if (!syncIndex.includes("inactive_restock")) {
    errors.push("sync-amazon-inventory-quantity must implement inactive_restock (Option A)");
  }
  if (!syncIndex.includes("handleAmazonInactiveRestockSync")) {
    errors.push("sync must delegate inactive_restock to handler");
  }
  notes.push("Option A implemented: sync-amazon-inventory-quantity inactive_restock mode");

  if (!existsSync(join(ROOT, "supabase/functions/_shared/inventoryAmazonInactiveRestock.ts"))) {
    errors.push("Missing inventoryAmazonInactiveRestock.ts");
  }
  if (!existsSync(join(ROOT, "supabase/functions/_shared/amazonOfferRestoreUtils.ts"))) {
    errors.push("Missing amazonOfferRestoreUtils.ts");
  }
  notes.push("Inactive restock shared modules present");

  const offerUtils = readText("supabase/functions/_shared/amazonOfferRestoreUtils.ts");
  if (!offerUtils.includes("buildOfferRestorePutBody")) {
    errors.push("Offer restore must reuse buildOfferRestorePutBody");
  }
  notes.push("Offer restore reuses buildOfferRestorePutBody per audit");

  const loader = readText("supabase/functions/_shared/inventoryAmazonSyncUtils.ts");
  if (!loader.includes('.eq("amazon_sync_action", "update_qty")')) {
    errors.push("loadAmazonSyncCandidates must still filter update_qty only for bulk sync");
  }
  notes.push("7C bulk sync loader still excludes inactive_can_update (by design)");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (!orch.includes('mode: "inactive_restock"')) {
    errors.push("Orchestrator must wire inactive_restock (059B.3+)");
  }
  notes.push("Adjust orchestrator wires inactive_can_update via inactive_restock");

  return { notes, errors };
}

function verifyRoadmap() {
  const notes = [];
  const errors = [];
  const roadmap = readText("docs/pages/admin/inventory/implementation/roadmap.md");
  if (!roadmap.includes("B.1")) {
    errors.push("roadmap.md must reference 059B subphases");
  }
  if (!roadmap.includes("059B") || !roadmap.includes("059C")) {
    errors.push("roadmap.md must list 059B and 059C");
  }
  notes.push("roadmap.md includes 059B phase index");
  return { notes, errors };
}

function main() {
  const doc = verifyDoc();
  const impl = verifyDesignImplementation();
  const roadmap = verifyRoadmap();

  const notes = [...doc.notes, ...impl.notes, ...roadmap.notes];
  const errors = [...doc.errors, ...impl.errors, ...roadmap.errors];

  console.log("\n=== Phase 059B.1 — Amazon Inactive Restock Audit ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059B.1 audit/design alignment verified\n");
}

main();
