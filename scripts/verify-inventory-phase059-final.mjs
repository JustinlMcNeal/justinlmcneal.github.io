/**
 * Phase 059E.4 — Production verification for Adjust → Unified Channel Restock.
 *
 * Run:
 *   node scripts/verify-inventory-phase059-final.mjs
 *   node scripts/verify-inventory-phase059-final.mjs --static
 *
 * Fast mode (default): VERIFY_FAST=1, VERIFY_SKIP_DEEP_REGRESSION=1
 * Deep optional: RUN_DEEP_059_FINAL=1, RUN_DEEP_059C_FREEZE=1
 *
 * Optional live (explicit flags only — never default):
 *   RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST=true
 *   RUN_LIVE_EBAY_ACTIVE_QTY_TEST=true + EBAY_ENABLE_LIVE_QUANTITY_PATCH=true
 *   RUN_LIVE_EBAY_RELIST_TEST=true + EBAY_ENABLE_LIVE_RELIST=true
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { isVerifyFastMode } from "./lib/verifyFastMode.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";
const MIGRATION = "supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql";

const DEPLOY_CHECKLIST = [
  "Apply migration: supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql",
  "Deploy edge: sync-amazon-inventory-quantity",
  "Deploy edge: sync-ebay-inventory-quantity",
  "Deploy edge: sync-ebay-listing-inventory-cache",
  "Deploy edge: relist-ebay-from-product",
  "Deploy shared helpers: inventoryAmazonInactiveRestock.ts, amazonOfferRestoreUtils.ts, inventoryEbaySyncUtils.ts, ebayRelistFromProduct.ts, ebayRelistCandidateLoaders.ts, ebayListingPublishUtils.ts",
  "Deploy admin JS/static (inventory adjust modal, orchestrator, result panel, APIs)",
  "Confirm Supabase secrets: Amazon + eBay OAuth/credentials (existing sync/relist)",
  "Set live gates in production when ready: AMAZON_ENABLE_LIVE_PATCH, EBAY_ENABLE_LIVE_QUANTITY_PATCH, EBAY_ENABLE_LIVE_RELIST",
  "Run verify-inventory-phase10y-final-stabilization.mjs after deploy (pool safety)",
];

const EDGE_FUNCTIONS = [
  "supabase/functions/sync-amazon-inventory-quantity/index.ts",
  "supabase/functions/sync-ebay-inventory-quantity/index.ts",
  "supabase/functions/sync-ebay-listing-inventory-cache/index.ts",
  "supabase/functions/relist-ebay-from-product/index.ts",
];

const ADJUST_FLOW = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayCache.js",
];

const KEY_RUNTIME = [
  ...ADJUST_FLOW,
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/api/amazonSyncPushApi.js",
  "js/admin/inventory/api/ebaySyncPushApi.js",
  "js/admin/inventory/api/ebayCacheRefreshApi.js",
  "js/admin/inventory/api/ebayRelistFromProductApi.js",
  ...EDGE_FUNCTIONS,
];

function parseArgs() {
  return { staticOnly: process.argv.includes("--static") };
}

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {
    // optional
  }
  if (!isVerifyFastMode(env)) {
    env.VERIFY_FAST = "1";
    env.VERIFY_SKIP_DEEP_REGRESSION = "1";
  }
  return env;
}

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function spawnScript(script, timeout, extraEnv = {}, args = []) {
  const path = join(ROOT, "scripts", script);
  if (!existsSync(path)) return { ok: false, detail: "missing script" };
  const result = spawnSync(process.execPath, [path, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status === 0) return { ok: true };
  const timedOut = result.error?.code === "ETIMEDOUT";
  const tail = (result.stdout || result.stderr || "").split("\n").slice(-4).join(" ").trim();
  return { ok: false, detail: `${timedOut ? "timeout" : "exit"}${tail ? ` — ${tail.slice(0, 150)}` : ""}` };
}

function verify059CFastBoundary() {
  const notes = [];
  const errors = [];
  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const cache = readText("js/admin/inventory/services/adjustChannelEbayCache.js");
  if (!branch.includes("pushEbayInventoryQuantity")) errors.push("059C: update_qty path");
  if (!branch.includes("runAdjustEbayCacheRefreshChain")) errors.push("059C: cache chain");
  if (!cache.includes("refreshEbayListingCache")) errors.push("059C: cache refresh API wiring");
  notes.push("059C fast boundary: active + cache paths");
  return { notes, errors };
}

function verifyProductionStatic(env) {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_DOC);
  const roadmap = readText(ROADMAP);
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const orchBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));

  if (!plan.includes("5×5") && !plan.includes("5 subphases")) errors.push("Plan: strict 5×5 structure");
  for (const major of ["059A", "059B", "059C", "059D"]) {
    if (!roadmap.includes(`${major}`) || !roadmap.includes("✅")) errors.push(`Roadmap: ${major} must be complete`);
  }
  for (const sub of ["059E.1", "059E.2", "059E.3"]) {
    if (!plan.includes(`${sub} | ✅ Complete`)) errors.push(`Plan: ${sub} must be marked complete`);
  }
  if (!plan.includes("verify-inventory-phase059-final.mjs")) errors.push("Plan must reference final verify script");
  notes.push("Docs: 059A–059D frozen; 059E.1–059E.3 complete; 059E.4/059E.5 tracked");

  const adjustCalls = (orch.match(/await adjustInventory\(/g) || []).length;
  if (adjustCalls !== 1) errors.push(`adjust_inventory sole writer (found ${adjustCalls})`);
  if (orchBody.indexOf("await resolveAmazonBranch") <= orchBody.indexOf("await adjustInventory(")) {
    errors.push("Amazon branch must run after adjust_inventory");
  }
  if (orchBody.indexOf("await resolveEbayBranch") <= orchBody.indexOf("await adjustInventory(")) {
    errors.push("eBay branch must run after adjust_inventory");
  }
  if (!orchBody.includes("syncChannelsEnabled")) errors.push("sync toggle gate required");
  if (!preview.includes("computeSyncToggleDefault")) errors.push("sync toggle defaults required");
  if (/rollbackStock|undoAdjust|reverseAdjustment/.test(orch)) errors.push("stock rollback pattern forbidden");
  notes.push("Orchestrator: adjust first, sync toggle gate, no rollback");

  for (const rel of ADJUST_FLOW) {
    if (/fetchChannelSyncPreview|issueSnapshot|refreshIssueSnapshot/.test(readText(rel))) {
      errors.push(`${rel}: forbidden heavy read`);
    }
  }
  notes.push("No snapshot refresh / full fetchChannelSyncPreview in adjust flow");

  if (!branch.includes("available <= 0") && !branch.includes("available_qty ?? 0")) {
    errors.push("eBay qty-0 guard expected in branch");
  }
  if (!branch.includes("unsupported_variation")) errors.push("eBay variation manual/deferred");
  notes.push("Qty-0 push guard + variation manual preserved");

  for (const rel of EDGE_FUNCTIONS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing edge: ${rel}`);
  }
  const amzEdge = readText(EDGE_FUNCTIONS[0]);
  const ebayQty = readText(EDGE_FUNCTIONS[1]);
  const relist = readText(EDGE_FUNCTIONS[3]);
  if (!amzEdge.includes("AMAZON_ENABLE_LIVE_PATCH")) errors.push("Amazon live gate missing");
  if (!ebayQty.includes("EBAY_ENABLE_LIVE_QUANTITY_PATCH")) errors.push("eBay qty live gate missing");
  if (!relist.includes("EBAY_ENABLE_LIVE_RELIST")) errors.push("eBay relist live gate missing");
  notes.push("Live gates: AMAZON_ENABLE_LIVE_PATCH, EBAY_ENABLE_LIVE_QUANTITY_PATCH, EBAY_ENABLE_LIVE_RELIST");

  if (!existsSync(join(ROOT, MIGRATION))) errors.push(`Missing migration: ${MIGRATION}`);
  else notes.push("Migration 20261023 adjust sync run correlation present");

  const jsOver = KEY_RUNTIME.filter(
    (rel) => rel.endsWith(".js") && existsSync(join(ROOT, rel)) && lineCount(rel) > MAX_LINES,
  );
  if (jsOver.length) errors.push(`JS files over ${MAX_LINES} lines: ${jsOver.join(", ")}`);
  else notes.push("Admin JS runtime files under 500 lines");
  const edgeOver = EDGE_FUNCTIONS.filter((rel) => existsSync(join(ROOT, rel)) && lineCount(rel) > MAX_LINES);
  if (edgeOver.length) {
    notes.push(`Edge note: ${edgeOver.map((f) => `${f} (${lineCount(f)} lines)`).join(", ")} — pre-existing`);
  }

  if (!readText("js/admin/inventory/ui/adjustModalChannelPreview.js").includes("syncToggleUserSet")) {
    errors.push("Manual sync toggle preservation missing");
  }
  notes.push("Admin confirmation via sync toggle preserved");

  const deep = env.RUN_DEEP_059_FINAL === "1";
  notes.push(deep ? "Deep mode: RUN_DEEP_059_FINAL=1" : "Fast mode default (VERIFY_FAST=1)");

  return { notes, errors };
}

function runComposed(env) {
  const notes = [];
  const errors = [];
  const skipped = [];
  const deep = env.RUN_DEEP_059_FINAL === "1";
  const deepC = env.RUN_DEEP_059C_FREEZE === "1" || deep;

  const fastEnv = {
    VERIFY_FAST: "1",
    VERIFY_SKIP_DEEP_REGRESSION: "1",
    RUN_DEEP_059E_REGRESSION: deep ? "1" : "0",
    RUN_DEEP_059C_FREEZE: deepC ? "1" : "0",
  };

  const composed = [
    { script: "verify-inventory-phase059e1-end-to-end-integration.mjs", label: "059E.1 E2E", timeout: 180_000, env: fastEnv },
    { script: "verify-inventory-phase059e2-failure-rollback-clarity.mjs", label: "059E.2 failure clarity", timeout: 120_000, env: fastEnv },
    { script: "verify-inventory-phase059e3-operator-ux-polish.mjs", label: "059E.3 UX polish", timeout: 120_000, env: fastEnv },
    { script: "verify-inventory-phase059a-adjust-orchestration.mjs", label: "059A orchestration", timeout: 180_000, env: fastEnv },
    { script: "verify-inventory-phase059b-final-freeze.mjs", label: "059B freeze", timeout: 300_000, env: fastEnv },
    { script: "verify-inventory-phase059d-final-freeze.mjs", label: "059D freeze", timeout: 600_000, env: { ...fastEnv, RUN_DEEP_059C_FREEZE: deepC ? "1" : "0" } },
    { script: "verify-inventory-issue-view-safety.mjs", label: "issue-view-safety", timeout: 120_000 },
    { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "phase10y pool safety", timeout: 120_000 },
  ];

  for (const { script, label, timeout, env: extra = {} } of composed) {
    console.log(`Running composed: ${label}…`);
    const r = spawnScript(script, timeout, extra);
    if (r.ok) notes.push(`Composed PASS: ${label}`);
    else errors.push(`Composed FAIL: ${label}${r.detail ? ` (${r.detail})` : ""}`);
  }

  if (deepC) {
    console.log("Running composed: 059C final freeze (deep)…");
    const r = spawnScript("verify-inventory-phase059c-final-freeze.mjs", 900_000, fastEnv);
    if (r.ok) notes.push("Composed PASS: 059C final freeze (deep)");
    else errors.push(`Composed FAIL: 059C final freeze${r.detail ? ` (${r.detail})` : ""}`);
  } else {
    console.log("Running 059C fast boundary…");
    const c1 = spawnScript("verify-inventory-phase059c1-ebay-active-audit.mjs", 120_000, fastEnv);
    if (c1.ok) notes.push("Composed PASS: 059C.1 audit (fast)");
    else errors.push(`Composed FAIL: 059C.1 audit${c1.detail ? ` (${c1.detail})` : ""}`);
    const boundary = verify059CFastBoundary();
    notes.push(...boundary.notes);
    errors.push(...boundary.errors);
    skipped.push("Deep 059C freeze skipped (RUN_DEEP_059C_FREEZE=1 or RUN_DEEP_059_FINAL=1)");
  }

  return { notes, errors, skipped };
}

function verifyOptionalLive(env) {
  const notes = [];
  const errors = [];
  const skipped = [];

  const liveAmazon =
    env.RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST === "true" && env.AMAZON_ENABLE_LIVE_PATCH === "true";
  const liveEbayQty =
    env.RUN_LIVE_EBAY_ACTIVE_QTY_TEST === "true" && env.EBAY_ENABLE_LIVE_QUANTITY_PATCH === "true";
  const liveRelist =
    env.RUN_LIVE_EBAY_RELIST_TEST === "true" && env.EBAY_ENABLE_LIVE_RELIST === "true";

  if (!liveAmazon && !liveEbayQty && !liveRelist) {
    skipped.push("Optional live marketplace: skipped (no RUN_LIVE_* + gate flags)");
    skipped.push("Optional dry-run API: use TEST_* ids in sub-scripts if needed");
    return { notes, errors, skipped, liveMade: false };
  }

  skipped.push("Live tests: one variant/test listing only — do not run repeatedly");
  if (liveRelist) skipped.push("WARNING: live eBay relist creates a real listing");

  if (liveAmazon) {
    const r = spawnScript("verify-inventory-phase059b-amazon-inactive-restock.mjs", 180_000, env);
    if (r.ok) notes.push("Optional live: Amazon inactive restock script PASS");
    else errors.push(`Optional live Amazon FAIL${r.detail ? `: ${r.detail}` : ""}`);
  } else skipped.push("Live Amazon inactive: RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST + AMAZON_ENABLE_LIVE_PATCH");

  if (liveEbayQty) {
    const r = spawnScript("verify-inventory-phase059c-ebay-active-sync.mjs", 180_000, env);
    if (r.ok) notes.push("Optional live: eBay active qty script PASS");
    else errors.push(`Optional live eBay qty FAIL${r.detail ? `: ${r.detail}` : ""}`);
  } else skipped.push("Live eBay qty: RUN_LIVE_EBAY_ACTIVE_QTY_TEST + EBAY_ENABLE_LIVE_QUANTITY_PATCH");

  if (liveRelist) {
    const r = spawnScript("verify-inventory-phase059d-ebay-auto-relist.mjs", 300_000, env);
    if (r.ok) notes.push("Optional live: eBay relist script PASS");
    else errors.push(`Optional live eBay relist FAIL${r.detail ? `: ${r.detail}` : ""}`);
  } else skipped.push("Live eBay relist: RUN_LIVE_EBAY_RELIST_TEST + EBAY_ENABLE_LIVE_RELIST");

  return { notes, errors, skipped, liveMade: liveAmazon || liveEbayQty || liveRelist };
}

function printDeployChecklist() {
  console.log("\n--- Production deployment checklist ---");
  for (const item of DEPLOY_CHECKLIST) console.log(`  • ${item}`);
}

function main() {
  const flags = parseArgs();
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  console.log("\n=== Phase 059E.4 — Production Verification (059 Final) ===\n");

  const staticResult = verifyProductionStatic(env);
  console.log("--- Production static checks ---");
  for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
  for (const e of staticResult.errors) console.log(`  ✗ ${e}`);

  const errors = [...staticResult.errors];
  const notes = [...staticResult.notes];
  const skipped = [];

  if (!flags.staticOnly) {
    const composed = runComposed(env);
    console.log("\n--- Composed verification ---");
    for (const n of composed.notes) console.log(`  ✓ ${n}`);
    for (const e of composed.errors) console.log(`  ✗ ${e}`);
    for (const s of composed.skipped) console.log(`  ○ ${s}`);
    notes.push(...composed.notes);
    errors.push(...composed.errors);
    skipped.push(...composed.skipped);

    const live = verifyOptionalLive(env);
    console.log("\n--- Optional API/live ---");
    for (const n of live.notes) console.log(`  ✓ ${n}`);
    for (const s of live.skipped) console.log(`  ○ ${s}`);
    for (const e of live.errors) console.log(`  ✗ ${e}`);
    notes.push(...live.notes);
    errors.push(...live.errors);
    skipped.push(...live.skipped);

    printDeployChecklist();

    console.log("\n--- Deploy readiness summary ---");
    console.log(`  Sections passed: ${notes.length}`);
    console.log(`  Optional skipped: ${skipped.length}`);
    console.log(`  Live marketplace calls during this run: ${live.liveMade ? "YES (explicit flags)" : "NO"}`);
    console.log("  Remaining: 059E.5 final freeze — mark Phase 059 100% complete");
  } else {
    console.log("\n  Mode: --static only (composed scripts skipped)");
    printDeployChecklist();
  }

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 059E.4 production verification\n");
  console.log("No new feature scope in this script. adjust_inventory remains sole stock writer.");
  console.log("Next subphase: 059E.5 — 100% complete / final freeze\n");
}

main();
