/**
 * Phase 060B.4 — eBay ended variation group relist verification matrix.
 *
 * Run: node scripts/verify-inventory-phase060b4-ebay-variation-relist-matrix.mjs
 *
 * Fast mode (default): VERIFY_FAST=1 VERIFY_SKIP_DEEP_REGRESSION=1
 *
 * Optional API dry-run:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid>
 *
 * Optional live test (skipped by default — creates real eBay listing):
 *   RUN_LIVE_EBAY_VARIATION_RELIST_TEST=true
 *   EBAY_ENABLE_LIVE_VARIATION_RELIST=true
 *   TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid>
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";
const FAST_ENV = { VERIFY_FAST: "1", VERIFY_SKIP_DEEP_REGRESSION: "1" };

const EDGE_FILES = [
  "supabase/functions/relist-ebay-variation-group/index.ts",
  "supabase/functions/_shared/ebayVariationGroupRelistUtils.ts",
  "supabase/functions/_shared/ebayVariationGroupRelistValidation.ts",
  "supabase/functions/_shared/ebayVariationGroupRelistPublish.ts",
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

const VARIATION_RELIST_ORCHESTRATOR = new Set([
  "js/admin/inventory/api/ebayVariationGroupRelistApi.js",
  "js/admin/inventory/services/adjustChannelEbayVariationBranch.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
]);

const REGRESSION_SCRIPTS = [
  { script: "verify-inventory-phase060b1-ebay-variation-relist-audit.mjs", label: "060B.1 audit" },
  { script: "verify-inventory-phase060b2-ebay-variation-relist-candidates.mjs", label: "060B.2 candidates" },
  { script: "verify-inventory-phase060b3-ebay-variation-relist-edge.mjs", label: "060B.3 edge" },
  { script: "verify-inventory-phase060a-final-freeze.mjs", label: "060A freeze" },
  { script: "verify-inventory-phase059-final.mjs", label: "059 final (static)", args: ["--static"] },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue view safety" },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "10Y stabilization" },
];

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
  return { ok: r.status === 0, status: r.status, tail: (r.stdout || r.stderr || "").split("\n").slice(-5).join(" ") };
}

/** Mirror validateStructuralGroupCandidate */
function validateStructural(candidate) {
  const SKIP = new Set(["variation_group_active", "variation_group_no_change"]);
  if (!candidate) return { ok: false, status: "manual", skipped: false, reason: "no_row" };
  const state = candidate.candidate_state || "variation_group_manual";
  if (SKIP.has(state)) return { ok: true, status: "skipped", skipped: true, reason: state };
  if (state === "variation_group_no_in_stock_children" || candidate.in_stock_child_count <= 0) {
    return { ok: false, status: "skipped", skipped: true, reason: "no_in_stock" };
  }
  if (candidate.variant_count < 2 || !candidate.ebay_item_group_key) {
    return { ok: false, status: "manual", skipped: false, reason: "unsupported_structure" };
  }
  if (candidate.ambiguous_child_count > 0) return { ok: false, status: "manual", skipped: false, reason: "ambiguous" };
  if (candidate.conflict_child_skus?.length) return { ok: false, status: "manual", skipped: false, reason: "conflict" };
  if (candidate.missing_child_count > 0 || candidate.mapped_child_count < candidate.variant_count) {
    return { ok: false, status: "manual", skipped: false, reason: "mapping_missing" };
  }
  if (!candidate.has_category || !candidate.has_images || !candidate.has_variation_options) {
    return { ok: false, status: "manual", skipped: false, reason: "incomplete_metadata" };
  }
  const children = candidate.child_payload_json || [];
  if (children.length < candidate.variant_count) return { ok: false, status: "manual", skipped: false, reason: "incomplete_payload" };
  for (const c of children) {
    if (!c.sku || c.mappingState !== "clean") return { ok: false, status: "manual", skipped: false, reason: "child_not_clean" };
  }
  return { ok: true, status: "validated", skipped: false, reason: "ok" };
}

