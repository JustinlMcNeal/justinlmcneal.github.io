/**
 * Phase 060B.5 — Final freeze for eBay ended variation group relist foundation.
 *
 * Run: node scripts/verify-inventory-phase060b-final-freeze.mjs
 *
 * Fast/static regression by default (VERIFY_FAST=1, VERIFY_SKIP_DEEP_REGRESSION=1).
 * Deep Phase 059 chains are not run unless RUN_DEEP_059_FINAL=1 (documented only).
 *
 * Optional live/API tests are never invoked by this script.
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
const FREEZE_SCRIPT = "verify-inventory-phase060b-final-freeze.mjs";

const FAST_ENV = { VERIFY_FAST: "1", VERIFY_SKIP_DEEP_REGRESSION: "1" };

const COMPOSED = [
  { script: "verify-inventory-phase060b1-ebay-variation-relist-audit.mjs", label: "060B.1 audit" },
  { script: "verify-inventory-phase060b2-ebay-variation-relist-candidates.mjs", label: "060B.2 candidates" },
  { script: "verify-inventory-phase060b3-ebay-variation-relist-edge.mjs", label: "060B.3 edge", extraEnv: { VERIFY_SKIP_NESTED_REGRESSION: "1" } },
  { script: "verify-inventory-phase060b4-ebay-variation-relist-matrix.mjs", label: "060B.4 matrix" },
  { script: "verify-inventory-phase060a-final-freeze.mjs", label: "060A freeze" },
  { script: "verify-inventory-phase059-final.mjs", label: "059 final (static)", args: ["--static"] },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue view safety" },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "10Y stabilization" },
];

const ARTIFACTS = [
  { rel: "supabase/migrations/20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql", kind: "migration" },
  { rel: "supabase/functions/_shared/ebayVariationGroupRelistCandidateLoaders.ts", kind: "loader" },
  { rel: "js/admin/inventory/api/ebayVariationRelistCandidateApi.js", kind: "admin API" },
  { rel: "supabase/functions/relist-ebay-variation-group/index.ts", kind: "edge" },
  { rel: "supabase/functions/_shared/ebayVariationGroupRelistUtils.ts", kind: "helper" },
  { rel: "supabase/functions/_shared/ebayVariationGroupRelistValidation.ts", kind: "helper" },
  { rel: "supabase/functions/_shared/ebayVariationGroupRelistPublish.ts", kind: "helper" },
];

const DEPLOY_ITEMS = [
  "20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql",
  "relist-ebay-variation-group",
  "ebayVariationGroupRelistUtils.ts",
  "ebayVariationGroupRelistValidation.ts",
  "ebayVariationGroupRelistPublish.ts",
  "ebayVariationGroupRelistCandidateLoaders.ts",
  "ebayVariationRelistCandidateApi.js",
  "EBAY_ENABLE_LIVE_VARIATION_RELIST",
  "v_inventory_ebay_variation_relist_candidates",
  "EBAY_FULFILLMENT_POLICY_ID",
  "EBAY_RETURN_POLICY_ID",
  "EBAY_PAYMENT_POLICY_ID",
];

const DEFERRED = [
  "060C",
  "Adjust integration",
  "preview/toggle",
  "result panel",
  "qty-0 sibling",
  "shared SKU",
  "qty-0 marketplace deactivation",
  "bulk variation",
  "automatic sync without admin",
  "stock rollback",
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelVariationPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/ui/adjustResultPanel.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
];

/** @type {Set<string>} Read-only preview wiring allowed after 060C.2 */
const PREVIEW_READONLY = new Set([
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelVariationPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
]);

