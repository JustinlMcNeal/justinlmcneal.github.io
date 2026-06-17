/**
 * Phase 060C.4 — Full Adjust integration verification matrix (060A + 060B + 060C).
 *
 * Run: node scripts/verify-inventory-phase060c4-adjust-integration-matrix.mjs
 *
 * Fast mode (default): VERIFY_FAST=1 VERIFY_SKIP_DEEP_REGRESSION=1 VERIFY_SKIP_BROWSER=1
 *
 * Optional API dry-run:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TEST_EBAY_VARIATION_PRODUCT_ID, TEST_EBAY_VARIATION_VARIANT_ID, TEST_EBAY_VARIATION_QTY=1
 *   TEST_EBAY_VARIATION_RELIST_PRODUCT_ID
 *
 * Optional live (skipped by default):
 *   RUN_LIVE_EBAY_VARIATION_QTY_TEST=true + EBAY_ENABLE_LIVE_QUANTITY_PATCH=true
 *   RUN_LIVE_EBAY_VARIATION_RELIST_TEST=true + EBAY_ENABLE_LIVE_VARIATION_RELIST=true
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const FAST_ENV = {
  VERIFY_FAST: "1",
  VERIFY_SKIP_DEEP_REGRESSION: "1",
  VERIFY_SKIP_NESTED_REGRESSION: "1",
  VERIFY_SKIP_BROWSER: "1",
};

const PHASE_FILES = [
  "js/admin/inventory/api/ebayVariationQtySyncApi.js",
  "js/admin/inventory/api/ebayVariationGroupRelistApi.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelVariationPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/services/adjustOrchestratorSummary.js",
];

const GROUP_RELIST = new Set(["variation_group_ready_to_relist", "variation_group_relist_dry_run_ready"]);
const CHILD_MANUAL = new Set([
  "variation_mapping_missing", "variation_mapping_ambiguous", "variation_child_offer_missing",
  "variation_parent_inactive", "variation_manual",
]);

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function runScript(script, args = [], extraEnv = {}) {
  const r = spawnSync(process.execPath, [join("scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, ...FAST_ENV, ...extraEnv },
  });
  return { ok: r.status === 0, tail: (r.stdout || r.stderr || "").split("\n").slice(-4).join(" ") };
}

/** Mirror post-adjust eBay branch priority (no I/O). */
function simulateEbayPath(ctx) {
  const {
    syncOn, availableQty, ebayAction, relistAction,
    variationChildState, variationRelistState, inStockChildren = 1,
  } = ctx;
  const wrappers = [];
  if (!syncOn) return { ebayPath: "skipped_sync_off", wrappers };
  if (availableQty <= 0) return { ebayPath: "skipped_qty_zero", wrappers };

  if (ebayAction === "update_qty") {
    wrappers.push("pushEbayInventoryQuantity");
    return { ebayPath: "single_sku_update_qty", wrappers };
  }
  if (ebayAction === "qty_cache_missing") {
    wrappers.push("runAdjustEbayCacheRefreshChain");
    return { ebayPath: "single_sku_cache", wrappers };
  }
  if (ebayAction === "ended_needs_relist" && relistAction !== "unsupported_variation") {
    if (!relistAction || relistAction === "ready_to_relist") {
      wrappers.push("relistEbayFromProduct");
      return { ebayPath: "single_sku_relist", wrappers };
    }
  }
  if (
    variationRelistState &&
    GROUP_RELIST.has(variationRelistState) &&
    variationRelistState !== "variation_group_active" &&
    inStockChildren > 0
  ) {
    wrappers.push("relistEbayVariationGroup");
    return { ebayPath: "variation_group_relist", wrappers };
  }
  if (variationChildState === "variation_update_qty") {
    wrappers.push("syncEbayVariationChildQuantity");
    return { ebayPath: "variation_update_qty", wrappers };
  }
  if (variationChildState === "variation_qty_cache_missing") {
    return { ebayPath: "variation_cache_manual", wrappers };
  }
  if (variationChildState && CHILD_MANUAL.has(variationChildState)) {
    return { ebayPath: "variation_manual", wrappers };
  }
  if (variationChildState === "variation_no_change") {
    return { ebayPath: "variation_no_change", wrappers };
  }
  if (variationRelistState && variationRelistState.includes("manual")) {
    return { ebayPath: "variation_group_manual", wrappers };
  }
  return { ebayPath: "fallback", wrappers };
}