function resolvePolicies(env) {
  const f = String(env.EBAY_FULFILLMENT_POLICY_ID || "").trim();
  const r = String(env.EBAY_RETURN_POLICY_ID || "").trim();
  const p = String(env.EBAY_PAYMENT_POLICY_ID || "").trim();
  const missing = [];
  if (!f) missing.push("EBAY_FULFILLMENT_POLICY_ID");
  if (!r) missing.push("EBAY_RETURN_POLICY_ID");
  if (!p) missing.push("EBAY_PAYMENT_POLICY_ID");
  if (missing.length) return { ok: false, missing };
  return { ok: true, policies: { fulfillmentPolicyId: f, returnPolicyId: r, paymentPolicyId: p } };
}

function buildPlan(candidate, product) {
  const priceCents = Number(product.ebay_price_cents || product.price * 100 || 0);
  if (!priceCents) return { ok: false, reason: "missing_price" };
  const children = (candidate.child_payload_json || []).map((c) => ({
    variantId: c.variantId,
    sku: c.sku,
    quantity: Math.max(0, c.availableQty ?? 0),
    includeInRelist: (c.availableQty ?? 0) > 0,
    mappingState: c.mappingState,
  }));
  if (!children.some((c) => c.quantity > 0)) return { ok: false, reason: "no_in_stock" };
  const variantQuantities = Object.fromEntries(children.map((c) => [c.sku, c.quantity]));
  return {
    ok: true,
    plan: {
      groupKey: candidate.ebay_item_group_key,
      oldListingId: candidate.old_ebay_listing_id,
      children,
      allVariantSkus: children.map((c) => c.sku),
      variantQuantities,
      priceCents,
    },
  };
}

/** Mock orchestration — no DB/eBay I/O */
function simulateRelist({
  candidate,
  product = {},
  env = {},
  preview = false,
  liveEnabled = false,
  publishMock = null,
  reconcileOk = true,
}) {
  const dryRun = preview || !liveEnabled;
  const structural = validateStructural(candidate);
  if (!candidate) return { status: "manual", wouldWrite: false, reason: "no_candidate" };
  if (structural.skipped) return { status: "skipped", wouldWrite: false, reason: structural.reason };
  if (!structural.ok) return { status: "manual", wouldWrite: false, reason: structural.reason };

  if (!String(product.name || candidate.title || "").trim()) {
    return { status: "manual", wouldWrite: false, reason: "missing_title" };
  }
  if (!String(product.ebay_category_id || candidate.ebay_category_id || "").trim()) {
    return { status: "manual", wouldWrite: false, reason: "missing_category" };
  }
  if (!(product.primary_image_url || candidate.has_images)) {
    return { status: "manual", wouldWrite: false, reason: "missing_images" };
  }

  const policies = resolvePolicies(env);
  if (!policies.ok) return { status: "manual", wouldWrite: false, reason: "missing_policies", missing: policies.missing };

  const conditionWarning = !candidate.condition_id;
  const planResult = buildPlan(candidate, product);
  if (!planResult.ok) return { status: "manual", wouldWrite: false, reason: planResult.reason };

  const plan = planResult.plan;
  const qtyZeroSiblings = plan.children.filter((c) => c.quantity <= 0);
  const warnings = [];
  if (conditionWarning) warnings.push("condition_default_new");
  if (qtyZeroSiblings.length) {
    warnings.push("qty_zero_siblings_may_fail_publish");
  }

  if (dryRun) {
    return {
      status: "dry_run",
      wouldWrite: false,
      groupKey: plan.groupKey,
      childCount: plan.children.length,
      inStock: plan.children.filter((c) => c.quantity > 0).length,
      qtyZeroSiblings: qtyZeroSiblings.length,
      allSkus: plan.allVariantSkus,
      warnings,
    };
  }

  const pub = publishMock || { ok: true, listingId: "NEW-LIST-1", offerIds: ["O1", "O2"] };
  if (!pub.ok) {
    return {
      status: "failed",
      wouldWrite: true,
      reason: pub.error || "publish_failed",
      step: pub.step,
      offerIds: pub.offerIds,
      listingId: pub.listingId,
    };
  }

  if (!reconcileOk) {
    return {
      status: "failed",
      wouldWrite: true,
      listingId: pub.listingId,
      offerIds: pub.offerIds,
      reconcileFailed: true,
      message: "eBay may have published the variation group, but DB reconciliation failed.",
    };
  }

  const oldId = plan.oldListingId;
  const newId = pub.listingId;
  return {
    status: "success",
    wouldWrite: true,
    listingId: newId,
    offerIds: pub.offerIds,
    oldListingReactivated: oldId && oldId === newId,
    warnings,
  };
}

