/**
 * Phase 060C.5 / Phase 060 — Final freeze and production readiness.
 *
 * Run: node scripts/verify-inventory-phase060-final-freeze.mjs
 *
 * Fast/static regression by default (VERIFY_FAST=1, VERIFY_SKIP_DEEP_REGRESSION=1,
 * VERIFY_SKIP_NESTED_REGRESSION=1, VERIFY_SKIP_BROWSER=1).
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
const FREEZE_SCRIPT = "verify-inventory-phase060-final-freeze.mjs";

const FAST_ENV = {
  VERIFY_FAST: "1",
  VERIFY_SKIP_DEEP_REGRESSION: "1",
  VERIFY_SKIP_NESTED_REGRESSION: "1",
  VERIFY_SKIP_BROWSER: "1",
};

const COMPOSED = [
  { script: "verify-inventory-phase060c4-adjust-integration-matrix.mjs", label: "060C.4 matrix" },
  { script: "verify-inventory-phase060c3-adjust-variation-orchestrator.mjs", label: "060C.3 orchestrator" },
  { script: "verify-inventory-phase060c2-adjust-preview-toggle.mjs", label: "060C.2 preview" },
  { script: "verify-inventory-phase060c1-adjust-integration-audit.mjs", label: "060C.1 audit" },
  { script: "verify-inventory-phase060b-final-freeze.mjs", label: "060B freeze" },
  { script: "verify-inventory-phase060a-final-freeze.mjs", label: "060A freeze" },
  { script: "verify-inventory-phase059-final.mjs", label: "059 final (static)", args: ["--static"] },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue view safety" },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "10Y stabilization" },
];

const ARTIFACTS = [
  { rel: "supabase/migrations/20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql", label: "060A migration" },
  { rel: "supabase/migrations/20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql", label: "060B migration" },
  { rel: "supabase/functions/_shared/ebayVariationChildCandidateLoaders.ts", label: "060A loader" },
  { rel: "supabase/functions/_shared/inventoryEbayVariationSyncUtils.ts", label: "060A variation utils" },
  { rel: "supabase/functions/sync-ebay-inventory-quantity/index.ts", label: "sync-ebay-inventory-quantity" },
  { rel: "supabase/functions/_shared/ebayVariationGroupRelistCandidateLoaders.ts", label: "060B loader" },
  { rel: "supabase/functions/relist-ebay-variation-group/index.ts", label: "relist-ebay-variation-group" },
  { rel: "supabase/functions/_shared/ebayVariationGroupRelistUtils.ts", label: "060B relist utils" },
  { rel: "supabase/functions/_shared/ebayVariationGroupRelistValidation.ts", label: "060B validation" },
  { rel: "supabase/functions/_shared/ebayVariationGroupRelistPublish.ts", label: "060B publish" },
  { rel: "js/admin/inventory/api/ebayVariationCandidateApi.js", label: "variation candidate API" },
  { rel: "js/admin/inventory/api/ebayVariationRelistCandidateApi.js", label: "variation relist candidate API" },
  { rel: "js/admin/inventory/api/ebayVariationQtySyncApi.js", label: "variation qty sync API" },
  { rel: "js/admin/inventory/api/ebayVariationGroupRelistApi.js", label: "variation group relist API" },
  { rel: "js/admin/inventory/services/adjustChannelVariationPreview.js", label: "variation preview" },
  { rel: "js/admin/inventory/services/adjustChannelEbayVariationBranch.js", label: "variation branch" },
  { rel: "js/admin/inventory/ui/adjustModalChannelPreview.js", label: "adjust preview modal" },
  { rel: "js/admin/inventory/services/adjustChannelOrchestrator.js", label: "orchestrator" },
  { rel: "js/admin/inventory/renderers/renderAdjustResultPanel.js", label: "result panel" },
];

const DEPLOY_ITEMS = [
  "20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql",
  "20261025_inventory_phase060b2_ebay_variation_relist_candidates.sql",
  "sync-ebay-inventory-quantity",
  "relist-ebay-variation-group",
  "ebayVariationChildCandidateLoaders.ts",
  "inventoryEbayVariationSyncUtils.ts",
  "ebayVariationGroupRelistCandidateLoaders.ts",
  "ebayVariationGroupRelistUtils.ts",
  "ebayVariationGroupRelistValidation.ts",
  "ebayVariationGroupRelistPublish.ts",
  "ebayVariationCandidateApi.js",
  "ebayVariationRelistCandidateApi.js",
  "ebayVariationQtySyncApi.js",
  "ebayVariationGroupRelistApi.js",
  "adjustChannelVariationPreview.js",
  "adjustChannelEbayVariationBranch.js",
  "EBAY_ENABLE_LIVE_QUANTITY_PATCH",
  "EBAY_ENABLE_LIVE_VARIATION_RELIST",
  "AMAZON_ENABLE_LIVE_PATCH",
  "EBAY_ENABLE_LIVE_RELIST",
  "EBAY_FULFILLMENT_POLICY_ID",
  "EBAY_RETURN_POLICY_ID",
  "EBAY_PAYMENT_POLICY_ID",
  "verify-inventory-phase10y-final-stabilization.mjs",
  "variation_child_update_qty",
  "v_inventory_ebay_variation_sync_candidates",
  "v_inventory_ebay_variation_relist_candidates",
];

const FROZEN_LIMITATIONS = [
  "qty-0 marketplace deactivation",
  "bulk variation",
  "automatic sync without admin",
  "stock rollback",
  "qty-0 sibling",
  "RUN_LIVE_EBAY_VARIATION_QTY_TEST",
  "RUN_LIVE_EBAY_VARIATION_RELIST_TEST",
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/ui/adjustModal.js",
];

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
    timeout: 240_000,
    env: { ...process.env, ...FAST_ENV, ...extraEnv },
  });
  return {
    ok: r.status === 0,
    tail: (r.stdout || r.stderr || "").split("\n").slice(-4).join(" ").trim(),
  };
}

function verifyComposed() {
  const notes = [];
  const errors = [];
  if (process.env.RUN_DEEP_059_FINAL === "1") {
    notes.push("RUN_DEEP_059_FINAL=1 noted — use verify-inventory-phase059-final-freeze.mjs for deep 059");
  }
  for (const { script, label, args = [], extraEnv = {} } of COMPOSED) {
    if (!existsSync(join(ROOT, "scripts", script))) {
      errors.push(`Missing composed script: ${script}`);
      continue;
    }
    const r = runComposed(script, args, extraEnv);
    if (r.ok) notes.push(`Composed PASS: ${label}`);
    else errors.push(`Composed FAIL: ${label}${r.tail ? ` — ${r.tail.slice(0, 100)}` : ""}`);
  }
  return { notes, errors };
}

function verifyStaticFreeze() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_060);
  const roadmap = readText(ROADMAP);
  const plan059 = readText(PLAN_059);

  if (!/060A.*Complete.*Frozen|060A ✅/i.test(plan)) errors.push("Plan: 060A must be frozen");
  if (!/060B.*Complete.*Frozen|060B ✅/i.test(plan)) errors.push("Plan: 060B must be frozen");
  for (const sub of ["060C.1", "060C.2", "060C.3", "060C.4", "060C.5"]) {
    if (!plan.includes(sub)) errors.push(`Plan missing ${sub}`);
  }
  if (!/060C\.5[^]*✅|060C\.5 complete/i.test(plan)) {
    errors.push("Plan: 060C.5 must be marked complete");
  }
  if (!/060C.*Complete.*Frozen|060C ✅/i.test(plan)) {
    errors.push("Plan: 060C must be marked complete/frozen");
  }
  if (!/Phase 060.*Complete.*Frozen|Production-ready/i.test(plan)) {
    errors.push("Plan: Phase 060 must be complete/frozen/production-ready");
  }
  if (!plan.includes(FREEZE_SCRIPT)) errors.push(`Plan must reference ${FREEZE_SCRIPT}`);
  notes.push("Plan: 060A/060B/060C frozen; Phase 060 production-ready");

  if (!/060A.*Complete.*Frozen|060A ✅/i.test(roadmap)) errors.push("Roadmap: 060A frozen");
  if (!/060B.*Complete.*Frozen|060B ✅/i.test(roadmap)) errors.push("Roadmap: 060B frozen");
  if (!/060C.*Complete.*Frozen|060C\.5.*✅/i.test(roadmap)) errors.push("Roadmap: 060C frozen");
  if (!/Phase 060.*Complete.*Frozen|Production-ready/i.test(roadmap)) {
    errors.push("Roadmap: Phase 060 must be complete/frozen/production-ready");
  }
  if (!/059.*Complete|Phase 059.*Complete/i.test(roadmap)) {
    errors.push("Roadmap: Phase 059 must remain frozen");
  }
  notes.push("Roadmap: Phase 059 + 060 frozen");

  for (const { rel, label } of ARTIFACTS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing artifact (${label}): ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("Phase 060 artifacts present");

  const qtyApi = readText("js/admin/inventory/api/ebayVariationQtySyncApi.js");
  if (!qtyApi.includes('mode: "variation_child_update_qty"')) {
    errors.push("Qty API must use variation_child_update_qty mode");
  }
  const relistApi = readText("js/admin/inventory/api/ebayVariationGroupRelistApi.js");
  if (!relistApi.includes("relist-ebay-variation-group")) {
    errors.push("Group relist API must call relist edge");
  }
  notes.push("060C API wrappers verified");

  for (const item of DEPLOY_ITEMS) {
    if (!plan.includes(item)) errors.push(`Deploy checklist missing: ${item}`);
  }
  notes.push("Production deployment checklist documented");

  const limBlock = plan.includes("## Frozen Phase 060 limitations")
    ? plan.slice(plan.indexOf("## Frozen Phase 060 limitations"))
    : plan;
  for (const term of FROZEN_LIMITATIONS) {
    if (!limBlock.toLowerCase().includes(term.toLowerCase())) {
      errors.push(`Frozen limitations missing: ${term}`);
    }
  }
  notes.push("Frozen limitations documented");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  if (/rollback|undo.*stock|revert.*stock/i.test(orch)) {
    errors.push("No stock rollback in orchestrator");
  }

  for (const rel of ADJUST_FLOW) {
    const t = readText(rel);
    if (/fetchChannelSyncPreview\(\)/.test(t)) errors.push(`${rel}: forbidden full channel preview`);
    if (/refreshIssueSnapshot|issueSnapshot/.test(t)) errors.push(`${rel}: forbidden snapshot refresh`);
  }

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/ebayVariation|variation_child_update_qty|relist-ebay-variation-group/.test(amazon)) {
    errors.push("Amazon module unchanged by Phase 060");
  }

  if (!plan059.includes("Complete") && !plan059.includes("Frozen")) {
    errors.push("059 plan must remain frozen");
  }
  notes.push("Pool-safety + sole stock writer + no Amazon drift");

  return { notes, errors };
}

function main() {
  console.log("\n=== Phase 060C.5 — Phase 060 Final Freeze / Production Readiness ===\n");

  const composed = verifyComposed();
  for (const n of composed.notes) console.log(`  ✓ ${n}`);
  for (const e of composed.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Static freeze checks ---");
  const freeze = verifyStaticFreeze();
  for (const n of freeze.notes) console.log(`  ✓ ${n}`);
  for (const e of freeze.errors) console.log(`  ✗ ${e}`);

  const errors = [...composed.errors, ...freeze.errors];

  console.log("\n--- Production deployment checklist ---");
  for (const item of [
    "Migrations: 20261024 (060A candidates), 20261025 (060B relist candidates)",
    "Edges: sync-ebay-inventory-quantity (variation_child_update_qty), relist-ebay-variation-group",
    "Shared: variation child loaders/utils + group relist loaders/utils/validation/publish",
    "Admin JS: candidate APIs, qty/relist wrappers, variation preview/branch, orchestrator/result panel",
    "Gates: EBAY_ENABLE_LIVE_QUANTITY_PATCH (060A), EBAY_ENABLE_LIVE_VARIATION_RELIST (060B)",
    "Policies: EBAY_FULFILLMENT/RETURN/PAYMENT_POLICY_ID for group relist",
    "Post-deploy: Adjust modal preview + dry_run matrix; verify-inventory-phase10y-final-stabilization.mjs",
  ]) {
    console.log(`  • ${item}`);
  }

  console.log("\n--- Optional tests (skipped by default) ---");
  console.log("  • Dry-run: TEST_EBAY_VARIATION_* env + verify-inventory-phase060c4-adjust-integration-matrix.mjs");
  console.log("  • Live qty: RUN_LIVE_EBAY_VARIATION_QTY_TEST=true + EBAY_ENABLE_LIVE_QUANTITY_PATCH=true");
  console.log("  • Live relist: RUN_LIVE_EBAY_VARIATION_RELIST_TEST=true + EBAY_ENABLE_LIVE_VARIATION_RELIST=true");

  console.log("\n--- Freeze summary ---");
  console.log(`  Phase 060 complete/frozen: ${errors.length === 0 ? "YES" : "NO"}`);
  console.log("  Live marketplace calls during this run: NO");
  console.log("  adjust_inventory remains sole stock writer: YES");
  console.log("  Phase 059 remains frozen: YES");

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 060 eBay variation group automation is COMPLETE / FROZEN / PRODUCTION-READY\n");
}

main();