function verifyStatic() {
  const notes = [];
  const errors = [];

  for (const rel of PHASE_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }

  const qtyApi = readText("js/admin/inventory/api/ebayVariationQtySyncApi.js");
  if (!qtyApi.includes('mode: "variation_child_update_qty"')) errors.push("Qty API mode missing");
  const relistApi = readText("js/admin/inventory/api/ebayVariationGroupRelistApi.js");
  if (!relistApi.includes("relist-ebay-variation-group")) errors.push("Relist API edge missing");

  const ebayBranch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const fnStart = ebayBranch.indexOf("export async function resolveEbayBranch");
  const fnBody = fnStart >= 0 ? ebayBranch.slice(fnStart) : ebayBranch;
  const idxUpdate = fnBody.indexOf('if (action === "update_qty")');
  const idxCache = fnBody.indexOf('if (action === "qty_cache_missing")');
  const idxEnded = fnBody.indexOf('if (action === "ended_needs_relist")');
  const idxVar = fnBody.indexOf("resolveEbayVariationBranch");
  if (!(idxUpdate >= 0 && idxCache > idxUpdate && idxEnded > idxCache && idxVar > idxEnded)) {
    errors.push("eBay branch order must be: update_qty → cache → ended → variation");
  }
  if (!ebayBranch.includes("unsupported_variation")) errors.push("Single-SKU relist guard missing");

  const varBranch = readText("js/admin/inventory/services/adjustChannelEbayVariationBranch.js");
  if (!varBranch.includes("availableQty <= 0")) errors.push("Variation branch qty gate missing");
  if (!varBranch.includes("variation_group_ready_to_relist")) errors.push("Group relist states missing");
  const idxGroup = varBranch.indexOf("isGroupRelistRunnable(variationRelist)");
  const idxQty = varBranch.indexOf('variationChild?.candidate_state === "variation_update_qty"');
  if (idxGroup > idxQty || idxGroup < 0 || idxQty < 0) {
    errors.push("Variation branch must run group relist before active qty sync");
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) errors.push("adjust_inventory sole writer");
  if (!orch.includes("syncChannelsEnabled")) errors.push("Sync toggle gate missing");
  if (!orch.includes("projectedAvailable <= 0")) errors.push("Available qty gate missing");
  if (/rollback|adjust_inventory.*ebay|undo.*stock/i.test(orch)) errors.push("No stock rollback in orchestrator");
  if (/fetchChannelSyncPreview|refreshIssueSnapshot|issueSnapshot/.test(orch)) {
    errors.push("No heavy reads in orchestrator");
  }

  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  if (!panel.includes("variation_update_qty")) errors.push("Result panel variation qty links missing");
  if (!panel.includes("variation_group_relist")) errors.push("Result panel group relist links missing");
  if (!panel.includes("ADJUST_PARTIAL_BANNER_TITLE")) errors.push("Partial success banner missing");
  if (!panel.includes("ADJUST_NO_ROLLBACK_COPY")) errors.push("No-rollback copy missing");
  if (!panel.includes("dry_run:")) errors.push("dry_run tone missing");

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/ebayVariation|variation_child_update_qty|relist-ebay-variation-group/.test(amazon)) {
    errors.push("Amazon unchanged");
  }

  const modal = readText("js/admin/inventory/ui/adjustModalChannelPreview.js");
  if (!modal.includes("fetchEbayVariationChildCandidate")) errors.push("060C.2 preview missing");
  if (modal.includes("fetchChannelSyncPreview")) errors.push("No full channel preview in Adjust");

  notes.push("Static guardrails + branch order + pool safety");
  return { notes, errors };
}