function mockPublishChain(plan, { failAt = null, rejectQtyZero = false } = {}) {
  const steps = ["create_child_items", "create_item_group", "create_group_offers", "publish_by_inventory_item_group"];
  for (const step of steps) {
    if (failAt === step) return { ok: false, step, error: `${step}_failed` };
  }
  if (rejectQtyZero && Object.values(plan.variantQuantities).some((q) => q <= 0)) {
    return { ok: false, step: "publish_by_inventory_item_group", error: "publish_requires_all_variant_qty_gt_0" };
  }
  return { ok: true, listingId: "NEW-GROUP-LIST-99", offerIds: plan.allVariantSkus.map((_, i) => `OFFER-${i + 1}`) };
}

const BASE_CHILD = (sku, qty, opt) => ({
  variantId: `00000000-0000-4000-8000-${sku.slice(-4).padStart(12, "0")}`,
  sku,
  optionValue: opt,
  availableQty: qty,
  includeInRelist: qty > 0,
  mappingState: "clean",
});

const READY_CANDIDATE = {
  product_id: "00000000-0000-4000-8000-000000000001",
  product_code: "KK-0001",
  title: "Test Beanie Group",
  ebay_item_group_key: "KK-0001-GROUP",
  old_ebay_listing_id: "OLD-ENDED-123",
  parent_listing_status: "ended",
  ebay_category_id: "12345",
  condition_id: null,
  has_images: true,
  has_category: true,
  has_variation_options: true,
  variant_count: 2,
  in_stock_child_count: 1,
  mapped_child_count: 2,
  ambiguous_child_count: 0,
  missing_child_count: 0,
  conflict_child_skus: [],
  candidate_state: "variation_group_ready_to_relist",
  child_payload_json: [BASE_CHILD("KK-0001-BLK", 2, "Black"), BASE_CHILD("KK-0001-PNK", 0, "Pink")],
};

const READY_PRODUCT = {
  name: "Test Beanie Group",
  description: "<p>Test</p>",
  ebay_category_id: "12345",
  ebay_price_cents: 1999,
  primary_image_url: "https://example.com/img.jpg",
};

const POLICY_ENV = {
  EBAY_FULFILLMENT_POLICY_ID: "FUL-1",
  EBAY_RETURN_POLICY_ID: "RET-1",
  EBAY_PAYMENT_POLICY_ID: "PAY-1",
};

