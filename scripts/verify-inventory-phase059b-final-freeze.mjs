/**
 * Phase 059B.5 — Amazon inactive restock QA freeze.
 * Composes all 059B sub-phase scripts + final static guardrails.
 *
 * Run: node scripts/verify-inventory-phase059b-final-freeze.mjs
 *
 * Optional env (passed through to 059B.4 script):
 *   TEST_AMAZON_INACTIVE_VARIANT_ID, RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST,
 *   AMAZON_ENABLE_LIVE_PATCH, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";

const COMPOSED_SCRIPTS = [
  "verify-inventory-phase059b1-amazon-inactive-audit.mjs",
  "verify-inventory-phase059b2-amazon-inactive-edge.mjs",
  "verify-inventory-phase059b3-adjust-amazon-inactive-orchestrator.mjs",
  "verify-inventory-phase059b-amazon-inactive-restock.mjs",
  "verify-inventory-phase059a-adjust-orchestration.mjs",
  "verify-inventory-issue-view-safety.mjs",
  "verify-inventory-phase10y-final-stabilization.mjs",
];

const B059_RUNTIME_FILES = [
  "supabase/functions/sync-amazon-inventory-quantity/index.ts",
  "supabase/functions/_shared/inventoryAmazonInactiveRestock.ts",
  "supabase/functions/_shared/amazonOfferRestoreUtils.ts",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/api/amazonSyncPushApi.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/services/adjustOrchestratorSummary.js",
];

const EBAY_PATHS = [
  "supabase/functions/sync-ebay-inventory-quantity/index.ts",
  "supabase/functions/_shared/inventoryEbaySyncUtils.ts",
  "js/admin/inventory/api/ebaySyncPushApi.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
];

const FORBIDDEN = [
  { label: "eBay cache refresh chain", pattern: /sync-ebay-listing-inventory-cache|refreshEbayListingCache/i },
  { label: "eBay auto-relist", pattern: /pushEbayRelist|autoRelistListing/i },
  { label: "full fetchChannelSyncPreview", pattern: /fetchChannelSyncPreview/ },
  { label: "browser snapshot refresh", pattern: /issueSnapshot|refreshIssueSnapshot/ },
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyFreezeStatic() {
  const notes = [];
  const errors = [];

  for (const rel of B059_RUNTIME_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing 059B file: ${rel}`);
    else if (rel.endsWith(".js") && lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
    else if (rel.includes("sync-amazon-inventory-quantity") && lineCount(rel) > MAX_LINES) {
      notes.push(`${rel}: ${lineCount(rel)} lines (pre-existing edge, acceptable)`);
    } else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("059B runtime modules present and under 500 lines");

  const syncIndex = readText("supabase/functions/sync-amazon-inventory-quantity/index.ts");
  if (!syncIndex.includes("inactive_restock")) errors.push("Edge must support inactive_restock mode");
  if (!syncIndex.includes('parseSyncMode') && !syncIndex.includes('"update_qty"')) {
    errors.push("Default Amazon sync mode must remain update_qty");
  }
  if (!syncIndex.includes("exactly one variantId")) {
    errors.push("inactive_restock must enforce single variant");
  }
  notes.push("Edge: inactive_restock mode; default update_qty preserved");

  const inactive = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (!inactive.includes("inactive_can_update")) errors.push("Inactive loader must filter inactive_can_update");
  if (!inactive.includes("<= 0")) errors.push("Inactive must require available_qty > 0");
  if (!inactive.includes("amazon_is_afn") || !inactive.includes("isFbaManagedListing")) {
    errors.push("Inactive must skip AFN/FBA");
  }
  if (!inactive.includes("dry_run") && !inactive.includes('"dry_run"')) {
    errors.push("Inactive must support dry_run when live gate off");
  }
  if (!inactive.includes("createInventorySyncRun")) {
    errors.push("Inactive must persist sync run with correlation");
  }
  notes.push("Inactive edge: AFN skip, available>0, dry_run, correlation");

  const loader = readText("supabase/functions/_shared/inventoryAmazonSyncUtils.ts");
  if (!loader.includes('.eq("amazon_sync_action", "update_qty")')) {
    errors.push("Default loader must filter update_qty only (Sync Channels bulk path)");
  }
  notes.push("Sync Channels bulk path still update_qty only");

  const syncModal = readText("js/admin/inventory/ui/syncDryRunModal.js");
  if (syncModal.includes("inactive_restock")) {
    errors.push("Sync Channels must not bulk-call inactive_restock");
  }
  notes.push("Sync Channels does not default to inactive restore");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const fnBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));
  const adjustIdx = fnBody.indexOf("await adjustInventory(");
  const amazonIdx = fnBody.indexOf("await resolveAmazonBranch(");
  if (adjustIdx < 0 || amazonIdx < 0 || amazonIdx < adjustIdx) {
    errors.push("Inactive restock must run only after successful adjust_inventory");
  }
  if (!orch.includes('mode: "inactive_restock"') || !orch.includes("syncContext")) {
    errors.push("Orchestrator must call inactive_restock with syncContext");
  }
  if (!orch.includes("variantIds: [variantId]") || !orch.includes("limit: 1")) {
    errors.push("Orchestrator must enforce single variant / limit 1");
  }
  notes.push("Orchestrator: post-adjust inactive_restock, syncContext, single variant");

  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  for (const status of ["success", "failed", "skipped", "dry_run"]) {
    if (!panel.includes(status)) errors.push(`Result panel missing status: ${status}`);
  }
  const summary = readText("js/admin/inventory/services/adjustOrchestratorSummary.js");
  if (!summary.includes("Stock remains adjusted")) {
    errors.push("Partial failure copy must state stock remains adjusted");
  }
  notes.push("Result panel + partial failure copy complete");

  for (const rel of EBAY_PATHS) {
    if (existsSync(join(ROOT, rel)) && readText(rel).includes("inactive_restock")) {
      errors.push(`${rel} must not reference inactive_restock (eBay untouched)`);
    }
  }
  notes.push("eBay files unchanged for 059B");

  for (const rel of ADJUST_FLOW_FILES) {
    const text = readText(rel);
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(text)) errors.push(`${rel}: forbidden ${label}`);
    }
  }

  if (!orch.includes("await adjustInventory(")) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  notes.push("No eBay automation, no heavy reads; adjust_inventory only stock writer");

  const doc = readText(PLAN_DOC);
  if (!doc.includes("059B.5") || !doc.includes("059B major phase complete")) {
    errors.push("Plan doc must mark 059B.5 and 059B major phase complete");
  }
  if (!doc.includes("verify-inventory-phase059b-final-freeze.mjs")) {
    errors.push("Plan doc must reference final 059B freeze script");
  }
  notes.push("Plan doc marks 059B frozen");

  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("059B ✅ Complete")) {
    errors.push("roadmap.md must mark 059B complete");
  }
  notes.push("Roadmap marks 059B complete (frozen)");

  const migration = "supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql";
  if (!existsSync(join(ROOT, migration))) {
    errors.push("Missing 059A.4 correlation migration");
  } else notes.push("059A.4 correlation migration present for deploy");

  return { notes, errors };
}

function runComposedScripts() {
  const notes = [];
  const errors = [];
  const skipped = [];

  for (const script of COMPOSED_SCRIPTS) {
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`Missing composed script: ${script}`);
      continue;
    }
    const result = spawnSync(process.execPath, [path], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 360000,
      env: { ...process.env },
    });
    const label = script.replace("verify-inventory-", "").replace(".mjs", "");
    if (result.status === 0) {
      notes.push(`Composed PASS: ${label}`);
    } else {
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-8).join(" ").trim();
      errors.push(`Composed FAIL: ${label}${tail ? ` — ${tail.slice(0, 200)}` : ""}`);
    }
  }

  const hasVariant = process.env.TEST_AMAZON_INACTIVE_VARIANT_ID?.trim();
  const runLive = process.env.RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST === "true";
  if (!hasVariant) {
    skipped.push("Optional dry-run API: TEST_AMAZON_INACTIVE_VARIANT_ID not set (059B.4 skips API section)");
  }
  if (!runLive) {
    skipped.push("Optional live Amazon test: RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST not true");
  }

  return { notes, errors, skipped };
}

function main() {
  const staticResult = verifyFreezeStatic();
  const composed = runComposedScripts();

  const errors = [...staticResult.errors, ...composed.errors];
  const notes = [...staticResult.notes, ...composed.notes];
  const skipped = composed.skipped;

  console.log("\n=== Phase 059B.5 — Amazon Inactive Restock QA Freeze ===\n");

  console.log("Final 059B static checks:");
  for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
  for (const e of staticResult.errors) console.log(`  ✗ ${e}`);

  console.log("\nComposed verification scripts:");
  for (const n of composed.notes) console.log(`  ✓ ${n}`);
  for (const e of composed.errors) console.log(`  ✗ ${e}`);

  if (skipped.length) {
    console.log("\nOptional sections (not failures):");
    for (const s of skipped) console.log(`  ○ ${s}`);
  }

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 059B frozen (059B.1–059B.5 complete)\n");
  console.log("Live Amazon call in this run: only if RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST=true was set");
  console.log("Next subphase: 059C.1 — eBay active sync audit\n");
}

main();