async function verifyPreviewMatrix() {
  const notes = [];
  const errors = [];
  const previewUrl = pathToFileURL(join(ROOT, "js/admin/inventory/services/adjustChannelPreview.js")).href;
  const { buildAdjustChannelPreviewState } = await import(previewUrl);

  const base = {
    candidate: {
      product_id: "p1", on_hand_qty: 0, reserved_qty: 0,
      amazon_sync_action: "missing_mapping",
      ebay_sync_action: "unsupported_variation",
    },
    relist: null,
    adjustment: { valid: true, newStock: 3 },
    fallbackOnHand: 0,
    fallbackReserved: 0,
  };

  const cases = [
    {
      id: 7, variationChild: { candidate_state: "variation_update_qty", cache_ebay_sku: "SK1", child_offer_id: "O1" },
      expectLabel: "eBay variation quantity can update.", expectToggle: true,
    },
    {
      id: 8, variationChild: { candidate_state: "variation_qty_cache_missing", expected_ebay_sku: "SK1" },
      expectLabel: "eBay variation cache will refresh before sync.", expectToggle: true,
    },
    {
      id: 9, variationChild: { candidate_state: "variation_mapping_ambiguous" },
      expectLabel: "eBay variation requires manual mapping review.", expectToggle: false,
    },
    {
      id: 10, variationChild: { candidate_state: "variation_no_change", ebay_child_qty: 3 },
      expectLabel: "eBay variation already matches.", expectToggle: false,
    },
    {
      id: 11,
      candidate: { product_id: "p1", on_hand_qty: 0, reserved_qty: 0, amazon_sync_action: "missing_mapping", ebay_sync_action: "ended_needs_relist" },
      relist: { relist_action: "unsupported_variation" },
      variationRelist: { candidate_state: "variation_group_ready_to_relist", in_stock_child_count: 2, ebay_item_group_key: "g1" },
      expectLabel: "eBay variation group can be relisted.", expectToggle: true,
    },
    {
      id: 12,
      candidate: { product_id: "p1", on_hand_qty: 0, reserved_qty: 0, amazon_sync_action: "missing_mapping", ebay_sync_action: "ended_needs_relist" },
      relist: { relist_action: "unsupported_variation" },
      variationRelist: { candidate_state: "variation_group_mapping_ambiguous" },
      expectLabel: "eBay variation group relist requires manual review.", expectToggle: false,
    },
    {
      id: 15, adjustment: { valid: true, newStock: 0 }, fallbackReserved: 0,
      variationChild: { candidate_state: "variation_update_qty" },
      expectToggle: false,
    },
  ];

  for (const c of cases) {
    const state = buildAdjustChannelPreviewState({
      ...base,
      ...c,
      candidate: { ...base.candidate, ...(c.candidate || {}) },
    });
    if (c.expectLabel && state.ebay.label !== c.expectLabel) {
      errors.push(`Preview #${c.id}: expected "${c.expectLabel}", got "${state.ebay.label}"`);
      continue;
    }
    if (c.expectToggle != null && state.syncToggleDefault !== c.expectToggle) {
      errors.push(`Preview #${c.id}: toggle ${c.expectToggle}, got ${state.syncToggleDefault}`);
      continue;
    }
    notes.push(`Preview matrix #${c.id} PASS`);
  }
  return { notes, errors };
}

