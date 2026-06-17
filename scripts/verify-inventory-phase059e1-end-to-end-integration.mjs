/**
 * Phase 059E.1 — End-to-end Adjust → Unified Channel Restock integration pass.
 *
 * Run:
 *   node scripts/verify-inventory-phase059e1-end-to-end-integration.mjs
 *   node scripts/verify-inventory-phase059e1-end-to-end-integration.mjs --static
 *   node scripts/verify-inventory-phase059e1-end-to-end-integration.mjs --browser
 *
 * Deep frozen regressions: RUN_DEEP_059E_REGRESSION=1 (spawns full 059A/059B/059D freeze scripts)
 * Deep 059C: RUN_DEEP_059C_FREEZE=1
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
const PORT = 9905;
const PAGE = "/pages/admin/inventory.html";
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const SCENARIO_TIMEOUT_MS = 30_000;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const ROUTE_PATTERNS = [
  "**/rest/v1/rpc/adjust_inventory**",
  "**/rest/v1/v_inventory_channel_sync_candidates**",
  "**/rest/v1/v_inventory_ebay_relist_candidates**",
  "**/functions/v1/sync-amazon-inventory-quantity**",
  "**/functions/v1/sync-ebay-inventory-quantity**",
  "**/functions/v1/sync-ebay-listing-inventory-cache**",
  "**/functions/v1/relist-ebay-from-product**",
  "**/rest/v1/**",
  "**/functions/v1/**",
];

const SKIPPED_EDGE = { ok: false, status: "skipped", message: "Unmocked edge — scenario stub" };

const ADJUST_FLOW = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayCache.js",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const staticOnly = args.includes("--static");
  const browserOnly = args.includes("--browser");
  return {
    runStatic: staticOnly || !browserOnly,
    runBrowser: browserOnly || !staticOnly,
    runRegression: !staticOnly,
  };
}

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

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

function spawnScript(script, timeout, extraEnv = {}) {
  const path = join(ROOT, "scripts", script);
  if (!existsSync(path)) return { ok: false, detail: "missing" };
  const result = spawnSync(process.execPath, [path], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status === 0) return { ok: true };
  const tail = (result.stdout || result.stderr || "").split("\n").slice(-2).join(" ").trim();
  return { ok: false, detail: tail.slice(0, 100) };
}

function verifyStaticMatrix() {
  const notes = [];
  const errors = [];
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const amazonApi = readText("js/admin/inventory/api/amazonSyncPushApi.js");
  const ebayPush = readText("js/admin/inventory/api/ebaySyncPushApi.js");
  const ebayCache = readText("js/admin/inventory/api/ebayCacheRefreshApi.js");
  const ebayRelist = readText("js/admin/inventory/api/ebayRelistFromProductApi.js");
  const ebayBranch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const ebayCacheSvc = readText("js/admin/inventory/services/adjustChannelEbayCache.js");
  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  const syncCtx = readText("js/admin/inventory/services/adjustSyncContext.js");
  const summary = readText("js/admin/inventory/services/adjustOrchestratorSummary.js");
  const orchBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));

  const scenarios = [
    ["S1 KK only (sync off)", orchBody.includes("syncChannelsEnabled") && orchBody.includes("Sync channels after adjust is off")],
    ["S2 Amazon active update_qty", orch.includes("runAmazonUpdateQty") && amazonApi.includes("syncContext")],
    ["S3 Amazon inactive_restock", orch.includes('mode: "inactive_restock"') && orch.includes('"dry_run"')],
    ["S4 eBay update_qty", ebayBranch.includes("pushEbayInventoryQuantity") && ebayPush.includes("syncContext")],
    ["S5 eBay cache chain", ebayBranch.includes("runAdjustEbayCacheRefreshChain") && ebayCacheSvc.includes("fetchChannelSyncCandidateForVariant")],
    ["S6 eBay ended relist", ebayBranch.includes("runEbayEndedRelist") && ebayRelist.includes("relist-ebay-from-product")],
    ["S7 unsupported manual", ebayBranch.includes("unsupported_variation")],
    ["S8 partial failure copy", summary.includes("Stock remains adjusted") && panel.includes("ADJUST_PARTIAL_CHANNEL_FAILURE_COPY")],
  ];
  for (const [label, ok] of scenarios) if (!ok) errors.push(`Static matrix: ${label}`);
  notes.push(`Scenario matrix static: ${scenarios.filter(([, ok]) => ok).length}/${scenarios.length}`);

  const audit = [
    ["orchestrationId", orchBody.includes("orchestrationId")],
    ["buildAdjustSyncContext", orch.includes("buildAdjustSyncContext")],
    ["syncContext fields", syncCtx.includes("stock_ledger_id") && syncCtx.includes("orchestration_id")],
    ["Amazon syncContext", amazonApi.includes("syncContext")],
    ["eBay cache syncContext", ebayCache.includes("syncContext")],
    ["eBay relist syncContext", ebayRelist.includes("syncContext")],
    ["panel orchestration meta", panel.includes("orchestrationId") && panel.includes("ledgerId")],
  ];
  for (const [label, ok] of audit) if (!ok) errors.push(`Audit: ${label}`);
  notes.push(`Audit/correlation static: ${audit.filter(([, ok]) => ok).length}/${audit.length}`);

  for (const rel of ADJUST_FLOW) {
    if (/fetchChannelSyncPreview|issueSnapshot|refreshIssueSnapshot/.test(readText(rel))) {
      errors.push(`${rel}: forbidden heavy read`);
    }
  }
  if (!orchBody.includes("await adjustInventory(")) errors.push("adjust_inventory must be sole stock writer entry");
  notes.push("Pool-safety static: no heavy reads; adjust_inventory only writer");

  if (!readText(PLAN_DOC).includes("verify-inventory-phase059e1-end-to-end-integration.mjs")) {
    errors.push("Plan doc must reference 059E.1 verify script");
  }

  return { notes, errors };
}