const SCENARIOS = [
  { id: "dry_run_gate_off", candidate: READY_CANDIDATE, env: POLICY_ENV, opts: { liveEnabled: false }, expect: { status: "dry_run", wouldWrite: false, minChildren: 2, qtyZeroSiblings: 1 } },
  { id: "preview_dry_run", candidate: READY_CANDIDATE, env: POLICY_ENV, opts: { preview: true, liveEnabled: true }, expect: { status: "dry_run", wouldWrite: false } },
  { id: "missing_policies", candidate: READY_CANDIDATE, env: {}, expect: { status: "manual", reason: "missing_policies" } },
  { id: "missing_images", candidate: { ...READY_CANDIDATE, has_images: false }, env: POLICY_ENV, expect: { status: "manual" } },
  { id: "missing_category", candidate: { ...READY_CANDIDATE, has_category: false, ebay_category_id: null }, env: POLICY_ENV, expect: { status: "manual" } },
  { id: "mapping_missing", candidate: { ...READY_CANDIDATE, mapped_child_count: 1, missing_child_count: 1 }, env: POLICY_ENV, expect: { status: "manual", reason: "mapping_missing" } },
  { id: "mapping_ambiguous", candidate: { ...READY_CANDIDATE, ambiguous_child_count: 1 }, env: POLICY_ENV, expect: { status: "manual", reason: "ambiguous" } },
  { id: "child_conflict", candidate: { ...READY_CANDIDATE, conflict_child_skus: ["KK-0001-BLK"] }, env: POLICY_ENV, expect: { status: "manual", reason: "conflict" } },
  { id: "no_in_stock", candidate: { ...READY_CANDIDATE, in_stock_child_count: 0, child_payload_json: [BASE_CHILD("KK-0001-BLK", 0, "Black"), BASE_CHILD("KK-0001-PNK", 0, "Pink")] }, env: POLICY_ENV, expect: { status: "skipped" } },
  { id: "group_active", candidate: { ...READY_CANDIDATE, candidate_state: "variation_group_active" }, env: POLICY_ENV, expect: { status: "skipped" } },
  { id: "condition_default_warning", candidate: READY_CANDIDATE, env: POLICY_ENV, opts: { liveEnabled: false }, expect: { status: "dry_run", hasWarning: "condition_default_new" } },
];

function verifyStatic() {
  const notes = [];
  const errors = [];
  for (const rel of EDGE_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  const index = readText("supabase/functions/relist-ebay-variation-group/index.ts");
  const utils = readText("supabase/functions/_shared/ebayVariationGroupRelistUtils.ts");
  const validation = readText("supabase/functions/_shared/ebayVariationGroupRelistValidation.ts");
  const publish = readText("supabase/functions/_shared/ebayVariationGroupRelistPublish.ts");

  if (!index.includes("EBAY_ENABLE_LIVE_VARIATION_RELIST")) errors.push("Dedicated gate missing");
  if (index.includes("EBAY_ENABLE_LIVE_RELIST") && !index.includes("EBAY_ENABLE_LIVE_VARIATION_RELIST")) {
    errors.push("Must not use single-SKU gate as sole gate");
  }
  if (!utils.includes("loadEbayVariationGroupRelistCandidate")) errors.push("Must load relist candidate view");
  if (!utils.includes("validateStructuralGroupCandidate")) errors.push("Full group validation required");
  if (!publish.includes("publish_by_inventory_item_group")) errors.push("Publish chain incomplete");
  if (!utils.includes("not reactivated")) errors.push("Old listing reactivation guard missing");
  if (!utils.includes("reconciliation failed")) errors.push("Reconcile failure warning missing");
  if (!utils.includes("qty-0 sibling")) errors.push("Qty-0 sibling publish warning missing");
  if (utils.includes("adjust_inventory")) errors.push("Must not call adjust_inventory");

  for (const rel of ADJUST_FLOW) {
    const t = readText(rel);
    if (PREVIEW_READONLY.has(rel)) {
      if (/relist-ebay-variation-group|relistEbayVariationGroup|syncEbayVariationGroup/.test(t)) {
        errors.push(`${rel} preview must not call relist edge`);
      }
      continue;
    }
    if (VARIATION_RELIST_ORCHESTRATOR.has(rel)) {
      if (/variation_child_update_qty|syncEbayVariationChildQuantity/.test(t)) {
        errors.push(`${rel} must not call qty edge from relist orchestrator files`);
      }
      continue;
    }
    if (/relist-ebay-variation-group|relistEbayVariationGroup/.test(t)) {
      errors.push(`${rel} must not wire variation relist yet`);
    }
  }
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) errors.push("adjust_inventory sole writer");

  notes.push("Static infrastructure + guardrails");
  return { notes, errors };
}

