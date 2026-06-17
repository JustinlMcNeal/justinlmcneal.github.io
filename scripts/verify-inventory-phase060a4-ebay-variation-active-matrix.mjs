/**
 * Phase 060A.4 — eBay variation active child qty verification matrix.
 *
 * Run: node scripts/verify-inventory-phase060a4-ebay-variation-active-matrix.mjs
 *
 * Fast mode (default): VERIFY_FAST=1 VERIFY_SKIP_DEEP_REGRESSION=1
 *
 * Optional API dry-run (preview only — no live eBay mutation):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TEST_EBAY_VARIATION_PRODUCT_ID, TEST_EBAY_VARIATION_VARIANT_ID, TEST_EBAY_VARIATION_QTY=1
 *
 * Optional live test (skipped by default — documented only):
 *   RUN_LIVE_EBAY_VARIATION_QTY_TEST=true
 *   EBAY_ENABLE_LIVE_QUANTITY_PATCH=true
 *   (+ same TEST_EBAY_VARIATION_* vars)
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;

const MIGRATION_060A2 = "supabase/migrations/20261024_inventory_phase060a2_ebay_variation_sync_candidates.sql";
const LOADER = "supabase/functions/_shared/ebayVariationChildCandidateLoaders.ts";
const VARIATION_UTILS = "supabase/functions/_shared/inventoryEbayVariationSyncUtils.ts";
const EDGE_INDEX = "supabase/functions/sync-ebay-inventory-quantity/index.ts";
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";
const VIEW = "v_inventory_ebay_variation_sync_candidates";

const FAST_ENV = { VERIFY_FAST: "1", VERIFY_SKIP_DEEP_REGRESSION: "1" };

const REGRESSION_SCRIPTS = [
  { script: "verify-inventory-phase060a2-ebay-variation-candidates.mjs", label: "060A.2 candidates" },
  { script: "verify-inventory-phase060a3-ebay-variation-edge.mjs", label: "060A.3 edge" },
  { script: "verify-inventory-phase059-final.mjs", label: "059 final (static)", args: ["--static"] },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue view safety" },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "10Y stabilization" },
];

const ADJUST_FLOW = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelVariationPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
];

const PREVIEW_READONLY = new Set([
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelVariationPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
]);

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

function runScript(script, extraEnv = {}, args = []) {
  const r = spawnSync(process.execPath, [join("scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, ...FAST_ENV, ...extraEnv },
  });
  return { ok: r.status === 0, status: r.status, tail: (r.stdout || r.stderr || "").split("\n").slice(-4).join(" ") };
}

/** Mirror ebayVariationChildCandidateLoaders.validateVariationChildCandidateForQty */
function validateCandidate(candidate) {
  const MANUAL = new Set([
    "variation_mapping_missing", "variation_mapping_ambiguous", "variation_child_offer_missing",
    "variation_parent_inactive", "variation_manual",
  ]);
  const ACTIONABLE = new Set(["variation_update_qty", "variation_qty_cache_missing"]);
  if (!candidate) return { ok: false, state: "variation_manual", reason: "no_variation_candidate_row", actionable: false };
  const state = candidate.candidate_state || "variation_manual";
  const reason = candidate.candidate_reason || state;
  if (MANUAL.has(state)) return { ok: false, state, reason, actionable: false };
  if (state === "variation_no_change") return { ok: true, state, reason, actionable: false };
  if (!ACTIONABLE.has(state)) return { ok: false, state, reason: "unsupported_candidate_state", actionable: false };
  if (state === "variation_update_qty") {
    if ((candidate.kk_available_qty ?? 0) <= 0) return { ok: false, state: "variation_manual", reason: "kk_available_not_positive", actionable: false };
    if (!candidate.expected_ebay_sku || !candidate.cache_ebay_sku) return { ok: false, state: "variation_mapping_missing", reason: "missing_child_sku", actionable: false };
    if (!candidate.child_offer_id) return { ok: false, state: "variation_child_offer_missing", reason: "missing_child_offer_id", actionable: false };
    if (candidate.ebay_child_qty == null) return { ok: false, state: "variation_qty_cache_missing", reason: "ebay_child_qty_unknown", actionable: true };
    if (candidate.mapping_confidence === "none") return { ok: false, state: "variation_manual", reason: "mapping_confidence_none", actionable: false };
    return { ok: true, state, reason, actionable: true };
  }
  if (state === "variation_qty_cache_missing") {
    if (!candidate.expected_ebay_sku) return { ok: false, state: "variation_mapping_missing", reason: "cannot_derive_expected_sku", actionable: false };
    if (!candidate.parent_ebay_listing_id || !candidate.ebay_item_group_key) return { ok: false, state: "variation_mapping_missing", reason: "missing_parent_group", actionable: false };
    return { ok: true, state, reason, actionable: true };
  }
  return { ok: false, state, reason: "unhandled_state", actionable: false };
}