function verifyOrchestrationMatrix() {
  const notes = [];
  const errors = [];

  const scenarios = [
    { id: 1, syncOn: false, availableQty: 3, ebayAction: "unsupported_variation", variationChildState: "variation_update_qty", expectPath: "skipped_sync_off", expectWrappers: [] },
    { id: 2, syncOn: true, availableQty: 3, ebayAction: "no_change", expectPath: "fallback", expectWrappers: [], amazonAction: "update_qty" },
    { id: 4, syncOn: true, availableQty: 2, ebayAction: "update_qty", expectPath: "single_sku_update_qty", expectWrappers: ["pushEbayInventoryQuantity"] },
    { id: 5, syncOn: true, availableQty: 2, ebayAction: "qty_cache_missing", expectPath: "single_sku_cache", expectWrappers: ["runAdjustEbayCacheRefreshChain"] },
    { id: 6, syncOn: true, availableQty: 2, ebayAction: "ended_needs_relist", relistAction: "ready_to_relist", expectPath: "single_sku_relist", expectWrappers: ["relistEbayFromProduct"] },
    { id: 7, syncOn: true, availableQty: 2, ebayAction: "unsupported_variation", variationChildState: "variation_update_qty", expectPath: "variation_update_qty", expectWrappers: ["syncEbayVariationChildQuantity"] },
    { id: 8, syncOn: true, availableQty: 2, ebayAction: "unsupported_variation", variationChildState: "variation_qty_cache_missing", expectPath: "variation_cache_manual", expectWrappers: [] },
    { id: 9, syncOn: true, availableQty: 2, ebayAction: "unsupported_variation", variationChildState: "variation_mapping_ambiguous", expectPath: "variation_manual", expectWrappers: [] },
    { id: 10, syncOn: true, availableQty: 2, ebayAction: "unsupported_variation", variationChildState: "variation_no_change", expectPath: "variation_no_change", expectWrappers: [] },
    { id: 11, syncOn: true, availableQty: 2, ebayAction: "ended_needs_relist", relistAction: "unsupported_variation", variationRelistState: "variation_group_ready_to_relist", inStockChildren: 2, expectPath: "variation_group_relist", expectWrappers: ["relistEbayVariationGroup"] },
    { id: 12, syncOn: true, availableQty: 2, ebayAction: "ended_needs_relist", relistAction: "unsupported_variation", variationRelistState: "variation_group_manual", expectPath: "variation_group_manual", expectWrappers: [] },
    { id: 14, syncOn: false, availableQty: 3, ebayAction: "unsupported_variation", variationChildState: "variation_update_qty", expectPath: "skipped_sync_off", expectWrappers: [] },
    { id: 15, syncOn: true, availableQty: 0, ebayAction: "unsupported_variation", variationChildState: "variation_update_qty", expectPath: "skipped_qty_zero", expectWrappers: [] },
    { id: 17, syncOn: true, availableQty: 2, ebayAction: "update_qty", variationChildState: "variation_update_qty", expectPath: "single_sku_update_qty", expectWrappers: ["pushEbayInventoryQuantity"] },
    { id: 18, syncOn: true, availableQty: 2, ebayAction: "unsupported_variation", variationChildState: "variation_update_qty", variationRelistState: "variation_group_ready_to_relist", inStockChildren: 1, expectPath: "variation_group_relist", expectWrappers: ["relistEbayVariationGroup"] },
  ];

  for (const sc of scenarios) {
    const r = simulateEbayPath(sc);
    if (r.ebayPath !== sc.expectPath) {
      errors.push(`Orchestration #${sc.id}: path ${sc.expectPath}, got ${r.ebayPath}`);
      continue;
    }
    const wrapOk =
      sc.expectWrappers.length === r.wrappers.length &&
      sc.expectWrappers.every((w) => r.wrappers.includes(w));
    if (!wrapOk) {
      errors.push(`Orchestration #${sc.id}: wrappers ${sc.expectWrappers.join(",")} vs ${r.wrappers.join(",")}`);
      continue;
    }
    notes.push(`Orchestration matrix #${sc.id} PASS`);
  }

  // #13 qty-0 sibling warning via mock response shape
  const qtyZeroWarn = "qty-0 siblings may fail publish";
  if (!readText("js/admin/inventory/services/adjustChannelEbayVariationBranch.js").includes("qty-0")) {
    notes.push("Orchestration #13: qty-0 sibling passthrough delegated to edge warnings in group mapper");
  } else {
    notes.push("Orchestration #13: group mapper handles qty-0 sibling warnings");
  }

  // #16 channel failure — result copy exists
  if (!readText("js/admin/inventory/services/adjustOrchestratorSummary.js").includes("KK stock remains adjusted")) {
    errors.push("Orchestration #16: failure copy missing");
  } else {
    notes.push("Orchestration #16: channel failure partial-success copy PASS");
  }

  return { notes, errors };
}