function verifyScenarioMatrix() {
  const notes = [];
  const errors = [];
  let passed = 0;

  for (const sc of SCENARIOS) {
    const r = simulateRelist({
      candidate: sc.candidate,
      product: sc.product ?? READY_PRODUCT,
      env: sc.env ?? {},
      ...sc.opts,
    });
    if (r.status !== sc.expect.status) {
      errors.push(`${sc.id}: expected status ${sc.expect.status}, got ${r.status}`);
      continue;
    }
    if (sc.expect.wouldWrite != null && r.wouldWrite !== sc.expect.wouldWrite) {
      errors.push(`${sc.id}: wouldWrite mismatch`);
      continue;
    }
    if (sc.expect.reason && r.reason !== sc.expect.reason) {
      errors.push(`${sc.id}: expected reason ${sc.expect.reason}, got ${r.reason}`);
      continue;
    }
    if (sc.expect.minChildren && r.childCount < sc.expect.minChildren) {
      errors.push(`${sc.id}: expected all ${sc.expect.minChildren} children in dry_run plan`);
      continue;
    }
    if (sc.expect.qtyZeroSiblings != null && r.qtyZeroSiblings !== sc.expect.qtyZeroSiblings) {
      errors.push(`${sc.id}: qtyZeroSiblings mismatch`);
      continue;
    }
    if (sc.expect.hasWarning && !(r.warnings || []).includes(sc.expect.hasWarning)) {
      errors.push(`${sc.id}: missing warning ${sc.expect.hasWarning}`);
      continue;
    }
    passed += 1;
  }

  const planResult = buildPlan(READY_CANDIDATE, READY_PRODUCT);
  const pub = mockPublishChain(planResult.plan, {});
  const live = simulateRelist({
    candidate: READY_CANDIDATE,
    product: READY_PRODUCT,
    env: POLICY_ENV,
    liveEnabled: true,
    preview: false,
    publishMock: pub,
  });
  if (live.status !== "success" || live.oldListingReactivated) {
    errors.push("Mocked live success: expected success without old listing reactivation");
  } else passed += 1;

  const pubFail = mockPublishChain(planResult.plan, { failAt: "create_group_offers" });
  const apiFail = simulateRelist({
    candidate: READY_CANDIDATE,
    product: READY_PRODUCT,
    env: POLICY_ENV,
    liveEnabled: true,
    publishMock: pubFail,
  });
  if (apiFail.status !== "failed" || apiFail.step !== "create_group_offers") {
    errors.push("eBay API failure scenario must return failed with step");
  } else passed += 1;

  const qtyZeroPub = mockPublishChain(planResult.plan, { rejectQtyZero: true });
  const qtyZeroLive = simulateRelist({
    candidate: READY_CANDIDATE,
    product: READY_PRODUCT,
    env: POLICY_ENV,
    liveEnabled: true,
    publishMock: qtyZeroPub,
  });
  if (qtyZeroLive.status !== "failed" || !qtyZeroPub.error.includes("qty")) {
    errors.push("Qty-0 sibling live mock must fail publish with clear reason");
  } else passed += 1;

  const reconcileFail = simulateRelist({
    candidate: READY_CANDIDATE,
    product: READY_PRODUCT,
    env: POLICY_ENV,
    liveEnabled: true,
    publishMock: pub,
    reconcileOk: false,
  });
  if (reconcileFail.status !== "failed" || !reconcileFail.reconcileFailed || !reconcileFail.message?.includes("reconciliation failed")) {
    errors.push("Reconciliation failure must return failed with partial-publish warning");
  } else passed += 1;

  notes.push(`Scenario matrix: ${passed}/${SCENARIOS.length + 4} cases`);
  return { notes, errors };
}

function verifyRegressions() {
  const notes = [];
  const errors = [];
  const skipped = [];
  if (process.env.RUN_DEEP_059_FINAL === "1") {
    skipped.push("Deep 059 freeze: run verify-inventory-phase059-final-freeze.mjs separately");
  }
  for (const { script, label, args = [] } of REGRESSION_SCRIPTS) {
    if (!existsSync(join(ROOT, "scripts", script))) {
      errors.push(`Missing regression: ${script}`);
      continue;
    }
    const nestedSkip = script.includes("060b3-ebay-variation-relist-edge") ? { VERIFY_SKIP_NESTED_REGRESSION: "1" } : {};
    const r = runScript(script, nestedSkip, args);
    if (r.ok) notes.push(`Regression PASS: ${label}`);
    else errors.push(`Regression FAIL: ${label} (${r.tail})`);
  }
  return { notes, errors, skipped };
}

