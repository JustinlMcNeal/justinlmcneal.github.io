/**
 * Phase 059D.3 — Adjust orchestrator eBay relist integration verification.
 * Run: node scripts/verify-inventory-phase059d3-adjust-ebay-relist-orchestrator.mjs
 *
 * Optional env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TEST_EBAY_RELIST_PRODUCT_ID, TEST_EBAY_RELIST_VARIANT_ID, TEST_EBAY_RELIST_QTY=1
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";

const PHASE_FILES = [
  "js/admin/inventory/api/ebayRelistFromProductApi.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
];

const FORBIDDEN = [
  { label: "full fetchChannelSyncPreview", pattern: /fetchChannelSyncPreview/ },
  { label: "browser snapshot refresh", pattern: /issueSnapshot|refreshIssueSnapshot/ },
];

const FAST_REGRESSION = [
  { script: "verify-inventory-phase059d2-ebay-relist-edge.mjs", label: "phase059d2-ebay-relist-edge" },
  {
    script: "verify-inventory-phase059d1-ebay-relist-audit.mjs",
    label: "phase059d1-ebay-relist-audit",
    env: { VERIFY_FAST: "1" },
  },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue-view-safety" },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "phase10y-final-stabilization" },
];

function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(rel) {
  return readText(rel).split("\n").length;
}

function verifyStatic() {
  const notes = [];
  const errors = [];

  for (const rel of PHASE_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
    else notes.push(`${rel}: ${lineCount(rel)} lines`);
  }

  const api = readText("js/admin/inventory/api/ebayRelistFromProductApi.js");
  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  const nextSteps = readText("js/admin/inventory/services/adjustChannelNextSteps.js");
  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");

  if (!api.includes("relist-ebay-from-product") || !api.includes("relistEbayFromProduct")) {
    errors.push("ebayRelistFromProductApi must invoke relist-ebay-from-product edge");
  }
  if (!api.includes("syncContext") || !api.includes("preview")) {
    errors.push("Relist API must pass syncContext and preview");
  }
  notes.push("Relist API wrapper present");

  if (!branch.includes("relistEbayFromProduct") || !branch.includes("runEbayEndedRelist")) {
    errors.push("eBay branch must import and call relistEbayFromProduct");
  }
  if (!branch.includes('action === "ended_needs_relist"') || !branch.includes("runEbayEndedRelist")) {
    errors.push("Relist only for ended_needs_relist action");
  }
  if (!branch.includes("available <= 0") || !branch.includes("quantity: available")) {
    errors.push("Relist must require positive available quantity");
  }
  if (!branch.includes("syncContext")) errors.push("Relist path must pass syncContext");
  if (!branch.includes('action === "update_qty"') || !branch.includes("pushEbayInventoryQuantity")) {
    errors.push("Direct update_qty path must be preserved");
  }
  if (!branch.includes('action === "qty_cache_missing"') || !branch.includes("runAdjustEbayCacheRefreshChain")) {
    errors.push("qty_cache_missing cache chain must be preserved");
  }
  if (!branch.includes("unsupported_variation")) {
    errors.push("unsupported_variation manual path must remain");
  }
  notes.push("eBay branch: relist for ended + preserved active/cache paths");

  const orchBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));
  const adjustIdx = orchBody.indexOf("await adjustInventory(");
  const ebayIdx = orchBody.indexOf("await resolveEbayBranch(");
  if (adjustIdx < 0 || ebayIdx < 0 || ebayIdx < adjustIdx) {
    errors.push("Relist must run only after successful adjust_inventory");
  }
  if (!orchBody.includes("projectedAvailable <= 0")) {
    errors.push("Orchestrator must skip channels when projected available <= 0");
  }
  if (!orchBody.includes("await adjustInventory(")) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  notes.push("Orchestrator ordering + qty gate preserved");

  if (!nextSteps.includes('case "ended_needs_relist"') || !nextSteps.includes("return null")) {
    errors.push("ended_needs_relist next-step must be null (branch-owned)");
  }
  if (!preview.includes("eBay ended listing can be relisted")) {
    errors.push("Preview must describe ended relist after adjust");
  }
  if (!preview.includes("ended_needs_relist") || !preview.includes("computeSyncToggleDefault")) {
    errors.push("Preview must include ended relist toggle eligibility");
  }
  if (!panel.includes("listingId") || !panel.includes("offerId")) {
    errors.push("Result panel must show relist listing/offer IDs when present");
  }
  notes.push("Preview + result panel relist UX present");

  for (const rel of ADJUST_FLOW_FILES) {
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(readText(rel))) errors.push(`${rel}: forbidden ${label}`);
    }
  }
  notes.push("No heavy reads in adjust flow");

  const amazonInactive = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (amazonInactive.includes("relistEbayFromProduct") || amazonInactive.includes("ebayRelistFromProductApi")) {
    errors.push("Amazon module must not reference eBay relist orchestration");
  }
  notes.push("Amazon paths unchanged");

  const doc = readText(PLAN_DOC);
  if (!doc.includes("059D.3") || !doc.includes("ebayRelistFromProductApi")) {
    errors.push("Plan doc must document 059D.3 orchestrator integration");
  }

  return { notes, errors };
}

async function verifyOptionalApi() {
  const notes = [];
  const errors = [];
  const skipped = [];

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const productId = process.env.TEST_EBAY_RELIST_PRODUCT_ID?.trim();
  const variantId = process.env.TEST_EBAY_RELIST_VARIANT_ID?.trim();
  const qty = Number(process.env.TEST_EBAY_RELIST_QTY || 1);

  if (!url || !key) {
    skipped.push("Optional API: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors, skipped };
  }
  if (!productId || !variantId) {
    skipped.push("Optional API: skipped — missing TEST_EBAY_RELIST_PRODUCT_ID or TEST_EBAY_RELIST_VARIANT_ID");
    return { notes, errors, skipped };
  }

  const { relistEbayFromProduct } = await import(
    join(ROOT, "js/admin/inventory/api/ebayRelistFromProductApi.js")
  ).catch(() => ({ relistEbayFromProduct: null }));

  if (!relistEbayFromProduct) {
    skipped.push("Optional API: skipped — could not load relist API module in Node");
    return { notes, errors, skipped };
  }

  skipped.push("Optional API: skipped — browser session required for relist API (use edge verify in 059D.2)");
  return { notes, errors, skipped };
}

function runFastRegression() {
  const notes = [];
  const errors = [];
  const skipped = [];

  for (const { script, label, env = {} } of FAST_REGRESSION) {
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`Missing regression script: ${script}`);
      continue;
    }
    const result = spawnSync(process.execPath, [path], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, ...env },
    });
    if (result.status === 0) notes.push(`Regression PASS: ${label}`);
    else {
      const timedOut = result.error?.code === "ETIMEDOUT";
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-3).join(" ").trim();
      errors.push(`Regression FAIL: ${label}${timedOut ? " (timeout)" : ""}${tail ? ` — ${tail.slice(0, 100)}` : ""}`);
    }
  }

  const deepFreeze = join(ROOT, "scripts", "verify-inventory-phase059c-final-freeze.mjs");
  if (process.env.RUN_DEEP_059C_FREEZE === "1" && existsSync(deepFreeze)) {
    const result = spawnSync(process.execPath, [deepFreeze], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 900_000,
      env: { ...process.env },
    });
    if (result.status === 0) notes.push("Deep regression PASS: phase059c-final-freeze");
    else errors.push("Deep regression FAIL: phase059c-final-freeze");
  } else {
    skipped.push("Deep 059C freeze skipped (set RUN_DEEP_059C_FREEZE=1 for full chain)");
  }

  return { notes, errors, skipped };
}

async function main() {
  try {
    const envPath = join(ROOT, ".env");
    if (existsSync(envPath)) {
      for (const line of readText(".env").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i > 0 && !process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      }
    }
  } catch {
    // optional
  }

  const staticResult = verifyStatic();
  const regression = runFastRegression();
  let apiResult = { notes: [], errors: [], skipped: [] };
  try {
    apiResult = await verifyOptionalApi();
  } catch (err) {
    apiResult.skipped.push(`Optional API exception: ${err.message}`);
  }

  const errors = [...staticResult.errors, ...regression.errors, ...apiResult.errors];
  const notes = [...staticResult.notes, ...regression.notes, ...apiResult.notes];
  const skipped = [...regression.skipped, ...apiResult.skipped];

  console.log("\n=== Phase 059D.3 — Adjust eBay Relist Orchestrator ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const s of skipped) console.log(`  ○ ${s}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059D.3 Adjust eBay relist orchestrator\n");
  console.log("Next subphase: 059D.4 — eBay relist verification\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
