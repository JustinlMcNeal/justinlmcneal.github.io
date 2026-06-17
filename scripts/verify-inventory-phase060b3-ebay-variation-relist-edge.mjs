/**
 * Phase 060B.3 — eBay variation group relist edge verification.
 *
 * Run: node scripts/verify-inventory-phase060b3-ebay-variation-relist-edge.mjs
 *
 * Optional env (dry-run API test):
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

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyStatic() {
  const notes = [];
  const errors = [];

  for (const rel of EDGE_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
    else notes.push(`${rel}: ${lineCount(rel)} lines`);
  }

  const index = readText("supabase/functions/relist-ebay-variation-group/index.ts");
  const utils = readText("supabase/functions/_shared/ebayVariationGroupRelistUtils.ts");
  const validation = readText("supabase/functions/_shared/ebayVariationGroupRelistValidation.ts");
  const publish = readText("supabase/functions/_shared/ebayVariationGroupRelistPublish.ts");

  if (!index.includes("productId") || !index.includes("preview") || !index.includes("syncContext")) {
    errors.push("Edge must accept productId, preview, syncContext");
  }
  if (!index.includes("EBAY_ENABLE_LIVE_VARIATION_RELIST")) {
    errors.push("Edge must use dedicated EBAY_ENABLE_LIVE_VARIATION_RELIST gate");
  }
  if (index.includes("EBAY_ENABLE_LIVE_RELIST") && !index.includes("EBAY_ENABLE_LIVE_VARIATION_RELIST")) {
    errors.push("Edge must not reuse single-SKU gate as sole gate");
  }
  if (!index.includes("requireAdminJson")) errors.push("Edge must require admin auth");
  if (!index.includes("relistEbayVariationGroup")) errors.push("Edge must call relistEbayVariationGroup");
  notes.push("Edge contract + dedicated live gate + admin auth");

  if (!utils.includes("v_inventory_ebay_variation_relist_candidates") &&
      !utils.includes("loadEbayVariationGroupRelistCandidate")) {
    errors.push("Utils must load variation group relist candidate view");
  }
  if (!utils.includes("validateStructuralGroupCandidate")) {
    errors.push("Utils must validate full group before write");
  }
  if (!utils.includes('status: "dry_run"') && !utils.includes('"dry_run"')) {
    errors.push("Utils must return dry_run when gate off/preview");
  }
  if (!utils.includes("variation_group_relist")) {
    errors.push("Sync run action must be variation_group_relist");
  }
  if (!utils.includes("createInventorySyncRun")) {
    errors.push("Utils must log inventory_channel_sync_runs");
  }
  if (utils.includes("adjust_inventory")) {
    errors.push("Utils must not call adjust_inventory");
  }
  notes.push("Candidate load + validation + sync logging");

  if (!validation.includes("resolvePoliciesFromEnv")) {
    errors.push("Validation must resolve policies from env");
  }
  if (!validation.includes("buildGroupRelistPlan")) {
    errors.push("Validation must build full group relist plan");
  }
  if (!validation.includes("allVariantSkus") || !validation.includes("variantQuantities")) {
    errors.push("Plan must include all group variant SKUs and quantities");
  }
  if (!validation.includes("no_child_with_positive_kk_available")) {
    errors.push("Plan must require at least one child qty > 0");
  }
  notes.push("Metadata resolution + full group plan");

  if (!publish.includes("createEbayInventoryItem") || !publish.includes("createOrUpdateInventoryItemGroup")) {
    errors.push("Publish must create/update child inventory items and item group");
  }
  if (!publish.includes("createGroupOffers")) {
    errors.push("Publish must create group offers");
  }
  if (!publish.includes("publish_by_inventory_item_group")) {
    errors.push("Publish must call publish_by_inventory_item_group");
  }
  notes.push("Publish chain: items → group → offers → publish");

  if (!utils.includes("was not reactivated") && !utils.includes("not reactivated")) {
    errors.push("Reconciliation must not reactivate old ended listing ID");
  }
  if (!utils.includes("reconciliation failed")) {
    errors.push("Reconciliation failure must be surfaced");
  }
  notes.push("DB reconciliation + old listing guard");

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
        errors.push(`${rel} must not call qty edge from relist orchestrator files`);
      }
      continue;
    }
    if (/relist-ebay-variation-group|relistEbayVariationGroup|EBAY_ENABLE_LIVE_VARIATION_RELIST/.test(t)) {
      errors.push(`${rel} must not wire variation group relist yet (060C)`);
    }
  }

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if ((orch.match(/await adjustInventory\(/g) || []).length !== 1) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  for (const rel of ADJUST_FLOW) {
    if (/fetchChannelSyncPreview\(\)|refreshIssueSnapshot|issueSnapshot/.test(readText(rel))) {
      errors.push(`${rel}: forbidden heavy read`);
    }
  }

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (/variation_group|EBAY_ENABLE_LIVE_VARIATION_RELIST|relist-ebay-variation-group/.test(amazon)) {
    errors.push("Amazon module unchanged");
  }
  notes.push("No Adjust wiring; pool-safety preserved");

  return { notes, errors };
}

function verifyDocs() {
  const notes = [];
  const errors = [];
  const doc = readText(PLAN_060);
  if (!doc.includes("060B.3")) errors.push("Plan missing 060B.3 section");
  if (!doc.includes("relist-ebay-variation-group")) errors.push("Plan missing edge name");
  if (!doc.includes("ebayVariationGroupRelistUtils")) errors.push("Plan missing utils ref");
  if (!doc.includes("verify-inventory-phase060b3-ebay-variation-relist-edge.mjs")) {
    errors.push("Plan missing verify script ref");
  }
  if (!/060B\.3[^]*✅/i.test(doc)) errors.push("Plan must mark 060B.3 complete");
  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("060B.3") && !roadmap.includes("060B.4") && !/060B.*Complete.*Frozen/i.test(roadmap)) {
    errors.push("Roadmap missing 060B progress");
  }
  if (!roadmap.includes("060B.4") && !roadmap.includes("060B.5") && !/060B.*Complete.*Frozen|060B.*✅/i.test(roadmap)) {
    errors.push("Roadmap must list next 060B subphase or mark frozen");
  }
  notes.push("Docs updated for 060B.3");
  return { notes, errors };
}

function runRegression(scriptName, label) {
  const script = join(ROOT, "scripts", scriptName);
  if (!existsSync(script)) return { ok: false, error: `Missing ${scriptName}` };
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: "utf8", env: { ...process.env, VERIFY_FAST: "1" } });
  if (r.status !== 0) {
    return { ok: false, error: (r.stdout || r.stderr || "").split("\n").slice(-8).join("\n") };
  }
  return { ok: true };
}

async function verifyOptionalApi() {
  const notes = [];
  const errors = [];
  const skipped = [];

  if (process.env.RUN_LIVE_EBAY_VARIATION_RELIST_TEST === "true") {
    skipped.push("Optional dry-run API skipped — RUN_LIVE_EBAY_VARIATION_RELIST_TEST is set (live test mode)");
    return { notes, errors, skipped };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const productId = process.env.TEST_EBAY_VARIATION_RELIST_PRODUCT_ID?.trim();

  if (!url || !key) {
    skipped.push("Optional API: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors, skipped };
  }
  if (!productId) {
    skipped.push("Optional API: skipped — missing TEST_EBAY_VARIATION_RELIST_PRODUCT_ID");
    return { notes, errors, skipped };
  }

  const resp = await fetch(`${url}/functions/v1/relist-ebay-variation-group`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productId,
      preview: true,
      syncContext: {
        trigger_source: "manual_adjust",
        orchestration_id: `060b3-test-${Date.now()}`,
      },
    }),
  });

  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  const status = data.status;
  if (resp.status >= 500) {
    errors.push(`Optional API: edge HTTP ${resp.status}`);
  } else if (["dry_run", "skipped", "manual", "failed"].includes(status)) {
    notes.push(`Optional API: preview status=${status} message=${String(data.message || "").slice(0, 100)}`);
  } else if (status === "success") {
    errors.push("Optional API: preview must not return success (live publish)");
  } else {
    notes.push(`Optional API: response status=${status ?? "unknown"}`);
  }

  if (data.mode !== "variation_group_relist") {
    errors.push("Optional API: mode must be variation_group_relist");
  }

  return { notes, errors, skipped };
}

async function main() {
  console.log("\n=== Phase 060B.3 — eBay Variation Group Relist Edge ===\n");
  const allErrors = [];
  const allNotes = [];

  const staticResult = verifyStatic();
  allNotes.push(...staticResult.notes.map((n) => `  ✓ ${n}`));
  allErrors.push(...staticResult.errors);

  const docResult = verifyDocs();
  allNotes.push(...docResult.notes.map((n) => `  ✓ ${n}`));
  allErrors.push(...docResult.errors);

  if (process.env.VERIFY_SKIP_NESTED_REGRESSION === "1") {
    allNotes.push("  ○ Nested regressions skipped (VERIFY_SKIP_NESTED_REGRESSION=1)");
  } else {
    for (const [script, label] of [
      ["verify-inventory-phase060b2-ebay-variation-relist-candidates.mjs", "060B.2 regression"],
      ["verify-inventory-phase060a-final-freeze.mjs", "060A freeze"],
      ["verify-inventory-phase059d-ebay-auto-relist.mjs", "059 static regression"],
    ]) {
      const r = runRegression(script, label);
      if (r.ok) allNotes.push(`  ✓ Regression PASS: ${label}`);
      else {
        allErrors.push(`Regression FAIL: ${label}: ${r.error}`);
        console.log(`  ✗ Regression FAIL: ${label}`);
      }
    }
  }

  const api = await verifyOptionalApi();
  allNotes.push(...api.notes.map((n) => `  ✓ ${n}`));
  allNotes.push(...api.skipped.map((n) => `  ○ ${n}`));
  allErrors.push(...api.errors);

  for (const n of allNotes) console.log(n);

  if (allErrors.length) {
    console.log(`\nFAIL (${allErrors.length} error(s))\n`);
    for (const e of allErrors) console.log(`  ✗ ${e}`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 060B.3 variation group relist edge\n");
  console.log("Next subphase: 060B.4 — verification matrix\n");
  console.log("Optional live test (creates real listing — not run by default):");
  console.log("  RUN_LIVE_EBAY_VARIATION_RELIST_TEST=true \\");
  console.log("  EBAY_ENABLE_LIVE_VARIATION_RELIST=true \\");
  console.log("  TEST_EBAY_VARIATION_RELIST_PRODUCT_ID=<uuid> \\");
  console.log("  node scripts/verify-inventory-phase060b3-ebay-variation-relist-edge.mjs\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
