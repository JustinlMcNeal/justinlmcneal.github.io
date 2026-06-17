/**
 * Phase 059C.5 — eBay active sync QA freeze.
 * Composes all 059C sub-phase scripts + final static guardrails.
 *
 * Run: node scripts/verify-inventory-phase059c-final-freeze.mjs
 *
 * Optional env (passed through to 059C.4 script):
 *   TEST_EBAY_CACHE_PRODUCT_ID, TEST_EBAY_CACHE_VARIANT_ID,
 *   RUN_EBAY_ACTIVE_QTY_TEST, RUN_LIVE_EBAY_ACTIVE_QTY_TEST,
 *   EBAY_ENABLE_LIVE_QUANTITY_PATCH, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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
  "verify-inventory-phase059c1-ebay-active-audit.mjs",
  "verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs",
  "verify-inventory-phase059c3-adjust-ebay-active-orchestrator.mjs",
  "verify-inventory-phase059c-ebay-active-sync.mjs",
  "verify-inventory-phase059a-adjust-orchestration.mjs",
  "verify-inventory-phase059b-final-freeze.mjs",
  "verify-inventory-issue-view-safety.mjs",
  "verify-inventory-phase10y-final-stabilization.mjs",
];

const C059_RUNTIME_FILES = [
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayCache.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/api/ebayCacheRefreshApi.js",
  "js/admin/inventory/api/ebaySyncPushApi.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "supabase/functions/sync-ebay-listing-inventory-cache/index.ts",
  "supabase/functions/sync-ebay-inventory-quantity/index.ts",
];

const AMAZON_059B_FILES = [
  "supabase/functions/sync-amazon-inventory-quantity/index.ts",
  "supabase/functions/_shared/inventoryAmazonInactiveRestock.ts",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayCache.js",
];

const FORBIDDEN = [
  { label: "eBay auto-relist edge", pattern: /relist-ebay-from-product|pushEbayRelist|autoRelistListing/i },
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

  for (const rel of C059_RUNTIME_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing 059C file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("059C runtime modules present and under 500 lines");

  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const cache = readText("js/admin/inventory/services/adjustChannelEbayCache.js");
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  const cacheEdge = readText("supabase/functions/sync-ebay-listing-inventory-cache/index.ts");

  const resolveBlock = branch.slice(branch.indexOf("export async function resolveEbayBranch"));
  if (!resolveBlock.includes('action === "update_qty"') || !resolveBlock.includes("runEbayUpdateQty")) {
    errors.push("Direct eBay update_qty path must be preserved");
  }
  if (!branch.includes("pushEbayInventoryQuantity")) {
    errors.push("Direct update_qty must call pushEbayInventoryQuantity");
  }
  notes.push("Direct eBay update_qty path preserved");

  if (!branch.includes('action === "qty_cache_missing"') || !branch.includes("runAdjustEbayCacheRefreshChain")) {
    errors.push("qty_cache_missing must use cache refresh chain");
  }
  if (!cache.includes("productIds: [pid]") || !cache.includes("limit: 1")) {
    errors.push("Cache refresh must use single productIds + limit 1");
  }
  if (!cache.includes("syncContext")) errors.push("Cache refresh must accept syncContext");
  if (!cache.includes("fetchChannelSyncCandidateForVariant")) {
    errors.push("Candidate must be re-fetched after cache refresh");
  }
  if (
    !branch.includes('nextAction === "update_qty"') ||
    !branch.includes('refreshedAction === "update_qty"')
  ) {
    errors.push("Qty push only after refreshed candidate is update_qty");
  }
  if (!branch.includes("cache refresh failed. Quantity sync was not attempted")) {
    errors.push("Cache refresh failure must block qty push");
  }
  if (!branch.includes("still unavailable")) {
    errors.push("Refreshed qty_cache_missing must not push qty");
  }
  const roadmapText = readText(ROADMAP);
  const planText = readText(PLAN_DOC);
  const d3Complete =
    (roadmapText.includes("059D.3") && roadmapText.includes("✅")) ||
    planText.includes("059D.3 — Adjust orchestrator integration ✅");
  if (d3Complete && branch.includes("runEbayEndedRelist")) {
    notes.push("059D.3 relist wired in eBay branch (059C active/cache paths unchanged)");
  } else if (!branch.includes("Relist starts in 059D")) {
    errors.push("ended_needs_relist must remain 059D next-step until 059D.3 relist wiring");
  } else {
    notes.push("ended_needs_relist deferred to 059D (no orchestrator relist yet)");
  }
  if (!branch.includes('status: "manual"') || !branch.includes("unsupported_variation")) {
    errors.push("unsupported_variation must remain manual");
  }
  if (!branch.includes("available <= 0")) errors.push("No qty-0 eBay push from Adjust");
  if (!branch.includes("syncContext")) errors.push("syncContext must flow to cache refresh and qty push");
  if (cache.includes("pushEbayInventoryQuantity")) errors.push("Cache helper must not push qty");
  notes.push("Cache-missing chain: single product, syncContext, re-read, guarded push");

  if (!cacheEdge.includes("syncContext")) {
    errors.push("Cache edge must accept syncContext (059C.2 deploy)");
  }
  notes.push("Cache edge syncContext support present");

  if (!panel.includes("card.detail")) {
    errors.push("Result panel must support eBay cache detail line");
  }
  notes.push("Result panel eBay detail line supported");

  const relistEdgePath = join(ROOT, "supabase/functions/relist-ebay-from-product/index.ts");
  const roadmapText = readText(ROADMAP);
  const planText = readText(PLAN_DOC);
  const d2Complete =
    roadmapText.includes("059D.2") && roadmapText.includes("✅") ||
    planText.includes("059D.2 — Relist edge function ✅");
  if (existsSync(relistEdgePath)) {
    if (d2Complete) {
      notes.push("relist-ebay-from-product edge present (059D.2+; 059C frozen without orchestrator wiring)");
    } else {
      errors.push("eBay relist edge must not exist in 059C (059D)");
    }
  } else {
    notes.push("No eBay relist edge/function for 059C");
  }

  for (const rel of AMAZON_059B_FILES) {
    const text = readText(rel);
    if (text.includes("runAdjustEbayCacheRefreshChain") || text.includes("adjustChannelEbayCache")) {
      errors.push(`${rel} must not reference 059C eBay cache chain (Amazon unchanged)`);
    }
  }
  notes.push("Amazon 059B paths unchanged by 059C eBay work");

  for (const rel of ADJUST_FLOW_FILES) {
    const text = readText(rel);
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(text)) errors.push(`${rel}: forbidden ${label}`);
    }
  }

  if (!orch.includes("await adjustInventory(")) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  if (!orch.includes("resolveEbayBranch")) {
    errors.push("Orchestrator must delegate eBay to adjustChannelEbayBranch");
  }
  notes.push("No relist automation, no heavy reads; adjust_inventory only stock writer");

  const doc = readText(PLAN_DOC);
  if (!doc.includes("059C.5") || !doc.includes("059C major phase complete")) {
    errors.push("Plan doc must mark 059C.5 and 059C major phase complete");
  }
  if (!doc.includes("verify-inventory-phase059c-final-freeze.mjs")) {
    errors.push("Plan doc must reference final 059C freeze script");
  }
  if (!doc.includes("059D.1")) {
    errors.push("Plan doc must reference 059D.1 as next/pending");
  }
  notes.push("Plan doc marks 059C frozen");

  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("059C ✅ Complete") && !roadmap.includes("059C.5 ✅")) {
    errors.push("roadmap.md must mark 059C complete");
  }
  notes.push("Roadmap marks 059C complete (frozen)");

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
      timeout: 600000,
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

  const hasProduct = process.env.TEST_EBAY_CACHE_PRODUCT_ID?.trim();
  const hasVariant = process.env.TEST_EBAY_CACHE_VARIANT_ID?.trim();
  const runQtyTest = process.env.RUN_EBAY_ACTIVE_QTY_TEST === "true";
  const runLive =
    process.env.RUN_LIVE_EBAY_ACTIVE_QTY_TEST === "true" &&
    process.env.EBAY_ENABLE_LIVE_QUANTITY_PATCH === "true";

  if (!hasProduct || !hasVariant) {
    skipped.push("Optional cache refresh API: TEST_EBAY_CACHE_PRODUCT_ID / VARIANT_ID not set");
  }
  if (!runQtyTest) {
    skipped.push("Optional qty push test: RUN_EBAY_ACTIVE_QTY_TEST not true");
  }
  if (!runLive) {
    skipped.push("Optional live eBay qty push: RUN_LIVE_EBAY_ACTIVE_QTY_TEST + EBAY_ENABLE_LIVE_QUANTITY_PATCH not both true");
  }

  return { notes, errors, skipped };
}

function main() {
  const staticResult = verifyFreezeStatic();
  const composed = runComposedScripts();

  const errors = [...staticResult.errors, ...composed.errors];
  const notes = [...staticResult.notes, ...composed.notes];
  const skipped = composed.skipped;

  console.log("\n=== Phase 059C.5 — eBay Active Sync QA Freeze ===\n");

  console.log("Final 059C static checks:");
  for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
  for (const e of staticResult.errors) console.log(`  ✗ ${e}`);

  console.log("\nComposed verification scripts:");
  for (const n of composed.notes) console.log(`  ✓ ${n}`);
  for (const e of composed.errors) console.log(`  ✗ ${e}`);

  if (skipped.length) {
    console.log("\nOptional sections (not failures):");
    for (const s of skipped) console.log(`  ○ ${s}`);
  }

  const liveThisRun =
    process.env.RUN_LIVE_EBAY_ACTIVE_QTY_TEST === "true" &&
    process.env.EBAY_ENABLE_LIVE_QUANTITY_PATCH === "true" &&
    process.env.RUN_EBAY_ACTIVE_QTY_TEST === "true";

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 059C frozen (059C.1–059C.5 complete)\n");
  console.log(`Live eBay quantity patch during this run: ${liveThisRun ? "YES (explicit flags set)" : "NO"}`);
  console.log("Next subphase: 059D.1 — eBay relist architecture audit\n");
}

main();
