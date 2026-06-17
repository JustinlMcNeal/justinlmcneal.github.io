/**
 * Phase 059C.1 — eBay active sync audit + design verification.
 * Design/audit only — confirms documentation and no 059C runtime drift.
 *
 * Run: node scripts/verify-inventory-phase059c1-ebay-active-audit.mjs
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PLAN_DOC =
  "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const REQUIRED_DOC_SECTIONS = [
  "059C.1 — eBay active sync audit ✅",
  "Audit findings — eBay cache refresh flow",
  "Audit findings — eBay quantity push flow",
  "Audit findings — candidate view eBay actions",
  "059C active eBay contract (059C.2–059C.5 target)",
  "Selected implementation approach for 059C.2",
  "Safety rules (059C — mandatory)",
  "Failure handling (059C)",
  "Verification plan — 059C.2 through 059C.5",
];

const EBAY_RUNTIME_PATHS = [
  "supabase/functions/sync-ebay-listing-inventory-cache/index.ts",
  "supabase/functions/sync-ebay-inventory-quantity/index.ts",
  "supabase/functions/_shared/inventoryEbaySyncUtils.ts",
  "supabase/functions/_shared/inventoryEbayCacheUtils.ts",
  "js/admin/inventory/api/ebayCacheRefreshApi.js",
  "js/admin/inventory/api/ebaySyncPushApi.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
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

  if (!doc.includes("059B") || !doc.includes("frozen")) {
    errors.push("Plan doc must preserve 059B frozen state");
  }

  for (const section of REQUIRED_DOC_SECTIONS) {
    if (!doc.includes(section)) {
      errors.push(`Plan doc missing audit section: ${section}`);
    }
  }
  notes.push("059C.1 audit sections present in plan doc");

  if (!doc.includes("Option A")) {
    errors.push("Plan doc must document chosen 059C.2 approach (Option A)");
  }
  notes.push("059C.2 implementation approach documented (Option A)");

  if (!doc.includes("Safety rules (059C")) {
    errors.push("Plan doc must include 059C safety rules");
  }
  if (!doc.includes("No qty 0 push") && !doc.includes("qty 0 push")) {
    errors.push("Safety rules must include no qty 0 push");
  }
  if (!doc.includes("ended_needs_relist") || !doc.includes("059D")) {
    errors.push("Safety rules must defer ended relist to 059D");
  }
  if (!doc.includes("unsupported_variation")) {
    errors.push("Safety rules must exclude variation automation");
  }
  if (!doc.includes("059C.2") && !doc.includes("059C.2 —")) {
    errors.push("Plan doc must reference 059C.2 subphase");
  }
  notes.push("Safety rules and 059C subphases documented");

  if (!doc.includes("verify-inventory-phase059c1-ebay-active-audit.mjs")) {
    errors.push("Plan doc must reference 059C.1 verify script");
  }

  return { notes, errors };
}

function verifyNo059CRuntimeDrift() {
  const notes = [];
  const errors = [];

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const ebayBranch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  if (orch.includes("refreshEbayListingCache")) {
    errors.push("Orchestrator must not call cache refresh directly (use branch module)");
  }
  if (!orch.includes("resolveEbayBranch") && !ebayBranch.includes("pushEbayInventoryQuantity")) {
    errors.push("eBay active path must exist in orchestrator or branch module");
  }
  if (!ebayBranch.includes("pushEbayInventoryQuantity")) {
    errors.push("eBay branch must retain update_qty push path");
  }
  notes.push("059C.1 audit: eBay path delegated to adjustChannelEbayBranch (post-059C.3)");

  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  if (!preview.includes("qty_cache_missing")) {
    errors.push("Preview must reference qty_cache_missing");
  }
  notes.push("Preview documents qty_cache_missing active path");

  for (const rel of EBAY_RUNTIME_PATHS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing expected file: ${rel}`);
  }
  if (!existsSync(join(ROOT, "js/admin/inventory/services/adjustChannelEbayBranch.js"))) {
    errors.push("Missing adjustChannelEbayBranch.js (059C.3+)");
  }
  notes.push("Existing eBay edge/API files present");

  return { notes, errors };
}

function verify059BFrozen() {
  const notes = [];
  const errors = [];
  const freezeScript = join(ROOT, "scripts", "verify-inventory-phase059b-final-freeze.mjs");
  if (!existsSync(freezeScript)) {
    errors.push("Missing 059B freeze script");
    return { notes, errors };
  }
  const result = spawnSync(process.execPath, [freezeScript], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 360000,
    env: { ...process.env },
  });
  if (result.status === 0) notes.push("059B final freeze script still PASS");
  else {
    const tail = (result.stdout || result.stderr || "").split("\n").slice(-4).join(" ").trim();
    errors.push(`059B freeze regression FAIL${tail ? `: ${tail.slice(0, 120)}` : ""}`);
  }
  return { notes, errors };
}

function verifyRoadmap() {
  const notes = [];
  const errors = [];
  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("059B ✅ Complete")) {
    errors.push("roadmap.md must mark 059B complete");
  }
  if (!roadmap.includes("059C.1") && !roadmap.includes("C.1 ✅") && !roadmap.includes("059C ✅ Complete")) {
    errors.push("roadmap.md must reference 059C.1 or 059C complete");
  }
  notes.push("roadmap.md reflects 059C status");
  return { notes, errors };
}

function main() {
  const doc = verifyDoc();
  const drift = verifyNo059CRuntimeDrift();
  const frozen = verify059BFrozen();
  const roadmap = verifyRoadmap();

  const notes = [...doc.notes, ...drift.notes, ...frozen.notes, ...roadmap.notes];
  const errors = [...doc.errors, ...drift.errors, ...frozen.errors, ...roadmap.errors];

  console.log("\n=== Phase 059C.1 — eBay Active Sync Audit ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059C.1 eBay active sync audit complete (no runtime changes)\n");
  console.log("Next subphase: 059C.2 — single-variant cache refresh chain\n");
}

main();