function runFastBoundaryRegressions(env) {
  const notes = [];
  const errors = [];
  const skipped = [];

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  const amazonInactive = readText("supabase/functions/_shared/inventoryAmazonInactiveRestock.ts");

  if (!orch.includes("runAdjustChannelOrchestration") || !orch.includes("resolveEbayBranch")) {
    errors.push("059A boundary: orchestrator shell");
  } else notes.push("059A fast boundary PASS");

  if (!orch.includes('mode: "inactive_restock"')) errors.push("059B boundary: inactive restock");
  else notes.push("059B fast boundary PASS");

  if (!branch.includes("pushEbayInventoryQuantity") || !branch.includes("runAdjustEbayCacheRefreshChain")) {
    errors.push("059C boundary: eBay active/cache paths");
  } else notes.push("059C fast boundary PASS");

  if (!branch.includes("runEbayEndedRelist")) errors.push("059D boundary: relist wiring");
  else notes.push("059D fast boundary PASS");

  if (amazonInactive.includes("relistEbayFromProduct")) errors.push("Amazon must not reference eBay relist");
  else notes.push("Amazon unchanged by 059D");

  const deep = env.RUN_DEEP_059E_REGRESSION === "1" || process.env.RUN_DEEP_059E_REGRESSION === "1";
  if (deep) {
    for (const { script, label, timeout, env: extra = {} } of [
      { script: "verify-inventory-phase059a-adjust-orchestration.mjs", label: "059A deep", timeout: 180_000 },
      { script: "verify-inventory-phase059b-final-freeze.mjs", label: "059B deep", timeout: 180_000 },
      { script: "verify-inventory-phase059d-final-freeze.mjs", label: "059D deep", timeout: 600_000 },
    ]) {
      const r = spawnScript(script, timeout, extra);
      if (r.ok) notes.push(`Deep regression PASS: ${label}`);
      else errors.push(`Deep regression FAIL: ${label}${r.detail ? ` — ${r.detail}` : ""}`);
    }
  } else {
    skipped.push("Deep 059A/059B/059D regressions skipped (RUN_DEEP_059E_REGRESSION=1)");
  }

  if (env.RUN_DEEP_059C_FREEZE === "1" || process.env.RUN_DEEP_059C_FREEZE === "1") {
    const r = spawnScript("verify-inventory-phase059c-final-freeze.mjs", 900_000);
    if (r.ok) notes.push("Deep regression PASS: 059C freeze");
    else errors.push(`Deep regression FAIL: 059C freeze${r.detail ? ` — ${r.detail}` : ""}`);
  } else {
    skipped.push("Deep 059C freeze skipped (RUN_DEEP_059C_FREEZE=1)");
  }

  for (const script of ["verify-inventory-issue-view-safety.mjs", "verify-inventory-phase10y-final-stabilization.mjs"]) {
    const r = spawnScript(script, 120_000);
    if (r.ok) notes.push(`Regression PASS: ${script.replace("verify-inventory-", "").replace(".mjs", "")}`);
    else errors.push(`Regression FAIL: ${script}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  return { notes, errors, skipped };
}

async function resolveAdminEmail(env) {
  if (env.KK_ADMIN_EMAIL?.trim()) return env.KK_ADMIN_EMAIL.trim();
  process.env.SUPABASE_DB_PASSWORD = env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
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

function baseCandidate(variantId, productId, amazon, ebay, avail = 6) {
  return {
    variant_id: variantId,
    product_id: productId,
    available_qty: avail,
    on_hand_qty: avail,
    reserved_qty: 0,
    kk_sync_action: "update_qty",
    amazon_sync_action: amazon,
    amazon_listing_status: amazon === "inactive_can_update" ? "inactive" : "active",
    amazon_current_qty: 0,
    ebay_sync_action: ebay,
    ebay_listing_status: ebay === "ended_needs_relist" ? "ended" : "active",
    ebay_current_qty: ebay === "update_qty" ? 2 : null,
    issue_flags: [],
  };
}

async function unrouteOwned(page) {
  for (const pattern of ROUTE_PATTERNS) {
    await page.unroute(pattern).catch(() => {});
  }
}

async function wirePreviewRoutes(page, cfg) {
  await page.route("**/rest/v1/v_inventory_channel_sync_candidates**", async (route) => {
    cfg._candN = (cfg._candN ?? 0) + 1;
    const row = typeof cfg.candidate === "function" ? cfg.candidate(cfg._candN) : cfg.candidate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row) });
  });

  await page.route("**/rest/v1/v_inventory_ebay_relist_candidates**", async (route) => {
    const body = cfg.relistRow ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function wireSubmitRoutes(page, cfg) {
  const calls = cfg.calls;

  // Lowest priority — fast empty reads after adjust (loadLiveData).
  await page.route("**/rest/v1/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.route("**/functions/v1/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SKIPPED_EDGE),
    });
  });

  await page.route("**/rest/v1/rpc/adjust_inventory**", async (route) => {
    calls.push("adjust_inventory");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        variant_id: cfg.variantId,
        product_id: cfg.productId,
        delta: 1,
        stock_before: 5,
        stock_after: 6,
        ledger_id: cfg.ledgerId,
        created_at: new Date().toISOString(),
        idempotent_replay: false,
      }),
    });
  });

  await page.route("**/rest/v1/v_inventory_channel_sync_candidates**", async (route) => {
    let candN = cfg._candN ?? 0;
    candN += 1;
    cfg._candN = candN;
    const row = typeof cfg.candidate === "function" ? cfg.candidate(candN) : cfg.candidate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row) });
  });

  await page.route("**/rest/v1/v_inventory_ebay_relist_candidates**", async (route) => {
    const body = cfg.relistRow ?? null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.route("**/functions/v1/sync-amazon-inventory-quantity**", async (route) => {
    calls.push("amazon_qty");
    await route.fulfill({
      status: cfg.amazonHttp ?? 200,
      contentType: "application/json",
      body: JSON.stringify(cfg.amazonEdge ?? { ok: true, succeeded: 1, runId: "amz-run" }),
    });
  });

  await page.route("**/functions/v1/sync-ebay-inventory-quantity**", async (route) => {
    calls.push("ebay_qty");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(cfg.ebayEdge ?? { ok: true, succeeded: 1, runId: "ebay-run" }),
    });
  });

  await page.route("**/functions/v1/sync-ebay-listing-inventory-cache**", async (route) => {
    calls.push("ebay_cache");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        runId: "cache-run",
        summary: { succeeded: 1, failed: 0, skipped: 0 },
        results: [{ productId: cfg.productId, status: "success", rows: 1 }],
      }),
    });
  });

  await page.route("**/functions/v1/relist-ebay-from-product**", async (route) => {
    calls.push("ebay_relist");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        cfg.relistEdge ?? {
          ok: true,
          status: "dry_run",
          mode: "ebay_relist_from_product",
          message: "Preview mode — no eBay publish.",
        },
      ),
    });
  });
}

async function submitAdjust(page, syncOn, routeCfg) {
  const toggle = page.locator("[data-adjust-sync-toggle]");
  if (await toggle.isEnabled()) await toggle.setChecked(syncOn);
  await page.fill("#inventoryAdjustQty", "1");
  await page.selectOption("#inventoryAdjustReason", "count_correction");
  await page.fill("#inventoryAdjustNote", "059E.1 integration scenario");
  routeCfg._candN = 0;
  await wireSubmitRoutes(page, routeCfg);
  await page.click("[data-adjust-submit]");
  await page.waitForSelector("[data-adjust-result-panel]", { timeout: 20_000 });
}

async function runOneScenario(page, sc, ctx, pageUrl) {
  const calls = [];
  const routeCfg = { ...sc, ...ctx, calls, _candN: 0 };
  await unrouteOwned(page);
  await wirePreviewRoutes(page, routeCfg);

  if (await page.locator("[data-adjust-result-panel]").count()) {
    await page.click("[data-adjust-result-done]").catch(() => {});
    await page.waitForTimeout(200);
  }

  const adjustBtn = page.locator('[data-inventory-action="adjust-stock"]').first();
  await adjustBtn.click({ timeout: 15_000 });
  await page.waitForSelector("#inventoryAdjustForm", { timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const body = document.querySelector("[data-adjust-channel-body]");
      return body && !body.querySelector("[data-adjust-channel-loading]");
    },
    { timeout: 15_000 },
  );

  await submitAdjust(page, sc.syncOn, routeCfg);
  await sc.assert(calls);
  await page.click("[data-adjust-result-done]");
  await page.waitForSelector("[data-adjust-result-panel]", { state: "hidden", timeout: 5000 }).catch(() => {});

  // Post-submit rest stubs return [] and wipe workspace rows — reload before next scenario.
  await unrouteOwned(page);
  await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator('[data-inventory-action="adjust-stock"]').first().waitFor({ state: "visible", timeout: 60_000 });
}

async function verifyBrowserScenarios(env) {
  const notes = [];
  const errors = [];
  const skipped = [];
  let server;
  let browser;

  const scenarios = [];

  try {
    server = await startServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase credentials");

    const email = await resolveAdminEmail(env);
    const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `http://127.0.0.1:${PORT}${PAGE}` },
    });
    if (error) throw new Error(error.message);
    await page.goto(data.properties.action_link, { waitUntil: "networkidle", timeout: 60_000 });
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: "networkidle", timeout: 60_000 });

    const adjustBtn = page.locator('[data-inventory-action="adjust-stock"]').first();
    await adjustBtn.waitFor({ state: "visible", timeout: 60_000 });
    const variantId = await adjustBtn.getAttribute("data-row-id");
    const productId = "22222222-2222-4222-8222-222222222222";
    const ledgerId = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
    if (!variantId) throw new Error("No adjust-stock row");
    notes.push("Browser: inventory loaded + variant resolved");

    scenarios.push(
      {
        id: 1,
        name: "KK only",
        syncOn: false,
        candidate: baseCandidate(variantId, productId, "no_change", "no_change"),
        assert: async (calls) => {
          if (calls.includes("amazon_qty") || calls.includes("ebay_qty")) throw new Error("channel called with sync off");
          const amz = await page.locator('[data-adjust-result-card="amazon"]').innerText();
          if (!/skipped|not requested|sync.*off|after adjust is off/i.test(amz)) throw new Error("Amazon not skipped");
        },
      },
      {
        id: 2,
        name: "Amazon active",
        syncOn: true,
        candidate: baseCandidate(variantId, productId, "update_qty", "no_change"),
        assert: async (calls) => {
          if (!calls.includes("amazon_qty")) throw new Error("Amazon push not called");
        },
      },
      {
        id: 3,
        name: "Amazon inactive",
        syncOn: true,
        candidate: baseCandidate(variantId, productId, "inactive_can_update", "no_change"),
        amazonEdge: { ok: true, results: [{ status: "dry_run" }], summary: { succeeded: 0 }, runId: "amz-dry" },
        assert: async (calls) => {
          if (!calls.includes("amazon_qty")) throw new Error("Amazon inactive not called");
        },
      },
      {
        id: 4,
        name: "eBay active",
        syncOn: true,
        candidate: baseCandidate(variantId, productId, "no_change", "update_qty"),
        assert: async (calls) => {
          if (!calls.includes("ebay_qty")) throw new Error("eBay qty not called");
        },
      },
      {
        id: 5,
        name: "eBay cache missing",
        syncOn: true,
        candidate: (n) =>
          n === 1
            ? baseCandidate(variantId, productId, "no_change", "qty_cache_missing")
            : baseCandidate(variantId, productId, "no_change", "update_qty"),
        assert: async (calls) => {
          if (!calls.includes("ebay_cache")) throw new Error("cache refresh not called");
          if (!calls.includes("ebay_qty")) throw new Error("qty push after refresh not called");
        },
      },
      {
        id: 6,
        name: "eBay ended relist",
        syncOn: true,
        candidate: baseCandidate(variantId, productId, "no_change", "ended_needs_relist"),
        relistRow: { variant_id: variantId, relist_action: "ready_to_relist", available_qty: 6, suggested_qty: 6, old_status: "ended" },
        relistEdge: { ok: true, status: "dry_run", mode: "ebay_relist_from_product", message: "Preview mode" },
        assert: async (calls) => {
          if (!calls.includes("ebay_relist")) throw new Error("relist edge not called");
        },
      },
      {
        id: 7,
        name: "eBay unsupported",
        syncOn: true,
        candidate: baseCandidate(variantId, productId, "no_change", "unsupported_variation"),
        assert: async (calls) => {
          if (calls.includes("ebay_relist") || calls.includes("ebay_qty")) throw new Error("should not push/relist");
        },
      },
      {
        id: 8,
        name: "Channel failure",
        syncOn: true,
        candidate: baseCandidate(variantId, productId, "update_qty", "no_change"),
        amazonEdge: { ok: false, message: "Simulated failure" },
        amazonHttp: 502,
        assert: async () => {
          const kk = await page.locator('[data-adjust-result-card="kk"]').innerText();
          const partial = await page.locator("[data-adjust-result-partial]").count();
          if (!/success|adjusted/i.test(kk)) throw new Error("KK should succeed");
          if (!partial) throw new Error("partial failure banner expected");
        },
      },
    );

    const ctx = { variantId, productId, ledgerId };
    const pageUrl = `http://127.0.0.1:${PORT}${PAGE}`;
    for (const sc of scenarios) {
      console.log(`Running scenario: ${sc.name}`);
      try {
        await Promise.race([
          runOneScenario(page, sc, ctx, pageUrl),
          timeoutAfter(SCENARIO_TIMEOUT_MS, `Scenario timed out: ${sc.name}`),
        ]);
        notes.push(`Browser scenario ${sc.id} (${sc.name}): PASS`);
      } catch (err) {
        errors.push(`Browser scenario ${sc.id} (${sc.name}): ${err.message}`);
        break;
      }
    }

    const benign = consoleErrors.filter(
      (e) => !/favicon|404|Failed to load resource|\[adminNav\]/i.test(e),
    );
    if (benign.length) errors.push(`Browser console: ${benign.slice(0, 2).join(" | ")}`);
    else if (!errors.length) notes.push("Browser: no significant console errors");
  } catch (err) {
    skipped.push(`Browser setup: ${err.message}`);
    errors.push(`Browser: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }

  return { notes, errors, skipped };
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }
  const flags = parseArgs();

  console.log("\n=== Phase 059E.1 — End-to-End Integration Pass ===\n");
  if (flags.runStatic && !flags.runBrowser) console.log("Mode: --static only\n");
  if (flags.runBrowser && !flags.runStatic) console.log("Mode: --browser only\n");

  const errors = [];
  const notes = [];
  const skipped = [];

  if (flags.runStatic) {
    const staticResult = verifyStaticMatrix();
    notes.push(...staticResult.notes);
    errors.push(...staticResult.errors);
    console.log("--- Static + audit ---");
    for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
    for (const e of staticResult.errors) console.log(`  ✗ ${e}`);
  }

  if (flags.runRegression) {
    const regression = runFastBoundaryRegressions(env);
    notes.push(...regression.notes);
    errors.push(...regression.errors);
    skipped.push(...regression.skipped);
    console.log("\n--- Fast boundary regression ---");
    for (const n of regression.notes) console.log(`  ✓ ${n}`);
    for (const s of regression.skipped) console.log(`  ○ ${s}`);
    for (const e of regression.errors) console.log(`  ✗ ${e}`);
  }

  if (flags.runBrowser) {
    const browser = await verifyBrowserScenarios(env);
    notes.push(...browser.notes);
    errors.push(...browser.errors);
    skipped.push(...browser.skipped);
    console.log("\n--- Browser scenario matrix ---");
    for (const n of browser.notes) console.log(`  ✓ ${n}`);
    for (const s of browser.skipped) console.log(`  ○ ${s}`);
    for (const e of browser.errors) console.log(`  ✗ ${e}`);
  }

  console.log("\n--- Optional API/live ---");
  console.log("  ○ Live marketplace: skipped (no RUN_* live flags in E2E.1 runner)");

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059E.1 end-to-end integration\n");
  console.log("Live marketplace calls during this run: NO");
  console.log("Next subphase: 059E.2 — Failure handling + rollback clarity\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