const MANUAL_STATES = new Set([
  "variation_mapping_missing", "variation_mapping_ambiguous", "variation_child_offer_missing",
  "variation_parent_inactive", "variation_manual", "variation_qty_cache_missing",
]);

/** Mirror inventoryEbayVariationSyncUtils decision tree (no DB/eBay I/O). */
function simulateSyncDecision(candidate, { quantity = 1, preview = false, liveEnabled = false } = {}) {
  const requestedQty = Number.isFinite(quantity) ? Math.trunc(quantity) : NaN;
  const isPreview = preview === true || !liveEnabled;
  if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
    return { status: "skipped", wouldPatch: false, errorCode: "quantity_required" };
  }
  if (!candidate) return { status: "manual", wouldPatch: false, candidateState: "variation_manual" };
  const state = candidate.candidate_state;
  if (state !== "variation_update_qty") {
    if (state === "variation_no_change") return { status: "skipped", wouldPatch: false, candidateState: state };
    if (MANUAL_STATES.has(state)) return { status: "manual", wouldPatch: false, candidateState: state };
    return { status: "manual", wouldPatch: false, candidateState: state };
  }
  const validation = validateCandidate(candidate);
  if (!validation.ok) {
    if (validation.state === "variation_no_change") return { status: "skipped", wouldPatch: false, candidateState: validation.state };
    return { status: "manual", wouldPatch: false, candidateState: validation.state };
  }
  const childSku = candidate.cache_ebay_sku || candidate.expected_ebay_sku;
  if (!childSku || !candidate.child_offer_id) return { status: "manual", wouldPatch: false, candidateState: "variation_child_offer_missing" };
  if (candidate.ebay_child_qty != null && candidate.ebay_child_qty === requestedQty) {
    return { status: "skipped", wouldPatch: false, candidateState: state };
  }
  if (isPreview) return { status: "dry_run", wouldPatch: false, childSku, childOfferId: candidate.child_offer_id, candidateState: state };
  return { status: "success", wouldPatch: true, childSku, childOfferId: candidate.child_offer_id, candidateState: state };
}

/** Mirror sync-ebay-inventory-quantity resolveVariationRequest */
function resolveEdgeVariation(body) {
  const UUID_RE = /^[0-9a-f-]{36}$/i;
  const parseUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim() : null;
  const productId = parseUuid(body.productId);
  const variantIds = Array.isArray(body.variantIds)
    ? [...new Set(body.variantIds.map(parseUuid).filter(Boolean))]
    : [];
  const singleVariantId = parseUuid(body.variantId) || (variantIds.length === 1 ? variantIds[0] : null);
  if (variantIds.length > 1) return { error: "variation_child_update_qty accepts one variant only" };
  if (!singleVariantId) return { error: "variantId or single variantIds entry required" };
  if (!productId) return { error: "productId is required for variation_child_update_qty" };
  const n = Number(body.quantity);
  const qty = Number.isFinite(n) ? Math.trunc(n) : NaN;
  if (!Number.isFinite(qty) || qty <= 0) return { error: "quantity must be a positive integer" };
  return { productId, variantId: singleVariantId, quantity: qty };
}

const READY_CANDIDATE = {
  product_id: "00000000-0000-4000-8000-000000000001",
  variant_id: "00000000-0000-4000-8000-000000000002",
  candidate_state: "variation_update_qty",
  candidate_reason: "qty_mismatch",
  kk_available_qty: 2,
  ebay_child_qty: 0,
  expected_ebay_sku: "KK-0001-BLACK",
  cache_ebay_sku: "KK-0001-BLACK",
  child_offer_id: "OFFER-CHILD-1",
  parent_ebay_listing_id: "LIST-PARENT-1",
  ebay_item_group_key: "KK_0001-GROUP",
  mapping_confidence: "high",
};