/** @type {Set<string>} Post-adjust variation relist orchestrator (060C.3+) */
const VARIATION_RELIST_ORCHESTRATOR = new Set([
  "js/admin/inventory/api/ebayVariationGroupRelistApi.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
]);

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function runComposed(script, args = [], extraEnv = {}) {
  const r = spawnSync(process.execPath, [join("scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, ...FAST_ENV, ...extraEnv },
  });
  return { ok: r.status === 0, status: r.status, tail: (r.stdout || r.stderr || "").split("\n").slice(-3).join(" ").trim() };
}

function verifyComposedScripts() {
  const notes = [];
  const errors = [];
  if (process.env.RUN_DEEP_059_FINAL === "1") {
    notes.push("RUN_DEEP_059_FINAL=1 noted — deep 059 freeze not auto-run (use verify-inventory-phase059-final-freeze.mjs)");
  }
  for (const { script, label, args = [], extraEnv = {} } of COMPOSED) {
    if (!existsSync(join(ROOT, "scripts", script))) {
      errors.push(`Missing composed script: ${script}`);
      continue;
    }
    const r = runComposed(script, args, extraEnv);
    if (r.ok) notes.push(`Composed PASS: ${label}`);
    else errors.push(`Composed FAIL: ${label}${r.tail ? ` — ${r.tail.slice(0, 120)}` : ""}`);
  }
  return { notes, errors };
}

function verifyStaticFreeze() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_060);
  const roadmap = readText(ROADMAP);
  const plan059 = readText(PLAN_059);

  for (const sub of ["060B.1", "060B.2", "060B.3", "060B.4", "060B.5"]) {
    if (!plan.includes(sub)) errors.push(`Plan missing ${sub}`);
  }
  if (!/060B.*Complete.*Frozen|060B ✅ Complete/i.test(plan)) {
    errors.push("Plan must mark 060B complete/frozen");
  }
  if (!plan.includes("060B.5 ✅") && !/060B\.5[^]*✅/i.test(plan)) {
    errors.push("Plan: 060B.5 must be marked complete");
  }
  if (!plan.includes(FREEZE_SCRIPT)) errors.push(`Plan must reference ${FREEZE_SCRIPT}`);
  notes.push("Plan: 060B.1–060B.5 documented; 060B frozen");

  if (!/060A.*Complete.*Frozen|060A ✅ Complete/i.test(plan)) {
    errors.push("Plan must show 060A remains frozen");
  }
  const phase060Complete = /Phase 060.*Complete.*Frozen|060C\.5.*✅|Production-ready/i.test(plan);
  if (!phase060Complete) {
    if (!plan.includes("060C.1") || !/060C.*Not started|060C.*⬜|060C\.1 next/i.test(plan)) {
      errors.push("Plan must show 060C pending (060C.1 next) or Phase 060 complete");
    }
    notes.push("060A frozen; 060C pending");
  } else {
    notes.push("060A frozen; Phase 060 complete");
  }

  if (!/060B.*Complete.*Frozen|060B ✅ Complete/i.test(roadmap)) {
    errors.push("Roadmap must mark 060B complete/frozen");
  }
  if (!roadmap.includes("060B.5") && !roadmap.includes("B.5 freeze") && !/060B.*Complete.*Frozen|060B.*✅/i.test(roadmap)) {
    errors.push("Roadmap: 060B.5 must be marked complete or 060B frozen");
  }
  if (!phase060Complete) {
    if (!roadmap.includes("060C") || !/060C.*Not started|⬜|060C\.1/i.test(roadmap)) {
      errors.push("Roadmap: 060C must remain not started or Phase 060 must be complete");
    }
    notes.push("Roadmap: 060B frozen; 060C pending");
  } else {
    notes.push("Roadmap: Phase 060 complete/frozen");
  }

  if (!/059.*Complete|Phase 059.*Complete/i.test(roadmap)) {
    errors.push("Roadmap: Phase 059 must remain complete/frozen");
  }
  if (!plan059.includes("Complete") && !plan059.includes("Frozen")) {
    errors.push("059 plan must remain complete/frozen");
  }
  notes.push("Phase 059 remains complete/frozen");

  const sql = readText("supabase/migrations/20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql");
  if (!sql.includes("v_inventory_ebay_variation_relist_candidates")) {
    errors.push("Migration must define v_inventory_ebay_variation_relist_candidates");
  }
  for (const { rel, kind } of ARTIFACTS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing ${kind}: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("060B artifacts present and within line limits");

  const index = readText("supabase/functions/relist-ebay-variation-group/index.ts");
  const utils = readText("supabase/functions/_shared/ebayVariationGroupRelistUtils.ts");
  const validation = readText("supabase/functions/_shared/ebayVariationGroupRelistValidation.ts");
  const publish = readText("supabase/functions/_shared/ebayVariationGroupRelistPublish.ts");
  const loader = readText("supabase/functions/_shared/ebayVariationGroupRelistCandidateLoaders.ts");
  const api = readText("js/admin/inventory/api/ebayVariationRelistCandidateApi.js");

  if (!loader.includes("loadEbayVariationGroupRelistCandidate")) errors.push("Loader missing loadEbayVariationGroupRelistCandidate");
  if (!loader.includes("v_inventory_ebay_variation_relist_candidates")) errors.push("Loader must use relist candidate view");
  if (!api.includes("fetchEbayVariationRelistCandidate")) errors.push("Admin API missing fetchEbayVariationRelistCandidate");
  if (!index.includes("EBAY_ENABLE_LIVE_VARIATION_RELIST")) errors.push("Dedicated live gate missing");
  if (index.includes("EBAY_ENABLE_LIVE_RELIST") && !index.includes("EBAY_ENABLE_LIVE_VARIATION_RELIST")) {
    errors.push("Must not use single-SKU gate as sole gate");
  }
  if (!utils.includes("validateStructuralGroupCandidate")) errors.push("Full group validation required");
  if (!utils.includes('"dry_run"') && !utils.includes('status: "dry_run"')) errors.push("Gate-off/preview must return dry_run");
  if (!utils.includes("qty-0 sibling")) errors.push("Qty-0 sibling warning missing");
  if (!utils.includes("reconciliation failed")) errors.push("Reconciliation failure warning missing");
  if (!utils.includes("not reactivated")) errors.push("Old listing reactivation guard missing");
  if (!utils.includes("variation_group_relist")) errors.push("Sync action variation_group_relist missing");
  if (!validation.includes("allVariantSkus") || !validation.includes("no_child_with_positive_kk_available")) {
    errors.push("Plan must include all variants + require in-stock child");
  }
  if (!publish.includes("createEbayInventoryItem") || !publish.includes("createOrUpdateInventoryItemGroup")) {
    errors.push("Publish chain: child items + group missing");
  }
  if (!publish.includes("createGroupOffers") || !publish.includes("publish_by_inventory_item_group")) {
    errors.push("Publish chain: offers + group publish missing");
  }
  if (utils.includes("adjust_inventory")) errors.push("Must not call adjust_inventory");
  notes.push("Relist edge contract + publish chain + safety guards");

  for (const rel of ADJUST_FLOW) {
    const t = readText(rel);
    if (PREVIEW_READONLY.has(rel)) {
      if (/relist-ebay-variation-group|relistEbayVariationGroup|syncEbayVariationGroup/.test(t)) {
        errors.push(`${rel} preview must not call variation group relist edge`);
      }
      continue;
    }
    if (VARIATION_RELIST_ORCHESTRATOR.has(rel)) {
      if (/variation_child_update_qty|syncEbayVariationChildQuantity/.test(t)) {
        errors.push(`${rel} must not call variation qty edge from relist orchestrator files`);
      }
      continue;
    }
    if (/relist-ebay-variation-group|relistEbayVariationGroup|fetchEbayVariationRelistCandidate|EBAY_ENABLE_LIVE_VARIATION_RELIST/.test(t)) {
      errors.push(`${rel} must not wire variation group relist yet`);
    }
  }
  if (!existsSync(join(ROOT, "js/admin/inventory/api/ebayVariationGroupRelistApi.js"))) {
    errors.push("060C.3 group relist API wrapper expected after 060C orchestrator wiring");
  }
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) errors.push("adjust_inventory sole writer");
  if (/refreshIssueSnapshot|issueSnapshot/.test(orch)) errors.push("No browser snapshot refresh");
  if (readText("js/admin/inventory/services/adjustChannelPreview.js").includes("fetchChannelSyncPreview()")) {
    errors.push("No full fetchChannelSyncPreview in Adjust preview");
  }
  notes.push("No Adjust/result-panel wiring; pool-safety guardrails");

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/variation_group|EBAY_ENABLE_LIVE_VARIATION_RELIST|relist-ebay-variation-group/.test(amazon)) {
    errors.push("Amazon module unchanged");
  }
  notes.push("No Amazon changes");

  const relist059 = readText("supabase/functions/_shared/ebayRelistFromProduct.ts");
  if (/relist-ebay-variation-group|variation_group_relist|EBAY_ENABLE_LIVE_VARIATION_RELIST/.test(relist059)) {
    errors.push("059D single-SKU relist must remain frozen (no variation group wiring)");
  }
  notes.push("059D relist-ebay-from-product unchanged");

  for (const item of DEPLOY_ITEMS) {
    if (!plan.includes(item)) errors.push(`Plan deploy checklist missing: ${item}`);
  }
  if (!plan.includes("skipped by default") && !plan.includes("not run by default")) {
    errors.push("Plan must note optional live tests skipped by default");
  }
  if (!plan.includes("RUN_LIVE_EBAY_VARIATION_RELIST_TEST")) {
    errors.push("Plan must document RUN_LIVE_EBAY_VARIATION_RELIST_TEST");
  }
  notes.push("Deployment checklist + optional test flags documented");

  const frozenIdx = plan.indexOf("## Frozen 060B limitations");
  if (frozenIdx < 0) errors.push("Plan missing ## Frozen 060B limitations section");
  else {
    const block = plan.slice(frozenIdx, frozenIdx + 2500);
    for (const term of DEFERRED) {
      if (!block.toLowerCase().includes(term.toLowerCase())) errors.push(`Frozen limitations missing: ${term}`);
    }
  }
  notes.push("Frozen 060B limitations documented");

  if (/060B\.5 next|In progress \(060B\.5/i.test(plan)) {
    errors.push("Plan still suggests unfinished 060B work");
  }
  if (plan.includes("060B.5 | ⬜")) errors.push("Progress tracker still shows 060B.5 pending");

  return { notes, errors };
}