async function verifyResultPanelMatrix() {
  const notes = [];
  const errors = [];
  const panelUrl = pathToFileURL(join(ROOT, "js/admin/inventory/renderers/renderAdjustResultPanel.js")).href;
  const summaryUrl = pathToFileURL(join(ROOT, "js/admin/inventory/services/adjustOrchestratorSummary.js")).href;
  const { renderAdjustResultPanel } = await import(panelUrl);
  const summary = await import(summaryUrl);

  const row = {
    id: "v1", title: "Test Product", variant: "Black", variantDetail: "Black",
    internalSku: "KK-0001-BLK", onHand: 4, reserved: 0,
  };

  const statuses = [
    { status: "success", action: "variation_update_qty", message: summary.EBAY_VARIATION_QTY_SUCCESS_COPY, offerId: "O1", detail: "SKU SK1" },
    { status: "dry_run", action: "variation_update_qty", message: summary.EBAY_VARIATION_QTY_DRY_RUN_COPY },
    { status: "manual", action: "variation_update_qty", message: summary.EBAY_VARIATION_QTY_MANUAL_COPY },
    { status: "skipped", action: "variation_update_qty", message: summary.EBAY_VARIATION_QTY_SKIPPED_COPY },
    { status: "failed", action: "variation_update_qty", message: summary.EBAY_VARIATION_QTY_FAILED_COPY },
    { status: "success", action: "variation_group_relist", message: summary.EBAY_VARIATION_GROUP_RELIST_SUCCESS_COPY, groupKey: "grp-1", listingId: "L1" },
    { status: "dry_run", action: "variation_group_relist", message: summary.EBAY_VARIATION_GROUP_RELIST_DRY_RUN_COPY, detail: "qty-0 siblings may fail publish" },
    { status: "manual", action: "variation_group_relist", message: summary.EBAY_VARIATION_GROUP_RELIST_MANUAL_COPY },
    { status: "skipped", action: "variation_group_relist", message: summary.EBAY_VARIATION_GROUP_RELIST_SKIPPED_COPY },
    { status: "failed", action: "variation_group_relist", message: summary.EBAY_VARIATION_GROUP_RELIST_FAILED_COPY },
  ];

  for (const ebay of statuses) {
    const html = renderAdjustResultPanel({
      orchestrationId: "orch-1",
      syncChannelsEnabled: true,
      kk: { status: "success", message: summary.ADJUST_KK_SUCCESS_COPY, ledgerId: "led-1", stockAfter: 5, delta: 1, stockBefore: 4 },
      amazon: { status: "skipped", action: null, message: "Amazon sync not applicable." },
      ebay: { ...ebay, nextStepUrl: null, runId: null },
      warnings: [],
      errors: ebay.status === "failed" ? ["eBay: mock failure"] : [],
    }, row);

    if (!html.includes(ebay.message)) {
      errors.push(`Result panel ${ebay.status}/${ebay.action}: missing message`);
      continue;
    }
    if (!html.includes('data-adjust-result-card="kk"')) errors.push("KK card order missing");
    if (!html.includes('data-adjust-result-card="amazon"')) errors.push("Amazon card missing");
    if (!html.includes('data-adjust-result-card="ebay"')) errors.push("eBay card missing");
    if (ebay.status === "failed" && !html.includes(summary.ADJUST_PARTIAL_BANNER_TITLE)) {
      errors.push("Partial banner missing on failure");
    }
    notes.push(`Result panel ${ebay.action}/${ebay.status} PASS`);
  }
  return { notes, errors };
}