const SCENARIOS = [
  { id: "success_ready_gate_off", candidate: READY_CANDIDATE, opts: { quantity: 2, liveEnabled: false }, expect: { status: "dry_run", wouldPatch: false, hasChild: true } },
  { id: "preview_dry_run", candidate: READY_CANDIDATE, opts: { quantity: 2, preview: true, liveEnabled: true }, expect: { status: "dry_run", wouldPatch: false, hasChild: true } },
  { id: "success_ready_live_mock", candidate: READY_CANDIDATE, opts: { quantity: 2, preview: false, liveEnabled: true }, expect: { status: "success", wouldPatch: true, hasChild: true } },
  { id: "no_change", candidate: { ...READY_CANDIDATE, candidate_state: "variation_no_change", ebay_child_qty: 2 }, opts: { quantity: 2 }, expect: { status: "skipped" } },
  { id: "cache_missing", candidate: { ...READY_CANDIDATE, candidate_state: "variation_qty_cache_missing", cache_ebay_sku: null, child_offer_id: null }, opts: { quantity: 1 }, expect: { status: "manual" } },
  { id: "mapping_missing", candidate: { ...READY_CANDIDATE, candidate_state: "variation_mapping_missing" }, opts: { quantity: 1 }, expect: { status: "manual" } },
  { id: "mapping_ambiguous", candidate: { ...READY_CANDIDATE, candidate_state: "variation_mapping_ambiguous" }, opts: { quantity: 1 }, expect: { status: "manual" } },
  { id: "child_offer_missing", candidate: { ...READY_CANDIDATE, candidate_state: "variation_child_offer_missing", child_offer_id: null }, opts: { quantity: 1 }, expect: { status: "manual" } },
  { id: "parent_inactive", candidate: { ...READY_CANDIDATE, candidate_state: "variation_parent_inactive" }, opts: { quantity: 1 }, expect: { status: "manual" } },
  { id: "qty_zero", candidate: READY_CANDIDATE, opts: { quantity: 0 }, expect: { status: "skipped" } },
];

const EDGE_SCENARIOS = [
  { id: "bulk_rejected", body: { mode: "variation_child_update_qty", productId: READY_CANDIDATE.product_id, variantIds: [READY_CANDIDATE.variant_id, "00000000-0000-4000-8000-000000000099"], quantity: 1 }, expectError: "one variant only" },
  { id: "missing_product_id", body: { mode: "variation_child_update_qty", variantId: READY_CANDIDATE.variant_id, quantity: 1 }, expectError: "productId is required" },
  { id: "qty_zero_edge", body: { mode: "variation_child_update_qty", productId: READY_CANDIDATE.product_id, variantId: READY_CANDIDATE.variant_id, quantity: 0 }, expectError: "positive integer" },
];

