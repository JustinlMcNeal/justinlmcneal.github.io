/**
 * Phase 060A.3 — eBay variation child qty edge verification.
 *
 * Run: node scripts/verify-inventory-phase060a3-ebay-variation-edge.mjs
 *
 * Optional env (preview dry-run API test only — no live eBay mutation):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TEST_EBAY_VARIATION_PRODUCT_ID, TEST_EBAY_VARIATION_VARIANT_ID, TEST_EBAY_VARIATION_QTY=1
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;

const VARIATION_UTILS = "supabase/functions/_shared/inventoryEbayVariationSyncUtils.ts";
const EDGE_INDEX = "supabase/functions/sync-ebay-inventory-quantity/index.ts";
const PLAN_060 = "docs/pages/admin/inventory/implementation/060_ebay_variation_group_automation_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

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

const AMAZON_EDGE_FILES = [
  "supabase/functions/sync-amazon-inventory-quantity/index.ts",
  "supabase/functions/_shared/inventoryAmazonSyncUtils.ts",
  "supabase/functions/_shared/inventoryAmazonInactiveRestock.ts",
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyFiles() {
  const notes = [];
  const errors = [];

  for (const rel of [VARIATION_UTILS, EDGE_INDEX]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
    else notes.push(`${rel}: ${lineCount(rel)} lines`);
  }

  const utils = readText(VARIATION_UTILS);
  const index = readText(EDGE_INDEX);

  if (!utils.includes("export async function syncEbayVariationChildQuantity")) {
    errors.push("Variation utils must export syncEbayVariationChildQuantity");
  }
  if (!utils.includes("EbayVariationQtySyncRequest") || !utils.includes("EbayVariationQtySyncResult")) {
    errors.push("Variation utils must export request/result types");
  }
  if (!utils.includes("loadEbayVariationChildCandidate")) {
    errors.push("Variation utils must load candidate via loader");
  }
  if (!utils.includes("validateVariationChildCandidateForQty")) {
    errors.push("Variation utils must validate candidate");
  }
  if (!utils.includes('candidate.candidate_state !== "variation_update_qty"')) {
    errors.push("Variation utils must require candidate_state variation_update_qty");
  }
  if (!utils.includes("processEbayQuantityPatches")) {
    errors.push("Variation utils must reuse processEbayQuantityPatches");
  }
  if (!utils.includes('items: [patchItem]')) {
    errors.push("Variation utils must patch one child item only");
  }
  if (!utils.includes('action: "variation_child_update_qty"')) {
    errors.push("Variation utils must log action variation_child_update_qty");
  }
  if (!utils.includes("EBAY_VARIATION_QTY_DRY_RUN_COPY")) {
    errors.push("Variation utils must define dry-run copy");
  }
  if (utils.includes("adjust_inventory") || utils.includes("adjustInventory")) {
    errors.push("Variation utils must not call adjust_inventory");
  }
  if (/relistEbay|publishEbayOffer|createEbayOffer|createEbayInventoryItem|updateSibling|siblingVariants|for\s*\(\s*const\s+sibling/i.test(utils)) {
    errors.push("Variation utils must not include relist/publish/sibling logic");
  }
  if (/inventoryAmazonInactiveRestock|sync-amazon-inventory|loadAmazonSyncCandidates/i.test(utils)) {
    errors.push("Variation utils must not import Amazon sync paths");
  }
  notes.push("Variation helper contract + guardrails");

  if (!index.includes('variation_child_update_qty')) {
    errors.push("Edge index must support mode variation_child_update_qty");
  }
  if (!index.includes('parseMode') || !index.includes('"update_qty"')) {
    errors.push("Edge index must default mode to update_qty");
  }
  if (!index.includes("syncEbayVariationChildQuantity")) {
    errors.push("Edge index must delegate variation mode to helper");
  }
  if (!index.includes("productId is required for variation_child_update_qty")) {
    errors.push("Edge must reject missing productId (no guessing)");
  }
  if (!index.includes("variation_child_update_qty accepts one variant only")) {
    errors.push("Edge must reject bulk variation requests");
  }
  if (!index.includes("quantity must be a positive integer")) {
    errors.push("Edge must require quantity > 0");
  }
  if (!index.includes("EBAY_ENABLE_LIVE_QUANTITY_PATCH")) {
    errors.push("Edge must reference EBAY_ENABLE_LIVE_QUANTITY_PATCH");
  }

  const defaultGateIdx = index.indexOf('if (!livePatchEnabled && !wantsPreview)');
  const variationBranchIdx = index.indexOf('mode === "variation_child_update_qty"');
  if (variationBranchIdx < 0 || defaultGateIdx < 0 || variationBranchIdx >= defaultGateIdx) {
    errors.push("Variation mode must run before default live_patch_disabled 403 gate");
  }
  notes.push("Edge mode contract + variation-before-403 ordering");

  const defaultPath = index.slice(defaultGateIdx);
  if (!defaultPath.includes("loadEbaySyncCandidates")) {
    errors.push("Default update_qty path must still load eBay sync candidates");
  }
  if (!defaultPath.includes('action: "set_quantity"')) {
    errors.push("Default update_qty path must preserve set_quantity action");
  }
  notes.push("Default update_qty path unchanged");

  return { notes, errors };
}

function verifyNoAdjustWiring() {
  const notes = [];
  const errors = [];

  for (const rel of ADJUST_FLOW) {
    const text = readText(rel);
    if (PREVIEW_READONLY.has(rel)) {
      if (/variation_child_update_qty|sync-ebay-inventory-quantity/.test(text)) {
        errors.push(`${rel} preview must not call variation sync edge`);
      }
      continue;
    }
    if (VARIATION_QTY_ORCHESTRATOR.has(rel)) {
      if (/relist-ebay-variation-group|relistEbayVariationGroup/.test(text)) {
        errors.push(`${rel} must not call group relist from qty orchestrator files`);
      }
      continue;
    }
    if (text.includes("variation_child_update_qty")) {
      errors.push(`${rel} must not wire variation_child_update_qty yet`);
    }
    if (text.includes("ebayVariationCandidateApi") || text.includes("fetchEbayVariationChildCandidate")) {
      errors.push(`${rel} must not wire variation candidate API yet`);
    }
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (!orch.includes("await adjustInventory(")) {
    errors.push("adjust_inventory must remain sole stock writer in orchestrator");
  }
  if (/refreshIssueSnapshot|issueSnapshot/.test(orch)) {
    errors.push("Adjust orchestrator must not refresh browser snapshot");
  }

  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  if (preview.includes("fetchChannelSyncPreview()")) {
    errors.push("Adjust preview must not call full fetchChannelSyncPreview()");
  }

  notes.push("No Adjust wiring; adjust_inventory sole writer; no snapshot/full preview reads");
  return { notes, errors };
}

function verifyAmazonUnchanged() {
  const notes = [];
  const errors = [];

  for (const rel of AMAZON_EDGE_FILES) {
    const text = readText(rel);
    if (text.includes("variation_child_update_qty") || text.includes("inventoryEbayVariationSyncUtils")) {
      errors.push(`${rel} must not reference variation child qty mode`);
    }
  }
  notes.push("Amazon edge files unchanged");
  return { notes, errors };
}

function verifyDocs() {
  const notes = [];
  const errors = [];

  const plan = readText(PLAN_060);
  const roadmap = readText(ROADMAP);

  if (!plan.includes("060A.3")) errors.push("Plan missing 060A.3 section");
  if (!/060A\.3[^]*✅/i.test(plan)) errors.push("Plan must document 060A.3 complete");
  if (!plan.includes("variation_child_update_qty")) errors.push("Plan missing mode contract");
  if (!plan.includes("inventoryEbayVariationSyncUtils.ts")) errors.push("Plan missing helper file");
  if (!plan.includes("verify-inventory-phase060a3-ebay-variation-edge.mjs")) {
    errors.push("Plan missing verify script ref");
  }

  notes.push("Docs updated for 060A.3");
  return { notes, errors };
}

function verify059Regression() {
  const notes = [];
  const errors = [];

  const fast = process.env.VERIFY_FAST === "1";
  const script = fast
    ? "scripts/verify-inventory-phase059-final.mjs"
    : "scripts/verify-inventory-phase059-final-freeze.mjs";
  const args = fast ? ["--static"] : [];

  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.status === 0) notes.push(`059 regression PASS (${script})`);
  else errors.push(`059 regression FAIL (${script})`);
  return { notes, errors };
}

async function verifyOptionalApi() {
  const notes = [];
  const errors = [];
  const skipped = [];

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const productId = process.env.TEST_EBAY_VARIATION_PRODUCT_ID?.trim();
  const variantId = process.env.TEST_EBAY_VARIATION_VARIANT_ID?.trim();
  const qty = Number(process.env.TEST_EBAY_VARIATION_QTY || 1);

  if (!url || !key) {
    skipped.push("Optional API: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors, skipped };
  }
  if (!productId || !variantId) {
    skipped.push("Optional API: skipped — missing TEST_EBAY_VARIATION_PRODUCT_ID or TEST_EBAY_VARIATION_VARIANT_ID");
    return { notes, errors, skipped };
  }

  const resp = await fetch(`${url}/functions/v1/sync-ebay-inventory-quantity`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "variation_child_update_qty",
      productId,
      variantId,
      quantity: qty,
      preview: true,
      syncContext: {
        trigger_source: "manual_adjust",
        trigger_reference_type: "stock_ledger",
        orchestration_id: `060a3-test-${Date.now()}`,
      },
    }),
  });

  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (resp.status >= 500) {
    errors.push(`Optional API: edge HTTP ${resp.status}`);
  } else if (["dry_run", "skipped", "manual", "failed"].includes(data.status)) {
    notes.push(`Optional API: preview status=${data.status} message=${String(data.message || "").slice(0, 100)}`);
  } else if (data.status === "success") {
    errors.push("Optional API: preview must not return success (live mutation)");
  } else {
    notes.push(`Optional API: response status=${data.status ?? "unknown"}`);
  }

  if (data.mode !== "variation_child_update_qty") {
    errors.push("Optional API: mode must be variation_child_update_qty");
  }
  if (data.preview !== true) {
    errors.push("Optional API: preview flag must be true in response");
  }

  return { notes, errors, skipped };
}

async function main() {
  const parts = [
    verifyFiles(),
    verifyNoAdjustWiring(),
    verifyAmazonUnchanged(),
    verifyDocs(),
    verify059Regression(),
    await verifyOptionalApi(),
  ];

  const notes = parts.flatMap((p) => p.notes);
  const skipped = parts.flatMap((p) => p.skipped || []);
  const errors = parts.flatMap((p) => p.errors);

  console.log("\n=== Phase 060A.3 — eBay Variation Child Qty Edge ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const s of skipped) console.log(`  ○ ${s}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 060A.3 variation child qty edge support\n");
  console.log("Next subphase: 060A.4 — verification matrix\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
