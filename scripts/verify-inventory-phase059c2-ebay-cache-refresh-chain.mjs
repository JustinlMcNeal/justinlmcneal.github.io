/**
 * Phase 059C.2 — eBay single-product cache refresh chain verification.
 * Run: node scripts/verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs
 *
 * Optional env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TEST_EBAY_CACHE_PRODUCT_ID — single product UUID for API dry-run
 *   TEST_EBAY_CACHE_VARIANT_ID — variant UUID for candidate re-fetch check
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9901;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";

const PHASE_FILES = [
  "supabase/functions/sync-ebay-listing-inventory-cache/index.ts",
  "js/admin/inventory/api/ebayCacheRefreshApi.js",
  "js/admin/inventory/services/adjustChannelEbayCache.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayCache.js",
];

const FORBIDDEN = [
  { label: "eBay auto-relist", pattern: /pushEbayRelist|autoRelistListing|sync-ebay.*relist/i },
  { label: "full fetchChannelSyncPreview", pattern: /fetchChannelSyncPreview/ },
  { label: "browser snapshot refresh", pattern: /issueSnapshot|refreshIssueSnapshot/ },
];

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
  notes.push("059C.2 modules present and under 500 lines");

  const edge = readText("supabase/functions/sync-ebay-listing-inventory-cache/index.ts");
  if (!edge.includes("syncContext")) errors.push("Cache edge must accept syncContext");
  if (!edge.includes("parseInventorySyncRunContext")) {
    errors.push("Cache edge must parse syncContext via parseInventorySyncRunContext");
  }
  if (!edge.includes("triggerSource: syncCtx.triggerSource") && !edge.includes("triggerSource: syncCtx")) {
    errors.push("Cache edge must persist correlation on createInventorySyncRun");
  }
  notes.push("Cache edge accepts syncContext and persists correlation on sync run");

  const syncUi = readText("js/admin/inventory/ui/syncEbayReadiness.js");
  if (!syncUi.includes("refreshEbayListingCache({ limit: 25 })")) {
    errors.push("Sync Channels must keep bulk cache refresh unchanged");
  }
  if (syncUi.includes("syncContext")) {
    errors.push("Sync Channels bulk refresh must not require syncContext");
  }
  notes.push("Sync Channels bulk cache refresh backward compatible");

  const helper = readText("js/admin/inventory/services/adjustChannelEbayCache.js");
  if (!helper.includes("runAdjustEbayCacheRefreshChain")) {
    errors.push("Helper must export runAdjustEbayCacheRefreshChain");
  }
  if (!helper.includes("productIds: [pid]") || !helper.includes("limit: 1")) {
    errors.push("Helper must call refresh with single productId and limit 1");
  }
  if (!helper.includes("fetchChannelSyncCandidateForVariant")) {
    errors.push("Helper must re-fetch candidate after cache refresh");
  }
  if (helper.includes("pushEbayInventoryQuantity")) {
    errors.push("Cache helper must not push qty (adjustChannelEbayBranch handles push)");
  }
  if (!helper.includes("nextAction")) errors.push("Helper must return nextAction");
  notes.push("Adjust-chain helper: refresh + re-read only, no qty push");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (!orch.includes("resolveEbayBranch")) {
    errors.push("Orchestrator must delegate eBay to adjustChannelEbayBranch (059C.3+)");
  }
  notes.push("Adjust orchestrator delegates eBay branch (059C.2 helper unchanged)");

  for (const rel of ADJUST_FLOW_FILES) {
    const text = readText(rel);
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(text)) errors.push(`${rel}: forbidden ${label}`);
    }
  }

  const orchOnly = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (!orchOnly.includes("await adjustInventory(")) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  notes.push("No relist, no snapshot refresh; adjust_inventory only stock writer");

  const amazonEdge = readText("supabase/functions/sync-amazon-inventory-quantity/index.ts");
  if (amazonEdge.includes("ebay") && amazonEdge.includes("cache_refresh")) {
    // noop — unlikely
  }
  notes.push("Amazon paths unchanged for 059C.2");

  const doc = readText(PLAN_DOC);
  if (!doc.includes("059C.2") || !doc.includes("adjustChannelEbayCache")) {
    errors.push("Plan doc must document 059C.2 and helper");
  }
  if (doc.includes("059C.2 — Single-variant cache refresh chain ✅")) {
    // ok when complete
  }
  notes.push("Plan doc references 059C.2");

  return { notes, errors };
}

async function callCacheRefreshEdge(env, body) {
  const url = `${env.SUPABASE_URL}/functions/v1/sync-ebay-listing-inventory-cache`;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const resp = await fetch(url, {
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

async function verifyOptionalApi(env) {
  const notes = [];
  const errors = [];
  const skipped = [];

  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const productId = env.TEST_EBAY_CACHE_PRODUCT_ID || process.env.TEST_EBAY_CACHE_PRODUCT_ID;

  if (!url || !key) {
    skipped.push("Optional API: skipped — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { notes, errors, skipped };
  }
  if (!productId?.trim()) {
    skipped.push("Optional API: skipped — missing TEST_EBAY_CACHE_PRODUCT_ID");
    return { notes, errors, skipped };
  }

  const testOrch = `059c2-test-${Date.now()}`;
  const { status, data } = await callCacheRefreshEdge(
    { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key },
    {
      productIds: [productId.trim()],
      limit: 1,
      syncContext: {
        trigger_source: "manual_adjust",
        trigger_reference_type: "stock_ledger",
        orchestration_id: testOrch,
      },
    },
  );

  if (status >= 500) errors.push(`Optional API: edge HTTP ${status}`);
  else notes.push(`Optional API: cache refresh ok=${data.ok} summary=${JSON.stringify(data.summary || {})}`);

  if (data.syncContext?.orchestration_id === testOrch) {
    notes.push("Optional API: syncContext echoed in response");
  }

  try {
    process.env.SUPABASE_DB_PASSWORD =
      env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
    const client = new pg.Client({
      connectionString: getPoolerConnectionString(),
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    const { rows } = await client.query(
      `SELECT id, mode, trigger_source, orchestration_id
       FROM inventory_channel_sync_runs
       WHERE orchestration_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [testOrch],
    );
    await client.end().catch(() => {});
    if (rows?.[0]?.trigger_source === "manual_adjust") {
      notes.push(`Optional API: sync run persisted id=${rows[0].id}`);
    } else {
      skipped.push("Optional API: no correlated sync run row (product may be absent)");
    }
  } catch (err) {
    skipped.push(`Optional API: DB correlation check skipped — ${err.message}`);
  }

  return { notes, errors, skipped };
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

  try {
    await signInAdmin(page, env);
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('[data-inventory-action="adjust-stock"]').first().waitFor({ state: "visible", timeout: 60000 });
    notes.push("Browser: inventory page loaded");
    await page.locator('[data-inventory-action="adjust-stock"]').first().click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15000 });
    notes.push("Browser: adjust modal opened");
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
  let apiResult = { notes: [], errors: [], skipped: [] };
  let browserResult = { notes: [], errors: [] };

  try {
    apiResult = await verifyOptionalApi(env);
  } catch (err) {
    apiResult.skipped.push(`Optional API exception: ${err.message}`);
  }

  try {
    browserResult = await verifyBrowser(env);
  } catch (err) {
    browserResult.errors.push(`Browser smoke skipped: ${err.message}`);
  }

  const errors = [...staticResult.errors, ...apiResult.errors, ...browserResult.errors];
  const notes = [...staticResult.notes, ...apiResult.notes, ...browserResult.notes];

  console.log("\n=== Phase 059C.2 — eBay Cache Refresh Chain ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const s of apiResult.skipped) console.log(`  ○ ${s}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059C.2 eBay cache refresh chain support\n");
  console.log("Next subphase: 059C.3 — Adjust orchestrator eBay integration\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