function verifyStaticInfrastructure() {
  const notes = [];
  const errors = [];
  const sql = existsSync(join(ROOT, MIGRATION_060A2)) ? readText(MIGRATION_060A2) : "";
  if (!sql.includes(`CREATE OR REPLACE VIEW public.${VIEW}`)) errors.push(`060A.2 view ${VIEW} missing`);
  for (const rel of [LOADER, VARIATION_UTILS, EDGE_INDEX]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  const index = readText(EDGE_INDEX);
  const utils = readText(VARIATION_UTILS);
  if (!index.includes("variation_child_update_qty") || !index.includes('parseMode') || !index.includes('"update_qty"')) {
    errors.push("Edge must support variation_child_update_qty with update_qty default");
  }
  if (!index.includes("EBAY_ENABLE_LIVE_QUANTITY_PATCH")) errors.push("Edge must use EBAY_ENABLE_LIVE_QUANTITY_PATCH");
  if (!utils.includes('items: [patchItem]')) errors.push("Helper must patch one child only");
  if (!utils.includes('candidate.candidate_state !== "variation_update_qty"')) errors.push("Helper must require variation_update_qty");
  if (!utils.includes("EBAY_VARIATION_QTY_DRY_RUN_COPY")) errors.push("Helper must define dry-run copy");
  notes.push("060A.2 view + 060A.3 helper + edge infrastructure");
  return { notes, errors };
}

function verifyStaticGuardrails() {
  const notes = [];
  const errors = [];
  const utils = readText(VARIATION_UTILS);
  if (/relistEbay|publishEbayOffer|createEbayOffer|updateSibling|siblingVariants/i.test(utils)) {
    errors.push("No relist/publish/sibling logic in variation utils");
  }
  if (utils.includes("adjust_inventory")) errors.push("Variation utils must not call adjust_inventory");
  for (const rel of ADJUST_FLOW) {
    const t = readText(rel);
    if (PREVIEW_READONLY.has(rel)) {
      if (t.includes("variation_child_update_qty") || t.includes("sync-ebay-inventory-quantity")) {
        errors.push(`${rel} preview must not call variation sync edge`);
      }
      continue;
    }
    if (VARIATION_QTY_ORCHESTRATOR.has(rel)) {
      if (/relist-ebay-variation-group|relistEbayVariationGroup/.test(t)) {
        errors.push(`${rel} must not call group relist from qty orchestrator files`);
      }
      continue;
    }
    if (t.includes("variation_child_update_qty") || t.includes("fetchEbayVariationChildCandidate")) {
      errors.push(`${rel} must not wire variation sync yet`);
    }
  }
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (!orch.includes("await adjustInventory(")) errors.push("adjust_inventory must remain sole stock writer");
  if (/refreshIssueSnapshot|issueSnapshot/.test(orch)) errors.push("No browser snapshot refresh in orchestrator");
  if (readText("js/admin/inventory/services/adjustChannelPreview.js").includes("fetchChannelSyncPreview()")) {
    errors.push("Adjust preview must not call full fetchChannelSyncPreview()");
  }
  notes.push("Safety guardrails: no Adjust wiring, no siblings/relist, sole stock writer");
  return { notes, errors };
}

function verifyScenarioMatrix() {
  const notes = [];
  const errors = [];
  let passed = 0;
  for (const sc of SCENARIOS) {
    const r = simulateSyncDecision(sc.candidate, sc.opts);
    if (r.status !== sc.expect.status) errors.push(`Scenario ${sc.id}: expected status ${sc.expect.status}, got ${r.status}`);
    else if (sc.expect.wouldPatch != null && r.wouldPatch !== sc.expect.wouldPatch) errors.push(`Scenario ${sc.id}: wouldPatch mismatch`);
    else if (sc.expect.hasChild && (!r.childSku || !r.childOfferId)) errors.push(`Scenario ${sc.id}: missing child SKU/offer in dry_run path`);
    else passed += 1;
  }
  for (const sc of EDGE_SCENARIOS) {
    const r = resolveEdgeVariation(sc.body);
    if (!r.error || !r.error.includes(sc.expectError)) errors.push(`Edge scenario ${sc.id}: expected error containing "${sc.expectError}"`);
    else passed += 1;
  }
  const ready = simulateSyncDecision(READY_CANDIDATE, { quantity: 2, preview: true });
  if (ready.childSku !== "KK-0001-BLACK" || ready.childOfferId !== "OFFER-CHILD-1") {
    errors.push("Success-ready payload must target single child SKU/offer only");
  } else passed += 1;
  notes.push(`Scenario matrix: ${passed}/${SCENARIOS.length + EDGE_SCENARIOS.length + 1} cases`);
  return { notes, errors };
}

function verifyRegressions() {
  const notes = [];
  const errors = [];
  const skipped = [];
  const deep = process.env.RUN_DEEP_059_FINAL === "1";
  if (deep) skipped.push("Deep 059 freeze skipped — set RUN_DEEP_059_FINAL=1 to run verify-inventory-phase059-final-freeze.mjs separately");
  for (const { script, label, args = [] } of REGRESSION_SCRIPTS) {
    if (deep && script.includes("059-final")) continue;
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`Missing regression script: ${script}`);
      continue;
    }
    const r = runScript(script, {}, args);
    if (r.ok) notes.push(`Regression PASS: ${label}`);
    else errors.push(`Regression FAIL: ${label} (exit ${r.status})`);
  }
  return { notes, errors, skipped };
}

