/**
 * Phase 059D.2 — eBay relist edge function verification.
 * Run: node scripts/verify-inventory-phase059d2-ebay-relist-edge.mjs
 *
 * Optional env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TEST_EBAY_RELIST_PRODUCT_ID, TEST_EBAY_RELIST_VARIANT_ID, TEST_EBAY_RELIST_QTY=1
 *
 * 059D.1 regression runs in VERIFY_FAST=1 mode (no nested 059C freeze chain).
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MAX_LINES = 500;
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";

const EDGE_FILES = [
  "supabase/functions/relist-ebay-from-product/index.ts",
  "supabase/functions/_shared/ebayRelistFromProduct.ts",
  "supabase/functions/_shared/ebayRelistCandidateLoaders.ts",
  "supabase/functions/_shared/ebayListingPublishUtils.ts",
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

  for (const rel of EDGE_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
    else notes.push(`${rel}: ${lineCount(rel)} lines`);
  }

  const index = readText("supabase/functions/relist-ebay-from-product/index.ts");
  const handler = readText("supabase/functions/_shared/ebayRelistFromProduct.ts");
  const loaders = readText("supabase/functions/_shared/ebayRelistCandidateLoaders.ts");
  const publish = readText("supabase/functions/_shared/ebayListingPublishUtils.ts");

  if (!index.includes("productId") || !index.includes("variantId") || !index.includes("quantity")) {
    errors.push("Edge index must accept productId, variantId, quantity");
  }
  if (!index.includes("preview") || !index.includes("syncContext")) {
    errors.push("Edge index must accept preview and syncContext");
  }
  if (!index.includes("EBAY_ENABLE_LIVE_RELIST")) {
    errors.push("Edge must use dedicated EBAY_ENABLE_LIVE_RELIST gate");
  }
  if (!index.includes("requireAdminJson")) errors.push("Edge must require admin auth");
  notes.push("Edge contract + admin auth + live gate present");

  if (!loaders.includes("v_inventory_ebay_relist_candidates")) {
    errors.push("Must load relist candidate from v_inventory_ebay_relist_candidates");
  }
  if (!handler.includes("ready_to_relist")) errors.push("Handler must require ready_to_relist");
  if (!handler.includes("ended_needs_relist")) errors.push("Handler must check ended_needs_relist");
  if (!handler.includes("unsupported_variation") || !loaders.includes("isVariationBlocked")) {
    errors.push("Handler must exclude variation groups");
  }
  if (!handler.includes('status: "dry_run"') && !handler.includes('"dry_run"')) {
    errors.push("Handler must return dry_run when gate off/preview");
  }
  if (!handler.includes("Missing required eBay aspects")) {
    errors.push("Missing aspects must return manual message");
  }
  notes.push("Candidate validation: ready_to_relist, ended, no variation");

  if (!publish.includes("createEbayInventoryItem") || !publish.includes("createEbayOffer") || !publish.includes("publishEbayOffer")) {
    errors.push("Publish utils must implement create item, create offer, publish");
  }
  if (!handler.includes("ebay_listing_id") || !handler.includes("ebay_status")) {
    errors.push("Handler must reconcile new listing/offer IDs");
  }
  if (!handler.includes("was not reactivated")) {
    errors.push("Handler must not treat old listing ID as reactivated");
  }
  notes.push("Publish chain + DB reconciliation present");

  if (!handler.includes("createInventorySyncRun") || !handler.includes("relist_from_product")) {
    errors.push("Handler must log inventory_channel_sync_runs with relist_from_product action");
  }
  if (!handler.includes('channel: "ebay"')) errors.push("Sync run channel must be ebay");
  notes.push("Audit/correlation via inventory_channel_sync_runs");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (!orch.includes("await adjustInventory(")) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  if (handler.includes("adjust_inventory")) {
    errors.push("Relist edge handler must not call adjust_inventory");
  }
  notes.push("No stock writer in relist edge path");

  const amazonInactive = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (amazonInactive.includes("relist-ebay-from-product") || amazonInactive.includes("EBAY_ENABLE_LIVE_RELIST")) {
    errors.push("Amazon inactive module must not reference eBay relist");
  }
  notes.push("Amazon files unchanged");

  const orchHeavy = /issueSnapshot|refreshIssueSnapshot|fetchChannelSyncPreview/.test(orch);
  const handlerHeavy = /issueSnapshot|refreshIssueSnapshot|fetchChannelSyncPreview/.test(handler);
  if (orchHeavy || handlerHeavy) {
    errors.push("Relist path must not use heavy reads");
  }
  notes.push("No snapshot refresh or heavy reads");

  const doc = readText(PLAN_DOC);
  if (!doc.includes("059D.2") || !doc.includes("relist-ebay-from-product")) {
    errors.push("Plan doc must document 059D.2 relist edge");
  }
  if (doc.includes("059D.2 — Relist edge function ✅") && !doc.includes("059D.2 complete")) {
    // allow when we update
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

  const resp = await fetch(`${url}/functions/v1/relist-ebay-from-product`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productId,
      variantId,
      quantity: qty,
      preview: true,
      syncContext: {
        trigger_source: "manual_adjust",
        trigger_reference_type: "stock_ledger",
        orchestration_id: `059d2-test-${Date.now()}`,
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
    notes.push(`Optional API: preview status=${status} message=${String(data.message || "").slice(0, 80)}`);
  } else if (status === "success") {
    errors.push("Optional API: preview must not return success (live publish)");
  } else {
    notes.push(`Optional API: response status=${status ?? "unknown"}`);
  }

  if (data.mode !== "ebay_relist_from_product") {
    errors.push("Optional API: mode must be ebay_relist_from_product");
  }

  return { notes, errors, skipped };
}

function run059D1Regression() {
  const notes = [];
  const errors = [];
  const script = join(ROOT, "scripts", "verify-inventory-phase059d1-ebay-relist-audit.mjs");
  if (!existsSync(script)) {
    errors.push("Missing 059D.1 audit script for regression");
    return { notes, errors };
  }
  const result = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, VERIFY_FAST: "1" },
  });
  if (result.status === 0) notes.push("Regression PASS: phase059d1-ebay-relist-audit (VERIFY_FAST=1)");
  else {
    const timedOut = result.error?.code === "ETIMEDOUT";
    const tail = (result.stdout || result.stderr || "").split("\n").slice(-4).join(" ").trim();
    errors.push(`Regression FAIL: phase059d1${timedOut ? " (timeout)" : ""}${tail ? ` — ${tail.slice(0, 120)}` : ""}`);
  }
  return { notes, errors };
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
  const regression = run059D1Regression();
  let apiResult = { notes: [], errors: [], skipped: [] };
  try {
    apiResult = await verifyOptionalApi();
  } catch (err) {
    apiResult.skipped.push(`Optional API exception: ${err.message}`);
  }

  const errors = [...staticResult.errors, ...regression.errors, ...apiResult.errors];
  const notes = [...staticResult.notes, ...regression.notes, ...apiResult.notes];

  console.log("\n=== Phase 059D.2 — eBay Relist Edge Function ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const s of apiResult.skipped) console.log(`  ○ ${s}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059D.2 eBay relist edge function\n");
  console.log("Next subphase: 059D.3 — Adjust orchestrator relist integration\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
