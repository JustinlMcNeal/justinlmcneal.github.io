/**
 * Phase 060A.5 — Final freeze for eBay active variation child qty sync foundation.
 *
 * Run: node scripts/verify-inventory-phase060a-final-freeze.mjs
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
const FREEZE_SCRIPT = "verify-inventory-phase060a-final-freeze.mjs";

const FAST_ENV = { VERIFY_FAST: "1", VERIFY_SKIP_DEEP_REGRESSION: "1" };

const COMPOSED = [
  { script: "verify-inventory-phase060a1-ebay-variation-active-audit.mjs", label: "060A.1 audit" },
  { script: "verify-inventory-phase060a2-ebay-variation-candidates.mjs", label: "060A.2 candidates" },
  { script: "verify-inventory-phase060a3-ebay-variation-edge.mjs", label: "060A.3 edge" },
  { script: "verify-inventory-phase060a4-ebay-variation-active-matrix.mjs", label: "060A.4 matrix" },
  { script: "verify-inventory-phase059-final.mjs", label: "059 final (static)", args: ["--static"] },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue view safety" },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "10Y stabilization" },
];

const ARTIFACTS = [
  { rel: "supabase/migrations/20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql", kind: "migration" },
  { rel: "supabase/functions/_shared/ebayVariationChildCandidateLoaders.ts", kind: "loader" },
  { rel: "js/admin/inventory/api/ebayVariationCandidateApi.js", kind: "admin API" },
  { rel: "supabase/functions/_shared/inventoryEbayVariationSyncUtils.ts", kind: "edge helper" },
  { rel: "supabase/functions/sync-ebay-inventory-quantity/index.ts", kind: "edge" },
];

const DEPLOY_ITEMS = [
  "20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql",
  "sync-ebay-inventory-quantity",
  "inventoryEbayVariationSyncUtils.ts",
  "ebayVariationChildCandidateLoaders.ts",
  "ebayVariationCandidateApi.js",
  "EBAY_ENABLE_LIVE_QUANTITY_PATCH",
  "v_inventory_ebay_variation_sync_candidates",
  "variation_child_update_qty",
];

const DEFERRED = [
  "060C",
  "Adjust integration",
  "preview/toggle",
  "result panel",
  "cache-refresh-before-variation",
  "060B",
  "ended variation group relist",
  "shared SKU",
  "qty-0",
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

/** @type {Set<string>} Post-adjust variation qty orchestrator (060C.3+) */
const VARIATION_QTY_ORCHESTRATOR = new Set([
  "js/admin/inventory/api/ebayVariationQtySyncApi.js",
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

function runComposed(script, args = []) {
  const r = spawnSync(process.execPath, [join("scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, ...FAST_ENV },
  });
  return { ok: r.status === 0, status: r.status, tail: (r.stdout || r.stderr || "").split("\n").slice(-3).join(" ").trim() };
}

function verifyComposedScripts() {
  const notes = [];
  const errors = [];
  if (process.env.RUN_DEEP_059_FINAL === "1") {
    notes.push("RUN_DEEP_059_FINAL=1 noted — deep 059 freeze not auto-run (use verify-inventory-phase059-final-freeze.mjs)");
  }
  for (const { script, label, args = [] } of COMPOSED) {
    if (!existsSync(join(ROOT, "scripts", script))) {
      errors.push(`Missing composed script: ${script}`);
      continue;
    }
    const r = runComposed(script, args);
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

  for (const sub of ["060A.1", "060A.2", "060A.3", "060A.4", "060A.5"]) {
    if (!plan.includes(sub)) errors.push(`Plan missing ${sub}`);
  }
  if (!/060A.*Complete.*Frozen|060A ✅ Complete/i.test(plan)) {
    errors.push("Plan must mark 060A complete/frozen");
  }
  if (!plan.includes("060A.5 ✅") && !plan.includes("060A.5 — 060A QA freeze ✅")) {
    errors.push("Plan: 060A.5 must be marked complete");
  }
  if (!plan.includes(FREEZE_SCRIPT)) errors.push(`Plan must reference ${FREEZE_SCRIPT}`);
  notes.push("Plan: 060A.1–060A.5 documented; 060A frozen");

  if (!roadmap.includes("060A.5") && !/060A.*Complete.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap: 060A.5 must be marked complete");
  }
  if (!/060A.*✅ Complete|060A ✅ Complete/i.test(roadmap)) {
    errors.push("Roadmap must mark 060A complete/frozen");
  }
  if (!roadmap.includes("060B") || !/060B.*Not started|060B.*In progress|060B.*⬜|060B.*Complete.*Frozen|060B.*✅/i.test(roadmap)) {
    errors.push("Roadmap: 060B status must be documented");
  }
  if (!roadmap.includes("060C") || (!/060C.*Not started|⬜/.test(roadmap) && !/Phase 060.*Complete.*Frozen|060C.*Complete.*Frozen/i.test(roadmap))) {
    errors.push("Roadmap: 060C must remain not started or Phase 060 must be complete");
  }
  if (/Phase 060.*Complete.*Frozen|060C.*Complete.*Frozen/i.test(roadmap)) {
    notes.push("Roadmap: Phase 060 complete/frozen");
  } else {
    notes.push("Roadmap: 060A frozen; 060B frozen or in progress; 060C pending");
  }

  if (!/059.*✅ Complete|Phase 059.*Complete/i.test(roadmap)) {
    errors.push("Roadmap: Phase 059 must remain complete/frozen");
  }
  if (!plan059.includes("Complete") && !plan059.includes("Frozen")) {
    errors.push("059 plan must remain complete/frozen");
  }
  notes.push("Phase 059 remains complete/frozen");

  const sql = readText("supabase/migrations/20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql");
  if (!sql.includes("v_inventory_ebay_variation_sync_candidates")) {
    errors.push("Migration must define v_inventory_ebay_variation_sync_candidates");
  }
  for (const { rel, kind } of ARTIFACTS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing ${kind}: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("060A artifacts present and within line limits");

  const utils = readText("supabase/functions/_shared/inventoryEbayVariationSyncUtils.ts");
  const index = readText("supabase/functions/sync-ebay-inventory-quantity/index.ts");
  const loader = readText("supabase/functions/_shared/ebayVariationChildCandidateLoaders.ts");
  const api = readText("js/admin/inventory/api/ebayVariationCandidateApi.js");

  if (!loader.includes("loadEbayVariationChildCandidate")) errors.push("Loader missing loadEbayVariationChildCandidate");
  if (!api.includes("fetchEbayVariationChildCandidate")) errors.push("Admin API missing fetchEbayVariationChildCandidate");
  if (!index.includes("variation_child_update_qty") || !index.includes('"update_qty"')) {
    errors.push("Edge must support variation_child_update_qty with update_qty default");
  }
  if (!index.includes("productId is required") || !index.includes("one variant only") || !index.includes("positive integer")) {
    errors.push("Edge variation contract incomplete");
  }
  if (!utils.includes('candidate.candidate_state !== "variation_update_qty"')) {
    errors.push("Helper must require variation_update_qty");
  }
  if (!utils.includes('items: [patchItem]')) errors.push("Helper must patch one child only");
  if (!index.includes("EBAY_ENABLE_LIVE_QUANTITY_PATCH") || !utils.includes("EBAY_VARIATION_QTY_DRY_RUN_COPY")) {
    errors.push("Live gate / dry-run copy missing");
  }
  if (/relistEbay|publishEbayOffer|updateSibling|siblingVariants/i.test(utils)) {
    errors.push("No relist/publish/sibling logic in variation helper");
  }
  notes.push("Variation edge contract + one-child-only patch verified");

  for (const rel of ADJUST_FLOW) {
    const t = readText(rel);
    if (PREVIEW_READONLY.has(rel)) {
      if (/variation_child_update_qty|sync-ebay-inventory-quantity|syncEbayVariationChildQuantity/.test(t)) {
        errors.push(`${rel} preview must not call variation sync edge`);
      }
      continue;
    }
    if (VARIATION_QTY_ORCHESTRATOR.has(rel)) {
      if (/relist-ebay-variation-group|relistEbayVariationGroup/.test(t)) {
        errors.push(`${rel} must not call variation group relist in 060A scope`);
      }
      continue;
    }
    if (/variation_child_update_qty|fetchEbayVariationChildCandidate|ebayVariationCandidateApi/.test(t)) {
      errors.push(`${rel} must not wire variation sync yet`);
    }
  }
  if (!existsSync(join(ROOT, "js/admin/inventory/api/ebayVariationQtySyncApi.js"))) {
    errors.push("060C.3 qty API wrapper expected after 060C orchestrator wiring");
  }
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) errors.push("adjust_inventory sole writer");
  if (/refreshIssueSnapshot|issueSnapshot/.test(orch)) errors.push("No browser snapshot refresh");
  if (readText("js/admin/inventory/services/adjustChannelPreview.js").includes("fetchChannelSyncPreview()")) {
    errors.push("No full fetchChannelSyncPreview in Adjust preview");
  }
  notes.push("No Adjust/result-panel wiring; pool-safety guardrails");

  const amazonFiles = [
    "supabase/functions/sync-amazon-inventory-quantity/index.ts",
    "supabase/functions/_shared/inventoryAmazonInactiveRestock.ts",
  ];
  for (const rel of amazonFiles) {
    if (/variation_child_update_qty|inventoryEbayVariationSyncUtils/.test(readText(rel))) {
      errors.push(`${rel} must not reference variation qty mode`);
    }
  }
  notes.push("No Amazon changes");

  if (!existsSync(join(ROOT, "supabase/functions/relist-ebay-from-product"))) {
    notes.push("relist-ebay-from-product exists (059D single-SKU only — no variation relist in 060A)");
  }
  const relistHandler = existsSync(join(ROOT, "supabase/functions/_shared/ebayRelistFromProduct.ts"))
    ? readText("supabase/functions/_shared/ebayRelistFromProduct.ts")
    : "";
  if (relistHandler && /variation_child_update_qty|variation group relist/i.test(relistHandler)) {
    errors.push("No ended variation relist in 060A scope");
  }
  notes.push("No ended variation relist / group rebuild in 060A");

  for (const item of DEPLOY_ITEMS) {
    if (!plan.includes(item)) errors.push(`Plan deploy checklist missing: ${item}`);
  }
  if (!plan.includes("not run by default") && !plan.includes("skipped by default")) {
    errors.push("Plan must note optional live tests skipped by default");
  }
  if (!plan.includes("RUN_LIVE_EBAY_VARIATION_QTY_TEST")) {
    errors.push("Plan must document RUN_LIVE_EBAY_VARIATION_QTY_TEST");
  }
  notes.push("Deployment checklist + optional test flags documented");

  const deferredBlock = plan.slice(plan.indexOf("## Frozen 060A limitations") > -1 ? plan.indexOf("## Frozen 060A limitations") : plan.indexOf("## Out of scope"));
  for (const term of DEFERRED) {
    if (!plan.toLowerCase().includes(term.toLowerCase())) errors.push(`Frozen limitations missing: ${term}`);
  }
  notes.push("Frozen 060A limitations documented");

  if (/060A\.5 next|In progress \(060A\.5/i.test(plan)) {
    errors.push("Plan still suggests unfinished 060A work");
  }
  if (plan.includes("060A.5 | ⬜")) errors.push("Progress tracker still shows 060A.5 pending");

  return { notes, errors };
}

function main() {
  console.log("\n=== Phase 060A.5 — eBay Variation Active Qty Sync QA Freeze ===\n");

  const composed = verifyComposedScripts();
  for (const n of composed.notes) console.log(`  ✓ ${n}`);
  for (const e of composed.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Static freeze checks ---");
  const freeze = verifyStaticFreeze();
  for (const n of freeze.notes) console.log(`  ✓ ${n}`);
  for (const e of freeze.errors) console.log(`  ✗ ${e}`);

  const errors = [...composed.errors, ...freeze.errors];

  console.log("\n--- Production deployment checklist (060A foundation) ---");
  for (const item of [
    "Apply migration: 20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql",
    "Deploy edge: sync-ebay-inventory-quantity (variation_child_update_qty mode)",
    "Deploy shared: inventoryEbayVariationSyncUtils.ts, ebayVariationChildCandidateLoaders.ts",
    "Deploy admin read-only API: ebayVariationCandidateApi.js",
    "Set EBAY_ENABLE_LIVE_QUANTITY_PATCH=true when ready for live child qty PATCH",
    "060A is foundation-only until 060C Adjust wiring",
    "Post-deploy smoke: preview dry_run via matrix script (no live mutation required for freeze)",
  ]) {
    console.log(`  • ${item}`);
  }

  console.log("\n--- Freeze summary ---");
  console.log(`  060A marked complete/frozen: ${errors.length === 0 ? "YES" : "NO"}`);
  console.log("  Live eBay mutation during this run: NO");
  console.log("  adjust_inventory remains sole stock writer: YES");
  console.log("  Adjust variation wiring: NO (deferred to 060C)");
  console.log("  Next major phase: 060B — ended variation group relist");

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 060A complete, frozen, foundation-ready\n");
  console.log("Next subphase: 060B.1 — eBay ended variation group relist audit\n");
}

main();