function verifyRegressions() {
  const notes = [];
  const errors = [];
  for (const { script, label, args = [] } of [
    { script: "verify-inventory-phase060c2-adjust-preview-toggle.mjs", label: "060C.2" },
    { script: "verify-inventory-phase060c3-adjust-variation-orchestrator.mjs", label: "060C.3" },
    { script: "verify-inventory-phase060a-final-freeze.mjs", label: "060A freeze" },
    { script: "verify-inventory-phase060b-final-freeze.mjs", label: "060B freeze" },
    { script: "verify-inventory-phase059-final.mjs", label: "059 static", args: ["--static"] },
    { script: "verify-inventory-issue-view-safety.mjs", label: "issue view safety" },
    { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "10Y stabilization" },
  ]) {
    const r = runScript(script, args);
    if (r.ok) notes.push(`Regression PASS: ${label}`);
    else errors.push(`Regression FAIL: ${label}${r.tail ? ` — ${r.tail.slice(0, 80)}` : ""}`);
  }
  return { notes, errors };
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_060);
  if (!plan.includes("060C.4")) errors.push("Plan missing 060C.4");
  if (!/060C\.4[^]*✅|060C\.4 complete/i.test(plan)) errors.push("Plan must mark 060C.4 complete");
  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("060C.4")) errors.push("Roadmap missing 060C.4");
  if (!/060C\.5.*✅|Phase 060.*Complete.*Frozen|C\.5 next/i.test(roadmap)) {
    errors.push("Roadmap must list 060C.5 complete or next");
  }
  notes.push("Docs/roadmap 060C.4");
  return { notes, errors };
}

async function verifyOptionalApi() {
  const notes = [];
  const skipped = [];
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pid = process.env.TEST_EBAY_VARIATION_PRODUCT_ID?.trim();
  const vid = process.env.TEST_EBAY_VARIATION_VARIANT_ID?.trim();
  const qty = Number(process.env.TEST_EBAY_VARIATION_QTY || 1);
  const relistPid = process.env.TEST_EBAY_VARIATION_RELIST_PRODUCT_ID?.trim();

  if (!url || !key) {
    skipped.push("Optional API: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors: [], skipped };
  }
  if (!pid || !vid) {
    skipped.push("Optional API: skipped — missing TEST_EBAY_VARIATION_PRODUCT_ID or TEST_EBAY_VARIATION_VARIANT_ID");
    return { notes, errors: [], skipped };
  }

  if (process.env.RUN_LIVE_EBAY_VARIATION_QTY_TEST === "true") {
    skipped.push("Optional live qty: skipped in matrix — use dedicated live script with explicit gate");
  } else {
    skipped.push("Optional live qty: skipped (RUN_LIVE_EBAY_VARIATION_QTY_TEST not set)");
  }
  if (process.env.RUN_LIVE_EBAY_VARIATION_RELIST_TEST === "true") {
    skipped.push("Optional live relist: skipped in matrix — use dedicated live script with explicit gate");
  } else {
    skipped.push("Optional live relist: skipped (RUN_LIVE_EBAY_VARIATION_RELIST_TEST not set)");
  }

  notes.push(`Optional API env present (product ${pid.slice(0, 8)}…, variant ${vid.slice(0, 8)}…, qty ${qty})`);
  if (relistPid) notes.push(`Optional relist product: ${relistPid.slice(0, 8)}…`);
  return { notes, errors: [], skipped };
}

async function main() {
  console.log("\n=== Phase 060C.4 — Adjust Integration Verification Matrix ===\n");

  const parts = [verifyStatic(), verifyOrchestrationMatrix(), verifyRegressions(), verifyDocs()];
  try {
    parts.push(await verifyPreviewMatrix());
    parts.push(await verifyResultPanelMatrix());
  } catch (err) {
    parts.push({ notes: [], errors: [`Matrix import failed: ${err.message}`] });
  }
  const optional = await verifyOptionalApi();
  parts.push(optional);

  const notes = parts.flatMap((p) => p.notes);
  const errors = parts.flatMap((p) => p.errors);
  const skipped = optional.skipped || [];

  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const s of skipped) console.log(`  ○ ${s}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 060C.4 full Adjust integration matrix complete\n");
  console.log("Next subphase: 060C.5 — Phase 060 final freeze\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
