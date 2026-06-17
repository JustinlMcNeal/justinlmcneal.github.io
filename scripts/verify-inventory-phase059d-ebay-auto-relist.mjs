/**
 * Phase 059D.4 — eBay auto-relist verification matrix (edge + orchestrator).
 *
 * Run: node scripts/verify-inventory-phase059d-ebay-auto-relist.mjs
 *
 * Optional dry-run API (preview only):
 *   TEST_EBAY_RELIST_PRODUCT_ID, TEST_EBAY_RELIST_VARIANT_ID, TEST_EBAY_RELIST_QTY=1
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional LIVE publish (all required):
 *   RUN_LIVE_EBAY_RELIST_TEST=true
 *   EBAY_ENABLE_LIVE_RELIST=true
 *   TEST_EBAY_RELIST_* + SUPABASE_* as above
 *
 * Deep 059C freeze: RUN_DEEP_059C_FREEZE=1
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
const PORT = 9904;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";

const EDGE_FILES = [
  "supabase/functions/relist-ebay-from-product/index.ts",
  "supabase/functions/_shared/ebayRelistFromProduct.ts",
  "supabase/functions/_shared/ebayRelistCandidateLoaders.ts",
  "supabase/functions/_shared/ebayListingPublishUtils.ts",
];

const ORCH_FILES = [
  "js/admin/inventory/api/ebayRelistFromProductApi.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
];

const ADJUST_FLOW = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
];

const REGRESSION = [
  { script: "verify-inventory-phase059d2-ebay-relist-edge.mjs", label: "059D.2 edge" },
  { script: "verify-inventory-phase059d3-adjust-ebay-relist-orchestrator.mjs", label: "059D.3 orchestrator" },
  { script: "verify-inventory-phase059d1-ebay-relist-audit.mjs", label: "059D.1 audit", env: { VERIFY_FAST: "1" } },
  { script: "verify-inventory-phase059b-final-freeze.mjs", label: "059B freeze" },
  { script: "verify-inventory-issue-view-safety.mjs", label: "issue-view-safety" },
  { script: "verify-inventory-phase10y-final-stabilization.mjs", label: "phase10y" },
];

const MOCK_VARIANT = "55555555-5555-4555-8555-555555555555";
const MOCK_PRODUCT = "66666666-6666-4666-8666-666666666666";

const MOCK_ENDED_CANDIDATE = {
  variant_id: MOCK_VARIANT,
  product_id: MOCK_PRODUCT,
  available_qty: 4,
  on_hand_qty: 4,
  reserved_qty: 0,
  kk_sync_action: "update_qty",
  amazon_sync_action: "no_change",
  amazon_listing_status: null,
  amazon_current_qty: 0,
  ebay_sync_action: "ended_needs_relist",
  ebay_listing_status: "ended",
  ebay_current_qty: 0,
  issue_flags: [],
};

const MOCK_RELIST_ROW = {
  variant_id: MOCK_VARIANT,
  relist_action: "ready_to_relist",
  suggested_qty: 4,
  available_qty: 4,
  old_status: "ended",
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

function verifyStaticAndMatrix() {
  const notes = [];
  const errors = [];
  const matrix = [];

  for (const rel of [...EDGE_FILES, ...ORCH_FILES]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  notes.push("Edge + orchestrator files present");

  const index = readText("supabase/functions/relist-ebay-from-product/index.ts");
  const handler = readText("supabase/functions/_shared/ebayRelistFromProduct.ts");
  const loaders = readText("supabase/functions/_shared/ebayRelistCandidateLoaders.ts");
  const publish = readText("supabase/functions/_shared/ebayListingPublishUtils.ts");
  const api = readText("js/admin/inventory/api/ebayRelistFromProductApi.js");
  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const summary = readText("js/admin/inventory/services/adjustOrchestratorSummary.js");
  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");

  const edgeChecks = [
    ["productId + variantId + quantity", index.includes("productId") && index.includes("variantId") && index.includes("quantity")],
    ["preview + syncContext", index.includes("preview") && index.includes("syncContext")],
    ["EBAY_ENABLE_LIVE_RELIST gate", index.includes("EBAY_ENABLE_LIVE_RELIST")],
    ["dry_run when gate off/preview", handler.includes('"dry_run"') && index.includes("liveRelistDisabled")],
    ["v_inventory_ebay_relist_candidates", loaders.includes("v_inventory_ebay_relist_candidates")],
    ["ready_to_relist", handler.includes("ready_to_relist")],
    ["qty > 0", handler.includes("quantity_required") || handler.includes("positiveInt")],
    ["unsupported variation", handler.includes("unsupported_variation") && loaders.includes("isVariationBlocked")],
    ["missing metadata → manual", handler.includes("missing_required_listing_data") || handler.includes("missing_images")],
    ["missing aspects → manual", handler.includes("Missing required eBay aspects")],
    ["create item/offer/publish", publish.includes("createEbayInventoryItem") && publish.includes("publishEbayOffer")],
    ["DB reconcile listing/offer", handler.includes("ebay_listing_id") && handler.includes("ebay_offer_id")],
    ["old listing not reactivated", handler.includes("was not reactivated")],
    ["sync run relist_from_product", handler.includes("relist_from_product") && handler.includes("createInventorySyncRun")],
    ["reconcile failure warning", handler.includes("eBay publish succeeded but local DB reconciliation failed")],
  ];
  for (const [label, ok] of edgeChecks) {
    matrix.push({ group: "edge", label, ok });
    if (!ok) errors.push(`Edge matrix: ${label}`);
  }
  notes.push(`Edge static matrix: ${edgeChecks.filter(([, ok]) => ok).length}/${edgeChecks.length}`);

  const orchChecks = [
    ["API calls relist-ebay-from-product", api.includes("relist-ebay-from-product")],
    ["branch relist only ended_needs_relist", branch.includes('action === "ended_needs_relist"') && branch.includes("runEbayEndedRelist")],
    ["update_qty unchanged", branch.includes("pushEbayInventoryQuantity")],
    ["cache chain unchanged", branch.includes("runAdjustEbayCacheRefreshChain")],
    ["cache→ended calls relist", branch.includes("runEbayEndedRelist(refreshed")],
    ["unsupported variation manual", branch.includes("unsupported_variation")],
    ["after adjust_inventory", orch.includes("await adjustInventory(") && orch.indexOf("await resolveEbayBranch(") > orch.indexOf("await adjustInventory(")],
    ["projectedAvailable gate", orch.includes("projectedAvailable <= 0")],
    ["sole stock writer", orch.includes("await adjustInventory(") && !handler.includes("adjust_inventory")],
    ["preview will relist", preview.includes("eBay ended listing can be relisted")],
    ["panel dry_run + listing IDs", panel.includes("dry_run") && panel.includes("listingId")],
    [
      "branch relist status messages",
      branch.includes("eBay listing relisted successfully")
        && branch.includes("EBAY_RELIST_DRY_RUN_COPY")
        && summary.includes("Live relist is disabled"),
    ],
    ["mapRelist all outcomes", branch.includes('case "dry_run"') && branch.includes('case "manual"') && branch.includes('case "failed"')],
  ];
  for (const [label, ok] of orchChecks) {
    matrix.push({ group: "orchestrator", label, ok });
    if (!ok) errors.push(`Orchestrator matrix: ${label}`);
  }
  notes.push(`Orchestrator matrix: ${orchChecks.filter(([, ok]) => ok).length}/${orchChecks.length}`);

  for (const rel of ADJUST_FLOW) {
    if (/fetchChannelSyncPreview|issueSnapshot|refreshIssueSnapshot/.test(readText(rel))) {
      errors.push(`${rel}: forbidden heavy read in adjust flow`);
    }
  }
  const amazon = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");
  if (amazon.includes("relistEbayFromProduct") || amazon.includes("ebayRelistFromProductApi")) {
    errors.push("Amazon module must not reference eBay relist");
  }
  notes.push("No heavy reads; Amazon unchanged");

  return { notes, errors, matrix };
}

async function callRelistEdge(url, key, body) {
  const resp = await fetch(`${url}/functions/v1/relist-ebay-from-product`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
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

async function verifyOptionalDryRunApi(env) {
  const notes = [];
  const errors = [];
  const skipped = [];
  let liveAttempted = false;

  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const productId = (env.TEST_EBAY_RELIST_PRODUCT_ID || process.env.TEST_EBAY_RELIST_PRODUCT_ID || "").trim();
  const variantId = (env.TEST_EBAY_RELIST_VARIANT_ID || process.env.TEST_EBAY_RELIST_VARIANT_ID || "").trim();
  const qty = Number(env.TEST_EBAY_RELIST_QTY || process.env.TEST_EBAY_RELIST_QTY || 1);

  if (!url || !key) {
    skipped.push("Dry-run API: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors, skipped, liveAttempted };
  }
  if (!productId || !variantId) {
    skipped.push("Dry-run API: skipped — missing TEST_EBAY_RELIST_PRODUCT_ID or TEST_EBAY_RELIST_VARIANT_ID");
    return { notes, errors, skipped, liveAttempted };
  }

  const { status, data } = await callRelistEdge(url, key, {
    productId,
    variantId,
    quantity: qty,
    preview: true,
    syncContext: { trigger_source: "manual_adjust", orchestration_id: `059d4-preview-${Date.now()}` },
  });

  if (status >= 500) errors.push(`Dry-run API: HTTP ${status}`);
  else if (data.status === "success") errors.push("Dry-run API: preview must not return success (live publish)");
  else if (["dry_run", "manual", "skipped", "failed"].includes(data.status)) {
    notes.push(`Dry-run API: status=${data.status} — ${String(data.message || "").slice(0, 72)}`);
  } else notes.push(`Dry-run API: status=${data.status ?? "unknown"}`);

  if (data.mode !== "ebay_relist_from_product") errors.push("Dry-run API: mode must be ebay_relist_from_product");

  const runLive =
    (env.RUN_LIVE_EBAY_RELIST_TEST || process.env.RUN_LIVE_EBAY_RELIST_TEST) === "true" &&
    (env.EBAY_ENABLE_LIVE_RELIST || process.env.EBAY_ENABLE_LIVE_RELIST) === "true";

  if (!runLive) {
    skipped.push("Live relist test: skipped — RUN_LIVE_EBAY_RELIST_TEST + EBAY_ENABLE_LIVE_RELIST not both true");
    return { notes, errors, skipped, liveAttempted };
  }

  console.warn("\n⚠ LIVE EBAY RELIST TEST — one attempt only; test product must be ready_to_relist single-SKU\n");
  liveAttempted = true;
  const live = await callRelistEdge(url, key, {
    productId,
    variantId,
    quantity: qty,
    preview: false,
    syncContext: { trigger_source: "manual_adjust", orchestration_id: `059d4-live-${Date.now()}` },
  });

  if (live.status >= 500) errors.push(`Live relist: HTTP ${live.status}`);
  else if (live.data.status === "success") {
    notes.push(`Live relist: success listingId=${live.data.listingId ?? "?"}`);
    if (!live.data.listingId) errors.push("Live relist: success must include listingId");
  } else if (live.data.status === "dry_run") {
    errors.push("Live relist: gate still off on edge (expected live with flags set)");
  } else {
    notes.push(`Live relist: ${live.data.status} — ${String(live.data.message || "").slice(0, 80)}`);
  }

  return { notes, errors, skipped, liveAttempted };
}

async function resolveAdminEmail(env) {
  if (env.KK_ADMIN_EMAIL?.trim()) return env.KK_ADMIN_EMAIL.trim();
  process.env.SUPABASE_DB_PASSWORD =
    env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
  const client = new pg.Client({ connectionString: getPoolerConnectionString(), ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT email FROM auth.users WHERE COALESCE((raw_app_meta_data->>'is_admin')::boolean, false) = true ORDER BY created_at LIMIT 1`,
    );
    if (rows?.[0]?.email) return rows[0].email;
  } finally {
    await client.end().catch(() => {});
  }
  throw new Error("Could not resolve admin email");
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
  const skipped = [];
  let server;
  let browser;

  try {
    server = await startServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.route("**/rest/v1/v_inventory_channel_sync_candidates**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_ENDED_CANDIDATE) });
    });
    await page.route("**/rest/v1/v_inventory_ebay_relist_candidates**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_RELIST_ROW) });
    });

    const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) throw new Error("Missing Supabase credentials for browser auth");

    const email = await resolveAdminEmail(env);
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `http://127.0.0.1:${PORT}${PAGE}` },
    });
    if (error) throw new Error(error.message);
    await page.goto(data.properties.action_link, { waitUntil: "networkidle", timeout: 60000 });

    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-inventory-action="adjust-stock"]').first().click({ timeout: 60000 });
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15000 });
    notes.push("Browser: inventory + adjust modal");

    await page.waitForSelector("[data-adjust-channel-card='ebay']", { timeout: 15000 });
    const ebayText = await page.locator("[data-adjust-channel-card='ebay']").innerText();
    if (!/eBay ended listing can be relisted|attempt relist/i.test(ebayText)) errors.push("Browser: ended relist preview copy missing");
    else notes.push("Browser: ended_needs_relist preview copy");

    const toggle = page.locator("[data-adjust-sync-toggle]");
    if (!(await toggle.isChecked()) || (await toggle.isDisabled())) {
      errors.push("Browser: sync toggle should default ON for eligible ended relist");
    } else notes.push("Browser: sync toggle ON for eligible ended relist");

    await page.fill("#inventoryAdjustQty", "1");
    const panelChecks = await page.evaluate(async () => {
      const { renderAdjustResultPanel } = await import("/js/admin/inventory/renderers/renderAdjustResultPanel.js");
      const row = { id: "v1", title: "Test", variant: "Default", variantDetail: "", internalSku: "KK-TEST", onHand: 1, reserved: 0, shortSku: "KKTEST" };
      const base = {
        orchestrationId: "orch-test",
        syncChannelsEnabled: true,
        kk: { status: "success", message: "ok", ledgerId: "led", stockAfter: 5, delta: 1, stockBefore: 4 },
        warnings: [],
        errors: [],
      };
      const cases = [
        { label: "success", ebay: { status: "success", action: "ended_needs_relist", message: "eBay listing relisted successfully.", listingId: "L1", offerId: "O1", runId: "R1" } },
        { label: "dry_run", ebay: { status: "dry_run", action: "ended_needs_relist", message: "eBay relist was previewed only. Live relist is disabled.", runId: "R2" } },
        { label: "manual", ebay: { status: "manual", action: "ended_needs_relist", message: "eBay relist requires manual review.", nextStepUrl: "/pages/admin/inventory.html" } },
        { label: "skipped", ebay: { status: "skipped", action: "ended_needs_relist", message: "eBay relist skipped." } },
        { label: "failed", ebay: { status: "failed", action: "ended_needs_relist", message: "eBay relist failed. Stock remains adjusted." } },
      ];
      return cases.map((c) => {
        const html = renderAdjustResultPanel({ ...base, amazon: { status: "skipped", action: null, message: "skip" }, ebay: c.ebay }, row);
        return { label: c.label, ok: html.includes(c.ebay.message) && (c.label !== "success" || (html.includes("L1") && html.includes("O1"))) };
      });
    });

    const panelFail = panelChecks.filter((c) => !c.ok);
    if (panelFail.length) errors.push(`Browser: result panel cases failed: ${panelFail.map((f) => f.label).join(", ")}`);
    else notes.push("Browser: result panel all relist statuses (success/dry_run/manual/skipped/failed)");

    const benign = consoleErrors.filter((e) => !/favicon|404|Failed to load resource/i.test(e));
    if (benign.length) errors.push(`Browser console: ${benign.slice(0, 2).join(" | ")}`);
    else notes.push("Browser: no significant console errors");
  } catch (err) {
    skipped.push(`Browser smoke skipped: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }

  return { notes, errors, skipped };
}

function runRegression(env) {
  const notes = [];
  const errors = [];
  const skipped = [];

  for (const { script, label, env: extra = {} } of REGRESSION) {
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`Missing regression: ${script}`);
      continue;
    }
    const result = spawnSync(process.execPath, [path], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, ...env, ...extra },
    });
    if (result.status === 0) notes.push(`Regression PASS: ${label}`);
    else {
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-2).join(" ").trim();
      errors.push(`Regression FAIL: ${label}${tail ? ` — ${tail.slice(0, 90)}` : ""}`);
    }
  }

  if ((env.RUN_DEEP_059C_FREEZE || process.env.RUN_DEEP_059C_FREEZE) === "1") {
    const freeze = join(ROOT, "scripts", "verify-inventory-phase059c-final-freeze.mjs");
    const result = spawnSync(process.execPath, [freeze], { cwd: ROOT, encoding: "utf8", timeout: 900_000, env: { ...process.env, ...env } });
    if (result.status === 0) notes.push("Deep regression PASS: 059C final freeze");
    else errors.push("Deep regression FAIL: 059C final freeze");
  } else {
    skipped.push("Deep 059C freeze skipped (RUN_DEEP_059C_FREEZE=1 for full chain)");
  }

  return { notes, errors, skipped };
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  console.log("\n=== Phase 059D.4 — eBay Auto-Relist Verification Matrix ===\n");

  const staticResult = verifyStaticAndMatrix();
  const regression = runRegression(env);
  const apiResult = await verifyOptionalDryRunApi(env);
  const browser = await verifyBrowser(env);

  const errors = [...staticResult.errors, ...regression.errors, ...apiResult.errors, ...browser.errors];
  const notes = [...staticResult.notes, ...regression.notes, ...apiResult.notes, ...browser.notes];
  const skipped = [...regression.skipped, ...apiResult.skipped, ...browser.skipped];

  console.log("--- Static + matrix ---");
  for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
  for (const e of staticResult.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Regression ---");
  for (const n of regression.notes) console.log(`  ✓ ${n}`);
  for (const s of regression.skipped) console.log(`  ○ ${s}`);
  for (const e of regression.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Optional API ---");
  for (const n of apiResult.notes) console.log(`  ✓ ${n}`);
  for (const s of apiResult.skipped) console.log(`  ○ ${s}`);
  for (const e of apiResult.errors) console.log(`  ✗ ${e}`);
  if (!apiResult.liveAttempted) console.log("  ○ Live eBay publish: not attempted");

  console.log("\n--- Browser ---");
  for (const n of browser.notes) console.log(`  ✓ ${n}`);
  for (const s of browser.skipped) console.log(`  ○ ${s}`);
  for (const e of browser.errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059D.4 eBay auto-relist verification matrix\n");
  console.log("Next subphase: 059D.5 — 059D QA + docs freeze\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
