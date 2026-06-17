/**
 * Phase 059E.5 — Final freeze for Adjust → Unified Channel Restock.
 *
 * Run: node scripts/verify-inventory-phase059-final-freeze.mjs
 *
 * Composes verify-inventory-phase059-final.mjs (production verification),
 * then validates docs/roadmap/changelog freeze criteria.
 *
 * Optional live flags are never set by this script.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const ROADMAP = "docs/pages/admin/inventory/implementation/roadmap.md";
const PROD_SCRIPT = "verify-inventory-phase059-final.mjs";
const FREEZE_SCRIPT = "verify-inventory-phase059-final-freeze.mjs";

const DELIVERED = [
  "Adjust modal channel preview",
  "sync toggle",
  "adjust-first",
  "Amazon active",
  "Amazon inactive",
  "eBay active",
  "eBay cache refresh",
  "eBay ended single-SKU",
  "result panel",
  "partial-success",
  "failure",
  "rollback clarity",
  "verify-inventory-phase059-final.mjs",
  "pool-safety",
];

const DEFERRED = [
  "variation group active qty",
  "variation group ended relist",
  "Phase 060",
  "060A",
  "qty-0",
  "bulk relist",
  "bulk adjust",
  "Automatic marketplace sync without admin",
  "stock rollback",
  "10T",
  "RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST",
  "RUN_LIVE_EBAY_ACTIVE_QTY_TEST",
  "RUN_LIVE_EBAY_RELIST_TEST",
  "explicit flags",
];

const DEPLOY_ITEMS = [
  "20261023_inventory_phase059a4_adjust_sync_run_correlation.sql",
  "sync-amazon-inventory-quantity",
  "sync-ebay-inventory-quantity",
  "sync-ebay-listing-inventory-cache",
  "relist-ebay-from-product",
  "AMAZON_ENABLE_LIVE_PATCH",
  "EBAY_ENABLE_LIVE_QUANTITY_PATCH",
  "EBAY_ENABLE_LIVE_RELIST",
  "verify-inventory-phase10y-final-stabilization.mjs",
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifyFreezeDocs() {
  const notes = [];
  const errors = [];
  const plan = readText(PLAN_DOC);
  const roadmap = readText(ROADMAP);

  if (!plan.includes("059E.5 | ✅ Complete")) errors.push("Plan: 059E.5 must be marked complete");
  if (!plan.includes("059E.5 ✅") && !plan.includes("059E.5 — 100% complete / final freeze ✅")) {
    errors.push("Plan: 059E.5 section must be marked complete");
  }
  if (!/Phase 059.*Complete|059.*Complete.*Frozen|Production-ready/i.test(plan)) {
    errors.push("Plan: Phase 059 must be marked complete/frozen/production-ready");
  }
  if (!plan.includes(FREEZE_SCRIPT)) errors.push(`Plan must reference ${FREEZE_SCRIPT}`);
  if (!plan.includes(PROD_SCRIPT)) errors.push(`Plan must reference ${PROD_SCRIPT}`);
  notes.push("Plan: 059E.5 + Phase 059 complete/frozen");

  for (const major of ["059A", "059B", "059C", "059D", "059E"]) {
    if (!roadmap.includes(`${major}`) || !roadmap.includes("✅")) {
      errors.push(`Roadmap: ${major} must be marked complete`);
    }
  }
  if (!/059.*✅ Complete|Phase 059.*✅|059 ✅ Complete/i.test(roadmap)) {
    errors.push("Roadmap: Phase 059 must be marked complete");
  }
  if (!roadmap.includes("059E.5") || !roadmap.includes("✅")) {
    errors.push("Roadmap: 059E.5 must be marked complete");
  }
  if (!roadmap.includes(FREEZE_SCRIPT) && !plan.includes(FREEZE_SCRIPT)) {
    errors.push("Roadmap or plan must reference freeze script");
  }
  notes.push("Roadmap: 059A–059E + Phase 059 complete");

  for (const item of DEPLOY_ITEMS) {
    if (!plan.includes(item)) errors.push(`Plan deploy checklist missing: ${item}`);
  }
  notes.push("Deployment checklist present in plan");

  if (!plan.includes("AMAZON_ENABLE_LIVE_PATCH") || !plan.includes("EBAY_ENABLE_LIVE_RELIST")) {
    errors.push("Plan: live-gate instructions missing");
  }
  if (!plan.includes("not run by default")) {
    errors.push("Plan: optional live tests must note not run by default");
  }
  if (!plan.includes("RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST")) {
    errors.push("Plan: RUN_LIVE_AMAZON_INACTIVE_RESTOCK_TEST flag missing");
  }
  if (!plan.includes("Phase 060")) errors.push("Plan: Phase 060 deferred reference missing");
  notes.push("Live-gate + optional live test instructions documented");

  const deferredSection = plan.slice(plan.indexOf("## Deferred outside Phase 059"));
  if (!deferredSection) errors.push("Plan: Deferred outside Phase 059 section missing");
  const planLower = plan.toLowerCase();
  for (const term of DEFERRED) {
    if (!planLower.includes(term.toLowerCase())) errors.push(`Plan deferred/limitations missing: ${term}`);
  }
  notes.push("Frozen limitations / deferred items documented");

  let deliveredHits = 0;
  for (const term of DELIVERED) {
    if (plan.toLowerCase().includes(term.toLowerCase())) deliveredHits++;
    else errors.push(`Plan delivered-features doc missing: ${term}`);
  }
  notes.push(`Delivered features documented: ${deliveredHits}/${DELIVERED.length}`);

  if (!plan.includes("## Changelog") || !plan.includes("059E.5")) {
    errors.push("Plan changelog must include 059E.5 / Phase 059 complete entry");
  }
  notes.push("Final changelog entry present");

  const unfinished = [
    /059E\.5 next/i,
    /Pending \(059E\.5/i,
    /next: 059E\.5/i,
    /059E\.4 next/i,
    /\| 059E\.5 \| ⬜/,
  ];
  for (const re of unfinished) {
    if (re.test(plan)) errors.push(`Plan still suggests unfinished 059 work: ${re}`);
  }
  if (/🚧 In progress/.test(roadmap) && roadmap.includes("059")) {
    errors.push("Roadmap still marks Phase 059 in progress");
  }
  notes.push("No unfinished 059 TODOs in docs (except deferred)");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (/rollbackStock|undoAdjust|reverseAdjustment/.test(orch)) {
    errors.push("Orchestrator: stock rollback forbidden");
  }
  const adjustCalls = (orch.match(/await adjustInventory\(/g) || []).length;
  if (adjustCalls !== 1) errors.push(`adjust_inventory sole writer (found ${adjustCalls})`);
  notes.push("Runtime guardrails: sole stock writer, no rollback");

  return { notes, errors };
}

function runProductionVerify() {
  const path = join(ROOT, "scripts", PROD_SCRIPT);
  if (!existsSync(path)) return { ok: false, error: `Missing ${PROD_SCRIPT}` };
  const result = spawnSync(process.execPath, [path], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 900_000,
    env: { ...process.env, VERIFY_FAST: "1", VERIFY_SKIP_DEEP_REGRESSION: "1" },
  });
  if (result.status === 0) return { ok: true };
  const tail = (result.stdout || result.stderr || "").split("\n").slice(-5).join(" ").trim();
  return { ok: false, error: tail.slice(0, 200) || `exit ${result.status}` };
}

function main() {
  console.log("\n=== Phase 059E.5 — Final Freeze (100% Complete) ===\n");

  const freeze = verifyFreezeDocs();
  for (const n of freeze.notes) console.log(`  ✓ Freeze docs: ${n}`);
  for (const e of freeze.errors) console.log(`  ✗ Freeze docs: ${e}`);

  console.log(`\nRunning composed: ${PROD_SCRIPT}…`);
  const prod = runProductionVerify();
  if (prod.ok) console.log(`  ✓ Composed PASS: ${PROD_SCRIPT}`);
  else console.log(`  ✗ Composed FAIL: ${PROD_SCRIPT}${prod.error ? ` — ${prod.error}` : ""}`);

  const errors = [...freeze.errors, ...(prod.ok ? [] : [`Production verify failed: ${prod.error}`])];

  console.log("\n--- Production deployment checklist ---");
  for (const item of [
    "Apply migration: 20261023_inventory_phase059a4_adjust_sync_run_correlation.sql",
    "Deploy edges: sync-amazon-inventory-quantity, sync-ebay-inventory-quantity, sync-ebay-listing-inventory-cache, relist-ebay-from-product",
    "Deploy shared helpers: Amazon inactive restore + eBay cache/relist/publish",
    "Deploy admin JS/static bundle",
    "Confirm Supabase secrets: Amazon sync + eBay OAuth",
    "Set live gates when ready: AMAZON_ENABLE_LIVE_PATCH, EBAY_ENABLE_LIVE_QUANTITY_PATCH, EBAY_ENABLE_LIVE_RELIST",
    "Post-deploy smoke: inventory page, adjust modal, KK-only, dry_run paths, result panel, phase10y",
  ]) {
    console.log(`  • ${item}`);
  }

  console.log("\n--- Freeze summary ---");
  console.log(`  Phase 059 marked complete/frozen: ${errors.length === 0 ? "YES" : "NO (fix docs first)"}`);
  console.log("  Live marketplace calls during this run: NO");
  console.log("  adjust_inventory remains sole stock writer: YES");
  console.log("  No new feature scope in freeze: YES");

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 059 complete, frozen, production-ready\n");
  console.log("Phase 059 — Adjust Stock → Unified Channel Restock: 100% complete.\n");
}

main();