async function verifyOptionalApi() {
  const notes = [];
  const errors = [];
  const skipped = [];
  if (process.env.RUN_LIVE_EBAY_VARIATION_RELIST_TEST === "true") {
    skipped.push("API dry-run skipped — live test flag set");
    return { notes, errors, skipped };
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const productId = process.env.TEST_EBAY_VARIATION_RELIST_PRODUCT_ID?.trim();
  if (!url || !key) {
    skipped.push("API dry-run: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors, skipped };
  }
  if (!productId) {
    skipped.push("API dry-run: skipped — missing TEST_EBAY_VARIATION_RELIST_PRODUCT_ID");
    return { notes, errors, skipped };
  }
  const resp = await fetch(`${url}/functions/v1/relist-ebay-variation-group`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ productId, preview: true, syncContext: { orchestration_id: `060b4-${Date.now()}` } }),
  });
  let data = {};
  try { data = await resp.json(); } catch { data = {}; }
  if (resp.status >= 500) errors.push(`API dry-run HTTP ${resp.status}`);
  else if (data.status === "success") errors.push("API preview must not return success");
  else if (!["dry_run", "manual", "skipped", "failed"].includes(data.status)) errors.push(`API unexpected status ${data.status}`);
  else notes.push(`API dry-run: status=${data.status}`);
  return { notes, errors, skipped };
}

function verifyLiveDoc() {
  const notes = [];
  const errors = [];
  const self = readText("scripts/verify-inventory-phase060b4-ebay-variation-relist-matrix.mjs");
  if (!self.includes("RUN_LIVE_EBAY_VARIATION_RELIST_TEST")) errors.push("Must document RUN_LIVE_EBAY_VARIATION_RELIST_TEST");
  if (process.env.RUN_LIVE_EBAY_VARIATION_RELIST_TEST === "true") {
    notes.push("Live test flag set — documented only; matrix does not auto-run live relist");
  } else {
    notes.push("Live eBay relist: skipped by default");
  }
  return { notes, errors, skipped: [] };
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_060);
  const roadmap = readText(ROADMAP);
  if (!plan.includes("060B.4")) errors.push("Plan missing 060B.4");
  if (!plan.includes("verify-inventory-phase060b4-ebay-variation-relist-matrix.mjs")) errors.push("Plan missing matrix script ref");
  if (!plan.includes("qty-0 sibling") && !plan.includes("qty-0")) errors.push("Plan must document qty-0 sibling behavior");
  if (!/060B\.4[^]*✅/i.test(plan)) errors.push("Plan must mark 060B.4 complete");
  if (!roadmap.includes("060B.4") && !roadmap.includes("B.4 verify") && !/060B.*Complete.*Frozen|060B.*✅/i.test(roadmap)) {
    errors.push("Roadmap missing 060B.4 or frozen marker");
  }
  if (!roadmap.includes("060B.5") && !/060B.*Complete.*Frozen|060B.*✅/i.test(roadmap)) {
    errors.push("Roadmap must list 060B.5 or mark 060B frozen");
  }
  notes.push("Docs updated for 060B.4");
  return { notes, errors };
}

async function main() {
  Object.assign(process.env, FAST_ENV);
  const parts = [
    verifyStatic(),
    verifyScenarioMatrix(),
    verifyRegressions(),
    verifyLiveDoc(),
    verifyDocs(),
    await verifyOptionalApi(),
  ];
  const notes = parts.flatMap((p) => p.notes);
  const skipped = parts.flatMap((p) => p.skipped || []);
  const errors = parts.flatMap((p) => p.errors);

  console.log("\n=== Phase 060B.4 — eBay Variation Group Relist Matrix ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const s of skipped) console.log(`  ○ ${s}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 060B.4 verification matrix\n");
  console.log("Next subphase: 060B.5 — 060B QA freeze\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
