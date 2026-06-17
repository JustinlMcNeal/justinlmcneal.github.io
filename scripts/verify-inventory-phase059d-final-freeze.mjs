/**
 * Phase 059D.5 — eBay ended relist QA freeze.
 * Composes 059D sub-phase scripts + final static guardrails.
 *
 * Run: node scripts/verify-inventory-phase059d-final-freeze.mjs
 *
 * Optional env (passed to 059D.4 matrix):
 *   TEST_EBAY_RELIST_PRODUCT_ID, TEST_EBAY_RELIST_VARIANT_ID, TEST_EBAY_RELIST_QTY=1
 *   RUN_LIVE_EBAY_RELIST_TEST, EBAY_ENABLE_LIVE_RELIST (live only — all required)
 *   RUN_DEEP_059C_FREEZE=1 — full 059C final freeze chain
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

const D059_RUNTIME = [
  "supabase/functions/relist-ebay-from-product/index.ts",
  "supabase/functions/_shared/ebayRelistFromProduct.ts",
  "supabase/functions/_shared/ebayRelistCandidateLoaders.ts",
  "supabase/functions/_shared/ebayListingPublishUtils.ts",
  "js/admin/inventory/api/ebayRelistFromProductApi.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
];

const ADJUST_FLOW = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
];

const COMPOSED = [
  { script: "verify-inventory-phase059d1-ebay-relist-audit.mjs", label: "059D.1 audit", env: { VERIFY_FAST: "1" }, timeout: 120_000 },
  { script: "verify-inventory-phase059d2-ebay-relist-edge.mjs", label: "059D.2 edge", timeout: 120_000 },
  { script: "verify-inventory-phase059d3-adjust-ebay-relist-orchestrator.mjs", label: "059D.3 orchestrator", timeout: 120_000 },
  { script: "verify-inventory-phase059d-ebay-auto-relist.mjs", label: "059D.4 matrix", timeout: 300_000 },
  { script: "verify-inventory-phase059b-final-freeze.mjs", label: "059B freeze", timeout: 180_000 },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue-view-safety", timeout: 120_000 },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "phase10y", timeout: 120_000 },
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

  for (const rel of D059_RUNTIME) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing 059D file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("059D runtime modules present and under 500 lines");

  const index = readText("supabase/functions/relist-ebay-from-product/index.ts");
  const handler = readText("supabase/functions/_shared/ebayRelistFromProduct.ts");
  const loaders = readText("supabase/functions/_shared/ebayRelistCandidateLoaders.ts");
  const publish = readText("supabase/functions/_shared/ebayListingPublishUtils.ts");
  const api = readText("js/admin/inventory/api/ebayRelistFromProductApi.js");
  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");

  const edge = [
    ["EBAY_ENABLE_LIVE_RELIST gate", index.includes("EBAY_ENABLE_LIVE_RELIST")],
    ["gate-off / preview dry_run", handler.includes('"dry_run"') && index.includes("liveRelistDisabled")],
    ["ready_to_relist", handler.includes("ready_to_relist")],
    ["qty > 0", handler.includes("quantity_required")],
    ["unsupported variation manual", handler.includes("unsupported_variation")],
    ["missing metadata/aspects manual", handler.includes("missing_required_listing_data") && handler.includes("Missing required eBay aspects")],
    ["create item/offer/publish", publish.includes("createEbayInventoryItem") && publish.includes("publishEbayOffer")],
    ["reconcile listing/offer", handler.includes("ebay_listing_id") && handler.includes("ebay_offer_id")],
    ["old listing not reactivated", handler.includes("was not reactivated")],
    ["sync run correlation", handler.includes("relist_from_product") && handler.includes("createInventorySyncRun")],
    ["candidate view", loaders.includes("v_inventory_ebay_relist_candidates")],
  ];
  for (const [label, ok] of edge) if (!ok) errors.push(`Edge freeze: ${label}`);
  notes.push(`Edge guardrails: ${edge.filter(([, ok]) => ok).length}/${edge.length}`);

  const orchBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));
  const orchChecks = [
    ["relist API", api.includes("relist-ebay-from-product")],
    ["ended only", branch.includes('action === "ended_needs_relist"') && branch.includes("runEbayEndedRelist")],
    ["after adjust", orchBody.indexOf("await adjustInventory(") >= 0 && orchBody.indexOf("await resolveEbayBranch(") > orchBody.indexOf("await adjustInventory(")],
    ["sync toggle gate", orchBody.includes("syncChannelsEnabled")],
    ["projectedAvailable > 0", orchBody.includes("projectedAvailable <= 0")],
    ["update_qty preserved", branch.includes("pushEbayInventoryQuantity")],
    ["cache chain preserved", branch.includes("runAdjustEbayCacheRefreshChain")],
    ["sole stock writer", orchBody.includes("await adjustInventory(") && !handler.includes("adjust_inventory")],
  ];
  for (const [label, ok] of orchChecks) if (!ok) errors.push(`Orchestrator freeze: ${label}`);
  notes.push(`Orchestrator guardrails: ${orchChecks.filter(([, ok]) => ok).length}/${orchChecks.length}`);

  for (const rel of ADJUST_FLOW) {
    const text = readText(rel);
    if (/fetchChannelSyncPreview|issueSnapshot|refreshIssueSnapshot/.test(text)) {
      errors.push(`${rel}: forbidden heavy read in adjust flow`);
    }
  }
  notes.push("No snapshot refresh or full preview in adjust flow");

  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (amazon.includes("relistEbayFromProduct") || amazon.includes("ebayRelistFromProductApi")) {
    errors.push("Amazon module must not reference 059D relist");
  }
  notes.push("Amazon paths unchanged by 059D");

  const doc = readText(PLAN_DOC);
  if (!doc.includes("verify-inventory-phase059d-final-freeze.mjs")) {
    errors.push("Plan doc must reference 059D.5 freeze script");
  }
  if (!doc.includes("059D.5") || !doc.includes("059D major phase")) {
    errors.push("Plan doc must document 059D.5 / major phase complete");
  }
  notes.push("Plan doc references 059D freeze");

  const roadmap = readText(ROADMAP);
  if (!roadmap.includes("059D") || !roadmap.includes("✅")) {
    errors.push("roadmap.md must mark 059D complete");
  }
  notes.push("Roadmap marks 059D complete (frozen)");

  return { notes, errors };
}

function verify059CFastBoundary() {
  const notes = [];
  const errors = [];
  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  if (!branch.includes("pushEbayInventoryQuantity")) errors.push("059C: update_qty path must remain");
  if (!branch.includes("runAdjustEbayCacheRefreshChain")) errors.push("059C: cache chain must remain");
  if (!branch.includes("runEbayEndedRelist")) errors.push("059D relist wired in eBay branch");
  notes.push("059C fast boundary: active/cache paths + 059D relist coexist");
  return { notes, errors };
}

function runComposed() {
  const notes = [];
  const errors = [];
  const skipped = [];

  for (const { script, label, env = {}, timeout } of COMPOSED) {
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`Missing composed script: ${script}`);
      continue;
    }
    const result = spawnSync(process.execPath, [path], {
      cwd: ROOT,
      encoding: "utf8",
      timeout,
      env: { ...process.env, ...env },
    });
    if (result.status === 0) notes.push(`Composed PASS: ${label}`);
    else {
      const timedOut = result.error?.code === "ETIMEDOUT";
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-3).join(" ").trim();
      errors.push(`Composed FAIL: ${label}${timedOut ? " (timeout)" : ""}${tail ? ` — ${tail.slice(0, 100)}` : ""}`);
    }
  }

  const deep = process.env.RUN_DEEP_059C_FREEZE === "1";
  const freeze059c = join(ROOT, "scripts", "verify-inventory-phase059c-final-freeze.mjs");
  if (deep && existsSync(freeze059c)) {
    const result = spawnSync(process.execPath, [freeze059c], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 900_000,
      env: { ...process.env },
    });
    if (result.status === 0) notes.push("Composed PASS: 059C final freeze (deep)");
    else errors.push("Composed FAIL: 059C final freeze (deep)");
  } else {
    const fast = verify059CFastBoundary();
    notes.push(...fast.notes);
    errors.push(...fast.errors);
    skipped.push("Deep 059C freeze skipped (RUN_DEEP_059C_FREEZE=1 for full chain)");
  }

  const hasRelistIds =
    process.env.TEST_EBAY_RELIST_PRODUCT_ID?.trim() && process.env.TEST_EBAY_RELIST_VARIANT_ID?.trim();
  const runLive =
    process.env.RUN_LIVE_EBAY_RELIST_TEST === "true" && process.env.EBAY_ENABLE_LIVE_RELIST === "true";

  if (!hasRelistIds) {
    skipped.push("Optional dry-run API: TEST_EBAY_RELIST_* not set (see 059D.4 matrix)");
  }
  if (!runLive) {
    skipped.push("Optional live relist: RUN_LIVE_EBAY_RELIST_TEST + EBAY_ENABLE_LIVE_RELIST not both true");
  }

  return { notes, errors, skipped };
}

function main() {
  const staticResult = verifyFreezeStatic();
  const composed = runComposed();

  const errors = [...staticResult.errors, ...composed.errors];
  const notes = [...staticResult.notes, ...composed.notes];
  const skipped = composed.skipped;

  console.log("\n=== Phase 059D.5 — eBay Ended Relist QA Freeze ===\n");

  console.log("Final 059D static checks:");
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
    process.env.RUN_LIVE_EBAY_RELIST_TEST === "true" && process.env.EBAY_ENABLE_LIVE_RELIST === "true";

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 059D frozen (059D.1–059D.5 complete)\n");
  console.log(`Live eBay relist during this run: ${liveThisRun ? "YES (explicit flags set)" : "NO"}`);
  console.log("Next subphase: 059E.1 — End-to-end integration pass\n");
}

main();