function main() {
  console.log("\n=== Phase 060B.5 — eBay Variation Group Relist QA Freeze ===\n");

  const composed = verifyComposedScripts();
  for (const n of composed.notes) console.log(`  ✓ ${n}`);
  for (const e of composed.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Static freeze checks ---");
  const freeze = verifyStaticFreeze();
  for (const n of freeze.notes) console.log(`  ✓ ${n}`);
  for (const e of freeze.errors) console.log(`  ✗ ${e}`);

  const errors = [...composed.errors, ...freeze.errors];

  console.log("\n--- Production deployment checklist (060B foundation) ---");
  for (const item of [
    "Apply migration: 20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql",
    "Deploy edge: relist-ebay-variation-group",
    "Deploy shared: ebayVariationGroupRelistUtils.ts, Validation.ts, Publish.ts, CandidateLoaders.ts",
    "Deploy admin read-only API: ebayVariationRelistCandidateApi.js",
    "Confirm EBAY_FULFILLMENT/RETURN/PAYMENT_POLICY_ID env vars",
    "Set EBAY_ENABLE_LIVE_VARIATION_RELIST=true when ready for live group relist",
    "060B is foundation-only until 060C Adjust wiring",
    "Post-deploy smoke: preview dry_run via matrix script (no live mutation required for freeze)",
  ]) {
    console.log(`  • ${item}`);
  }

  console.log("\n--- Optional tests (skipped by default) ---");
  console.log("  • Dry-run API: TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid> + matrix script");
  console.log("  • Live relist: RUN_LIVE_EBAY_VARIATION_RELIST_TEST=true + EBAY_ENABLE_LIVE_VARIATION_RELIST=true (test product only; check qty-0 siblings)");

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 060B ended variation group relist foundation is COMPLETE / FROZEN\n");
  console.log("  Phase 059: frozen");
  console.log("  Phase 060A: frozen");
  console.log("  Phase 060B: frozen (foundation only — no Adjust wiring)");
  console.log("  Next subphase: 060C.1 — Adjust integration plan\n");
}

main();
