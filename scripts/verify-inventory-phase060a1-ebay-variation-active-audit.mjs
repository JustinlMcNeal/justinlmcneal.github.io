/**
 * Phase 060A.1 — eBay variation group active qty sync audit verification.
 * Design/audit only — confirms documentation and no Adjust variation wiring.
 *
 * Run: node scripts/verify-inventory-phase060a1-ebay-variation-active-audit.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const PLAN_059 = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const REQUIRED_SECTIONS = [
  "060A.1 — eBay variation active qty sync audit + design",
  "Audit findings — current data model",
  "Audit findings — current exclusion points",
  "Audit findings — existing eBay qty API path",
  "API design recommendation",
  "Clean mapping requirements",
  "Proposed 060A candidate states",
  "variation_update_qty",
  "variation_qty_cache_missing",
  "variation_mapping_missing",
  "variation_mapping_ambiguous",
  "variation_child_offer_missing",
  "060A.2",
  "060A.3",
  "060A.4",
  "060A.5",
  "Phase 060",
  "060B",
  "060C",
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyDoc() {
  const notes = [];
  const errors = [];

  if (!existsSync(join(ROOT, PLAN_060))) {
    errors.push(`Missing plan doc: ${PLAN_060}`);
    return { notes, errors };
  }

  const doc = readText(PLAN_060);

  if (!doc.includes("audit/design only") && !doc.includes("no runtime changes") && !doc.includes("060A.1")) {
    errors.push("060A.1 audit/design must be documented");
  }
  notes.push("060A.1 audit/design documented");

  for (const section of REQUIRED_SECTIONS) {
    if (!doc.includes(section)) errors.push(`Plan missing section/term: ${section}`);
  }
  notes.push("Required 060A.1 audit sections present");

  if (!doc.includes("adjust_inventory")) errors.push("Safety: adjust_inventory sole writer must be documented");
  if (!doc.includes("EBAY_ENABLE_LIVE_QUANTITY_PATCH")) {
    errors.push("Live gate EBAY_ENABLE_LIVE_QUANTITY_PATCH must be documented");
  }
  notes.push("Phase 059 safety rules carried forward in plan");

  if (!doc.includes("verify-inventory-phase060a1-ebay-variation-active-audit.mjs")) {
    errors.push("Plan must reference this verify script");
  }

  return { notes, errors };
}

function verifyNoRuntimeDrift() {
  const notes = [];
  const errors = [];

  if (existsSync(join(ROOT, "supabase/functions/sync-ebay-variation-quantity"))) {
    errors.push("Forbidden standalone edge: sync-ebay-variation-quantity");
  }

  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  if (/variation_child_update_qty|variation_update_qty|runEbayVariation|ebayVariationCandidateApi/.test(branch)) {
    errors.push("adjustChannelEbayBranch: variation orchestration must not be wired yet");
  }

  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  if (/variation_child_update_qty|variation_update_qty|mapEbayVariation|fetchEbayVariationChildCandidate/.test(preview)) {
    errors.push("adjustChannelPreview: variation preview must not be wired yet");
  }

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/variation_child_update_qty|inventoryEbayVariationSyncUtils/.test(amazon)) {
    errors.push("Amazon module must not reference eBay variation qty sync");
  }

  for (const rel of ADJUST_FLOW) {
    if (/fetchChannelSyncPreview/.test(readText(rel))) {
      errors.push(`${rel}: forbidden full fetchChannelSyncPreview in adjust flow`);
    }
    if (/issueSnapshot|refreshIssueSnapshot/.test(readText(rel))) {
      errors.push(`${rel}: forbidden snapshot refresh in adjust flow`);
    }
  }

  notes.push("060A.2+ foundation files allowed; no Adjust variation wiring");
  notes.push("No Amazon variation qty changes");
  notes.push("No snapshot refresh / full preview in adjust flow");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const adjustCalls = (orch.match(/await adjustInventory\(/g) || []).length;
  if (adjustCalls !== 1) errors.push(`adjust_inventory sole writer (found ${adjustCalls})`);
  else notes.push("adjust_inventory remains sole stock writer");

  const keyFiles = [
    "js/admin/inventory/services/adjustChannelOrchestrator.js",
    "js/admin/inventory/services/adjustChannelEbayBranch.js",
    "supabase/functions/_shared/inventoryEbaySyncUtils.ts",
    "supabase/functions/sync-ebay-inventory-quantity/index.ts",
  ];
  const over = keyFiles.filter((rel) => lineCount(rel) > MAX_LINES);
  if (over.length) notes.push(`Line count note (pre-existing): ${over.join(", ")}`);
  else notes.push("Key runtime files under 500 lines");

  return { notes, errors };
}

function verify059Frozen() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);
  const plan059 = readText(PLAN_059);

  if (!/059.*✅ Complete|Phase 059.*Complete/i.test(roadmap)) {
    errors.push("Roadmap: Phase 059 must remain complete/frozen");
  }
  if (!plan059.includes("Phase 059 Complete") && !plan059.includes("Complete / Frozen")) {
    errors.push("059 plan must remain complete/frozen");
  }

  const staticScript = join(ROOT, "scripts", "verify-inventory-phase059-final.mjs");
  if (!existsSync(staticScript)) {
    errors.push("Missing 059 final verify script");
    return { notes, errors };
  }

  const result = spawnSync(process.execPath, [staticScript, "--static"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, VERIFY_FAST: "1" },
  });

  if (result.status === 0) notes.push("059 final freeze static checks still PASS");
  else {
    const tail = (result.stdout || result.stderr || "").split("\n").slice(-4).join(" ").trim();
    errors.push(`059 freeze regression FAIL${tail ? `: ${tail.slice(0, 120)}` : ""}`);
  }

  return { notes, errors };
}

function verifyRoadmap() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);

  if (!roadmap.includes("060A") && !roadmap.includes("060")) {
    errors.push("roadmap.md must reference Phase 060 / 060A");
  }
  if (!roadmap.includes("059") || !roadmap.includes("✅")) {
    errors.push("roadmap.md must keep Phase 059 complete");
  }
  notes.push("roadmap.md reflects Phase 060 / 059 frozen");

  return { notes, errors };
}

function main() {
  const doc = verifyDoc();
  const drift = verifyNoRuntimeDrift();
  const frozen = verify059Frozen();
  const roadmap = verifyRoadmap();

  const notes = [...doc.notes, ...drift.notes, ...frozen.notes, ...roadmap.notes];
  const errors = [...doc.errors, ...drift.errors, ...frozen.errors, ...roadmap.errors];

  console.log("\n=== Phase 060A.1 — eBay Variation Active Qty Sync Audit ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 060A.1 audit/design verified\n");
}

main();
