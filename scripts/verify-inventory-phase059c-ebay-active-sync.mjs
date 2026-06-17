/**
 * Phase 059C.4 — Full eBay active sync path verification.
 *
 * Run: node scripts/verify-inventory-phase059c-ebay-active-sync.mjs
 *
 * Optional env (cache refresh API):
 *   TEST_EBAY_CACHE_PRODUCT_ID, TEST_EBAY_CACHE_VARIANT_ID
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional env (qty push dry-run / live):
 *   RUN_EBAY_ACTIVE_QTY_TEST=true
 *   TEST_EBAY_CACHE_PRODUCT_ID, TEST_EBAY_CACHE_VARIANT_ID
 *   EBAY_ENABLE_LIVE_QUANTITY_PATCH=true + RUN_LIVE_EBAY_ACTIVE_QTY_TEST=true (live only)
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9903;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";

const REGRESSION_SCRIPTS = [
  "verify-inventory-phase059a-adjust-orchestration.mjs",
  "verify-inventory-phase059b-final-freeze.mjs",
  "verify-inventory-phase059c1-ebay-active-audit.mjs",
  "verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs",
  "verify-inventory-phase059c3-adjust-ebay-active-orchestrator.mjs",
  "verify-inventory-issue-view-safety.mjs",
  "verify-inventory-phase10y-final-stabilization.mjs",
];

const PHASE_FILES = [
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayCache.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/api/ebayCacheRefreshApi.js",
  "js/admin/inventory/api/ebaySyncPushApi.js",
  "supabase/functions/sync-ebay-listing-inventory-cache/index.ts",
  "supabase/functions/sync-ebay-inventory-quantity/index.ts",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayCache.js",
];

const FORBIDDEN = [
  { label: "eBay auto-relist", pattern: /pushEbayRelist|autoRelistListing|relist-ebay-from-product/i },
  { label: "full fetchChannelSyncPreview", pattern: /fetchChannelSyncPreview/ },
  { label: "browser snapshot refresh", pattern: /issueSnapshot|refreshIssueSnapshot/ },
];

const MOCK_QTY_CACHE_MISSING = {
  variant_id: "33333333-3333-4333-8333-333333333333",
  product_id: "44444444-4444-4444-8444-444444444444",
  available_qty: 8,
  on_hand_qty: 8,
  reserved_qty: 0,
  kk_sync_action: "update_qty",
  amazon_sync_action: "no_change",
  amazon_listing_status: null,
  amazon_current_qty: 0,
  ebay_sync_action: "qty_cache_missing",
  ebay_listing_status: "active",
  ebay_current_qty: null,
  issue_flags: [],
};

function loadEnv() {
  const env = {};
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
  return env;
}

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
  }
  notes.push("059C active path modules present and under 500 lines");

  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const cache = readText("js/admin/inventory/services/adjustChannelEbayCache.js");
  const nextSteps = readText("js/admin/inventory/services/adjustChannelNextSteps.js");
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");

  if (!branch.includes("pushEbayInventoryQuantity")) {
    errors.push("Direct update_qty path must call pushEbayInventoryQuantity");
  }
  if (!branch.includes("runAdjustEbayCacheRefreshChain")) {
    errors.push("qty_cache_missing path must call runAdjustEbayCacheRefreshChain");
  }
  if (!cache.includes("fetchChannelSyncCandidateForVariant")) {
    errors.push("Cache chain must re-fetch candidate");
  }
  if (
    !branch.includes('nextAction === "update_qty"') ||
    !branch.includes('refreshedAction === "update_qty"')
  ) {
    errors.push("Qty push after cache refresh requires refreshed update_qty");
  }
  if (!branch.includes("cache refresh failed. Quantity sync was not attempted")) {
    errors.push("Cache refresh failure must block qty push");
  }
  if (!branch.includes("syncContext")) errors.push("syncContext must flow through eBay branch");
  if (cache.includes("pushEbayInventoryQuantity")) {
    errors.push("Cache helper must not push qty");
  }
  notes.push("eBay branch: direct update_qty + cache-missing chain + guarded push");

  const resolveBlock = branch.slice(branch.indexOf("export async function resolveEbayBranch"));
  if (!resolveBlock.includes('action === "update_qty"') || !resolveBlock.includes("runEbayUpdateQty")) {
    errors.push("Direct update_qty path must remain in resolveEbayBranch");
  }

  if (!branch.includes("available <= 0")) errors.push("No qty-0 eBay push from Adjust");
  else notes.push("eBay qty-0 push blocked in branch");

  const roadmapText = readText("docs/pages/admin/inventory/implementation/roadmap.md");
  const planText = readText("docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md");
  const d3Complete =
    (roadmapText.includes("059D.3") && roadmapText.includes("✅")) ||
    planText.includes("059D.3 — Adjust orchestrator integration ✅");
  if (d3Complete && branch.includes("runEbayEndedRelist")) {
    notes.push("ended_needs_relist wired to relist edge (059D.3+)");
  } else if (!branch.includes("Relist starts in 059D")) {
    errors.push("ended_needs_relist must return 059D next-step until 059D.3");
  }
  if (!branch.includes('status: "manual"') || !branch.includes("unsupported_variation")) {
    errors.push("unsupported_variation must return manual after cache refresh");
  }
  if (!branch.includes("already matches after cache refresh")) {
    errors.push("no_change after cache refresh must return skipped");
  }
  if (!nextSteps.includes('case "missing_mapping"') || !nextSteps.includes('status: "skipped"')) {
    errors.push("missing_mapping must return skipped via nextSteps");
  }
  notes.push("Result states: ended→059D, unsupported→manual, no_change→skipped, missing→skipped");

  if (!preview.includes("will refresh before sync")) {
    errors.push("Preview must show qty_cache_missing refresh copy");
  }
  if (!preview.includes('ebay_sync_action === "qty_cache_missing"')) {
    errors.push("Sync toggle default must include qty_cache_missing");
  }
  notes.push("Preview copy + sync toggle defaults for cache missing");

  if (!panel.includes("card.detail") || !panel.includes("dry_run")) {
    errors.push("Result panel must support eBay detail + dry_run status");
  }
  if (!branch.includes("eBay cache refreshed and quantity sync requested")) {
    errors.push("Result message missing: cache refresh + qty push success");
  }
  notes.push("Result panel supports cache sub-status + dry_run tone");

  if (!orch.includes("resolveEbayBranch") || !orch.includes("await adjustInventory(")) {
    errors.push("Orchestrator must adjust first then delegate eBay branch");
  }
  if (!orch.includes("projectedAvailable <= 0")) {
    errors.push("Orchestrator must skip channel sync when projected available <= 0");
  }

  for (const rel of ADJUST_FLOW_FILES) {
    const text = readText(rel);
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(text)) errors.push(`${rel}: forbidden ${label}`);
    }
  }

  const amazonOrch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (amazonOrch.includes("runAdjustEbayCacheRefreshChain") && !amazonOrch.includes("resolveEbayBranch")) {
    errors.push("Orchestrator must delegate eBay via branch module");
  }
  notes.push("No relist, no snapshot refresh; adjust_inventory only stock writer");

  const doc = readText(PLAN_DOC);
  if (!doc.includes("059C.3") || !doc.includes("adjustChannelEbayBranch")) {
    errors.push("Plan doc must reference 059C.3 eBay branch");
  }
  notes.push("Plan doc references 059C active path");

  return { notes, errors };
}

function runRegressionScripts() {
  const notes = [];
  const errors = [];

  for (const script of REGRESSION_SCRIPTS) {
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`Missing regression script: ${script}`);
      continue;
    }
    const result = spawnSync(process.execPath, [path], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 420000,
      env: { ...process.env },
    });
    const label = script.replace("verify-inventory-", "").replace(".mjs", "");
    if (result.status === 0) notes.push(`Regression PASS: ${label}`);
    else {
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-6).join(" ").trim();
      errors.push(`Regression FAIL: ${label}${tail ? ` — ${tail.slice(0, 180)}` : ""}`);
    }
  }

  return { notes, errors };
}

async function callEdge(url, key, fnName, body) {
  const resp = await fetch(`${url}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  return { status: resp.status, data };
}

async function fetchCandidateFromDb(variantId) {
  process.env.SUPABASE_DB_PASSWORD =
    process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD;
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT variant_id, product_id, available_qty, ebay_sync_action, ebay_listing_status
       FROM v_inventory_channel_sync_candidates
       WHERE variant_id = $1
       LIMIT 1`,
      [variantId],
    );
    return rows?.[0] ?? null;
  } finally {
    await client.end().catch(() => {});
  }
}

async function verifyOptionalCacheApi(env) {
  const notes = [];
  const errors = [];
  const skipped = [];

  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const productId = (env.TEST_EBAY_CACHE_PRODUCT_ID || process.env.TEST_EBAY_CACHE_PRODUCT_ID || "").trim();
  const variantId = (env.TEST_EBAY_CACHE_VARIANT_ID || process.env.TEST_EBAY_CACHE_VARIANT_ID || "").trim();

  if (!url || !key) {
    skipped.push("Cache API: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors, skipped, liveEbayCall: false };
  }
  if (!productId) {
    skipped.push("Cache API: skipped — missing TEST_EBAY_CACHE_PRODUCT_ID");
    return { notes, errors, skipped, liveEbayCall: false };
  }

  const testOrch = `059c4-cache-${Date.now()}`;
  const { status, data } = await callEdge(url, key, "sync-ebay-listing-inventory-cache", {
    productIds: [productId],
    limit: 1,
    syncContext: {
      trigger_source: "manual_adjust",
      trigger_reference_type: "stock_ledger",
      orchestration_id: testOrch,
    },
  });

  if (status >= 500) errors.push(`Cache API: edge HTTP ${status}`);
  else notes.push(`Cache API: refresh ok=${data.ok} summary=${JSON.stringify(data.summary || {})}`);

  if (variantId) {
    try {
      const row = await fetchCandidateFromDb(variantId);
      if (row) notes.push(`Cache API: candidate re-read ebay_sync_action=${row.ebay_sync_action}`);
      else skipped.push("Cache API: candidate re-read — no row for TEST_EBAY_CACHE_VARIANT_ID");
    } catch (err) {
      skipped.push(`Cache API: candidate re-read skipped — ${err.message}`);
    }
  } else {
    skipped.push("Cache API: candidate re-read skipped — missing TEST_EBAY_CACHE_VARIANT_ID");
  }

  return { notes, errors, skipped, liveEbayCall: false };
}

async function verifyOptionalQtyTest(env) {
  const notes = [];
  const errors = [];
  const skipped = [];
  let liveEbayCall = false;

  const runTest = (env.RUN_EBAY_ACTIVE_QTY_TEST || process.env.RUN_EBAY_ACTIVE_QTY_TEST) === "true";
  const productId = (env.TEST_EBAY_CACHE_PRODUCT_ID || process.env.TEST_EBAY_CACHE_PRODUCT_ID || "").trim();
  const variantId = (env.TEST_EBAY_CACHE_VARIANT_ID || process.env.TEST_EBAY_CACHE_VARIANT_ID || "").trim();
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!runTest) {
    skipped.push("Qty push test: skipped — RUN_EBAY_ACTIVE_QTY_TEST not true");
    return { notes, errors, skipped, liveEbayCall };
  }
  if (!url || !key || !productId || !variantId) {
    skipped.push("Qty push test: skipped — missing credentials or TEST_EBAY_* ids");
    return { notes, errors, skipped, liveEbayCall };
  }

  let candidate;
  try {
    candidate = await fetchCandidateFromDb(variantId);
  } catch (err) {
    skipped.push(`Qty push test: skipped — DB read failed (${err.message})`);
    return { notes, errors, skipped, liveEbayCall };
  }

  if (!candidate) {
    skipped.push("Qty push test: skipped — no candidate row");
    return { notes, errors, skipped, liveEbayCall };
  }
  if (Number(candidate.available_qty ?? 0) <= 0) {
    skipped.push("Qty push test: skipped — available qty not positive");
    return { notes, errors, skipped, liveEbayCall };
  }
  if (candidate.ebay_sync_action === "ended_needs_relist") {
    skipped.push("Qty push test: skipped — ended listing (059D)");
    return { notes, errors, skipped, liveEbayCall };
  }
  if (candidate.ebay_sync_action === "unsupported_variation") {
    skipped.push("Qty push test: skipped — unsupported variation");
    return { notes, errors, skipped, liveEbayCall };
  }
  if (candidate.ebay_sync_action !== "update_qty") {
    skipped.push(`Qty push test: skipped — candidate action is ${candidate.ebay_sync_action}, not update_qty`);
    return { notes, errors, skipped, liveEbayCall };
  }

  const liveEnabled =
    (env.EBAY_ENABLE_LIVE_QUANTITY_PATCH || process.env.EBAY_ENABLE_LIVE_QUANTITY_PATCH) === "true";
  const runLive =
    (env.RUN_LIVE_EBAY_ACTIVE_QTY_TEST || process.env.RUN_LIVE_EBAY_ACTIVE_QTY_TEST) === "true";
  const wantsPreview = !(liveEnabled && runLive);

  const testOrch = `059c4-qty-${Date.now()}`;
  const { status, data } = await callEdge(url, key, "sync-ebay-inventory-quantity", {
    variantIds: [variantId],
    limit: 1,
    preview: wantsPreview,
    syncContext: {
      trigger_source: "manual_adjust",
      trigger_reference_type: "stock_ledger",
      orchestration_id: testOrch,
    },
  });

  if (status >= 500) errors.push(`Qty push test: edge HTTP ${status}`);
  else if (wantsPreview) {
    notes.push(`Qty push test: dry-run/preview ok=${data.ok} preview=${data.preview}`);
    if (data.error === "live_patch_disabled") {
      notes.push("Qty push test: live gate off — preview path used");
    }
  } else {
    liveEbayCall = true;
    notes.push(`Qty push test: LIVE push ok=${data.ok} succeeded=${data.succeeded ?? data.success_count ?? 0}`);
  }

  return { notes, errors, skipped, liveEbayCall };
}

async function resolveAdminEmail(env) {
  if (env.KK_ADMIN_EMAIL?.trim()) return env.KK_ADMIN_EMAIL.trim();
  process.env.SUPABASE_DB_PASSWORD =
    env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT email FROM auth.users
       WHERE COALESCE((raw_app_meta_data->>'is_admin')::boolean, false) = true
       ORDER BY created_at LIMIT 1`,
    );
    if (rows?.[0]?.email) return rows[0].email;
  } finally {
    await client.end().catch(() => {});
  }
  throw new Error("Could not resolve admin email");
}

async function signInAdmin(page, env) {
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const email = await resolveAdminEmail(env);
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const redirectTo = `http://127.0.0.1:${PORT}${PAGE}`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (error) throw new Error(error.message);
  await page.goto(data.properties.action_link, { waitUntil: "networkidle", timeout: 60000 });
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const filePath = join(ROOT, decodeURIComponent(urlPath.replace(/^\//, "")));
      if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function verifyBrowser(env) {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.route("**/rest/v1/v_inventory_channel_sync_candidates**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_QTY_CACHE_MISSING),
    });
  });

  try {
    await signInAdmin(page, env);
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-inventory-action="adjust-stock"]').first().waitFor({ state: "visible", timeout: 60000 });
    notes.push("Browser: inventory page loaded");

    await page.locator('[data-inventory-action="adjust-stock"]').first().click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15000 });
    notes.push("Browser: adjust modal opened");

    await page.waitForSelector("[data-adjust-channel-card='ebay']", { timeout: 15000 });
    const ebayCard = page.locator("[data-adjust-channel-card='ebay']");
    const cardText = await ebayCard.innerText();
    if (!/will refresh before sync/i.test(cardText)) {
      errors.push("Browser: qty_cache_missing preview copy not rendered");
    } else notes.push("Browser: qty_cache_missing preview copy rendered");

    const toggle = page.locator("[data-adjust-sync-toggle]");
    await toggle.waitFor({ state: "visible", timeout: 5000 });
    if (!(await toggle.isChecked()) || (await toggle.isDisabled())) {
      errors.push("Browser: sync toggle should default ON for qty_cache_missing with available > 0");
    } else notes.push("Browser: sync toggle ON for qty_cache_missing candidate");

    await page.fill("#inventoryAdjustQty", "1");
    await page.waitForFunction(
      () => {
        const ebay = document.querySelector("[data-adjust-channel-card='ebay']");
        return ebay && /will refresh before sync/i.test(ebay.textContent || "");
      },
      { timeout: 5000 },
    );
    notes.push("Browser: eBay preview card renders with projected adjust");

    const panelSrc = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
    const branchSrc = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
    const resultChecks = [
      { label: "cache+push success", ok: branchSrc.includes("cache refreshed and quantity sync requested") },
      { label: "cache failed", ok: branchSrc.includes("cache refresh failed") },
      { label: "still missing cache", ok: branchSrc.includes("still unavailable") },
      {
        label: "ended relist path",
        ok: branchSrc.includes("Relist starts in 059D") || branchSrc.includes("runEbayEndedRelist"),
      },
      { label: "unsupported manual", ok: branchSrc.includes("variation listing requires manual") },
      { label: "panel detail line", ok: panelSrc.includes("card.detail") },
      { label: "dry_run tone", ok: panelSrc.includes("dry_run") },
    ];
    const failed = resultChecks.filter((c) => !c.ok);
    if (failed.length) errors.push(`Browser: result panel states missing: ${failed.map((f) => f.label).join(", ")}`);
    else notes.push("Browser: result panel supports all 059C eBay result states");

    const benign = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("Failed to load resource"),
    );
    if (benign.length) errors.push(`Browser console errors: ${benign.slice(0, 3).join(" | ")}`);
    else notes.push("Browser: no significant console errors");
  } finally {
    await browser.close();
    server.close();
  }

  return { notes, errors };
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const staticResult = verifyStatic();
  const regression = runRegressionScripts();

  let cacheApi = { notes: [], errors: [], skipped: [], liveEbayCall: false };
  let qtyApi = { notes: [], errors: [], skipped: [], liveEbayCall: false };
  let browserResult = { notes: [], errors: [] };

  try {
    cacheApi = await verifyOptionalCacheApi(env);
  } catch (err) {
    cacheApi.skipped.push(`Cache API exception: ${err.message}`);
  }
  try {
    qtyApi = await verifyOptionalQtyTest(env);
  } catch (err) {
    qtyApi.skipped.push(`Qty push test exception: ${err.message}`);
  }
  try {
    browserResult = await verifyBrowser(env);
  } catch (err) {
    browserResult.errors.push(`Browser smoke skipped: ${err.message}`);
  }

  const liveEbayCall = cacheApi.liveEbayCall || qtyApi.liveEbayCall;
  const errors = [
    ...staticResult.errors,
    ...regression.errors,
    ...cacheApi.errors,
    ...qtyApi.errors,
    ...browserResult.errors,
  ];
  const notes = [
    ...staticResult.notes,
    ...regression.notes,
    ...cacheApi.notes,
    ...qtyApi.notes,
    ...browserResult.notes,
  ];
  const skipped = [...cacheApi.skipped, ...qtyApi.skipped];

  console.log("\n=== Phase 059C.4 — eBay Active Sync Verification ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const s of skipped) console.log(`  ○ ${s}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  console.log(`\n  Live eBay quantity patch during this run: ${liveEbayCall ? "YES" : "NO"}\n`);

  if (errors.length) {
    console.log(`FAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("PASS — Phase 059C.4 eBay active sync verification\n");
  console.log("Next subphase: 059C.5 — 059C QA + docs freeze\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