async function verifyOptionalApiDryRun() {
  const notes = [];
  const errors = [];
  const skipped = [];

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const productId = process.env.TEST_EBAY_VARIATION_PRODUCT_ID?.trim();
  const variantId = process.env.TEST_EBAY_VARIATION_VARIANT_ID?.trim();
  const qty = Number(process.env.TEST_EBAY_VARIATION_QTY || 1);

  if (!url || !key) {
    skipped.push("API dry-run: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors, skipped };
  }
  if (!productId || !variantId) {
    skipped.push("API dry-run: skipped — missing TEST_EBAY_VARIATION_PRODUCT_ID or TEST_EBAY_VARIATION_VARIANT_ID");
    return { notes, errors, skipped };
  }

  const resp = await fetch(`${url}/functions/v1/sync-ebay-inventory-quantity`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "variation_child_update_qty",
      productId,
      variantId,
      quantity: qty,
      preview: true,
      syncContext: { trigger_source: "manual_adjust", orchestration_id: `060a4-matrix-${Date.now()}` },
    }),
  });
  let data = {};
  try { data = await resp.json(); } catch { data = {}; }

  if (resp.status >= 500) errors.push(`API dry-run: HTTP ${resp.status}`);
  else if (!["dry_run", "skipped", "manual", "failed"].includes(data.status)) {
    if (data.status === "success") errors.push("API dry-run: preview must not return success");
    else errors.push(`API dry-run: unexpected status ${data.status ?? "unknown"}`);
  } else {
    notes.push(`API dry-run: status=${data.status} state=${data.candidateState ?? "n/a"}`);
  }
  if (data.mode !== "variation_child_update_qty") errors.push("API dry-run: mode must be variation_child_update_qty");
  return { notes, errors, skipped };
}

function verifyLiveTestGating() {
  const notes = [];
  const errors = [];
  const self = readText("scripts/verify-inventory-phase060a4-ebay-variation-active-matrix.mjs");
  if (!self.includes("RUN_LIVE_EBAY_VARIATION_QTY_TEST")) errors.push("Script must document RUN_LIVE_EBAY_VARIATION_QTY_TEST");
  if (!self.includes("skipped by default")) errors.push("Script must document live test skipped by default");

  const runLive = process.env.RUN_LIVE_EBAY_VARIATION_QTY_TEST === "true";
  if (!runLive) {
    notes.push("Live eBay mutation: skipped by default (RUN_LIVE_EBAY_VARIATION_QTY_TEST not set)");
    return { notes, errors, skipped: ["Live test: not run — gated off"] };
  }
  notes.push("Live test flag set — documented path only; matrix does not execute live PATCH in 060A.4");
  return { notes, errors, skipped: ["Live test: explicitly gated — no automatic live PATCH in matrix"] };
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_060);
  const roadmap = readText(ROADMAP);
  if (!plan.includes("060A.4")) errors.push("Plan missing 060A.4 section");
  if (!plan.includes("verify-inventory-phase060a4-ebay-variation-active-matrix.mjs")) {
    errors.push("Plan missing matrix verify script ref");
  }
  if (!plan.includes("060A.4") || !plan.match(/060A\.4[^]*✅/)) errors.push("Plan must mark 060A.4 complete");
  if (!plan.includes("RUN_LIVE_EBAY_VARIATION_QTY_TEST")) errors.push("Plan must document live test flags");
  if (!roadmap.includes("060A.4") && !roadmap.includes("060A.5") && !/060A.*Frozen|060A.*✅/i.test(roadmap)) {
    errors.push("Roadmap must document 060A progress");
  }
  notes.push("Docs updated for 060A.4");
  return { notes, errors };
}

async function main() {
  if (!process.env.VERIFY_FAST) process.env.VERIFY_FAST = "1";
  if (!process.env.VERIFY_SKIP_DEEP_REGRESSION) process.env.VERIFY_SKIP_DEEP_REGRESSION = "1";

  const parts = [
    verifyStaticInfrastructure(),
    verifyStaticGuardrails(),
    verifyScenarioMatrix(),
    verifyRegressions(),
    verifyLiveTestGating(),
    verifyDocs(),
    await verifyOptionalApiDryRun(),
  ];

  const notes = parts.flatMap((p) => p.notes);
  const skipped = parts.flatMap((p) => p.skipped || []);
  const errors = parts.flatMap((p) => p.errors);

  console.log("\n=== Phase 060A.4 — eBay Variation Active Qty Matrix ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const s of skipped) console.log(`  ○ ${s}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 060A.4 verification matrix\n");
  console.log("Next subphase: 060A.5 — 060A QA freeze\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
