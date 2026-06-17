/**
 * Phase 059C.3 — Adjust orchestrator eBay cache-missing integration verification.
 * Run: node scripts/verify-inventory-phase059c3-adjust-ebay-active-orchestrator.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9902;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const REGRESSION_SCRIPTS = [
  "verify-inventory-phase059a-adjust-orchestration.mjs",
  "verify-inventory-phase059b-final-freeze.mjs",
  "verify-inventory-phase059c2-ebay-cache-refresh-chain.mjs",
  "verify-inventory-issue-view-safety.mjs",
  "verify-inventory-phase10y-final-stabilization.mjs",
];

const PHASE_FILES = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
  "js/admin/inventory/services/adjustChannelEbayCache.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
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
  notes.push("059C.3 modules present and under 500 lines");

  const branch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  if (!branch.includes("runAdjustEbayCacheRefreshChain")) {
    errors.push("eBay branch must call runAdjustEbayCacheRefreshChain");
  }
  if (!branch.includes('action === "qty_cache_missing"')) {
    errors.push("eBay branch must handle qty_cache_missing");
  }
  if (!branch.includes("nextAction === \"update_qty\"") || !branch.includes('refreshedAction === "update_qty"')) {
    errors.push("Qty push must require refreshed candidate update_qty");
  }
  if (!branch.includes("pushEbayInventoryQuantity")) {
    errors.push("eBay branch must call pushEbayInventoryQuantity for update_qty");
  }
  if (!branch.includes("syncContext")) errors.push("eBay branch must pass syncContext");
  if (!branch.includes("cache refresh failed. Quantity sync was not attempted")) {
    errors.push("Cache failure must block qty push");
  }
  notes.push("eBay branch: cache chain + conditional qty push");

  const cacheHelper = readText("js/admin/inventory/services/adjustChannelEbayCache.js");
  if (cacheHelper.includes("pushEbayInventoryQuantity")) {
    errors.push("Cache helper must not push qty (branch module handles push)");
  }
  notes.push("Cache helper remains refresh + re-read only");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const fnBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));
  const adjustIdx = fnBody.indexOf("await adjustInventory(");
  const ebayIdx = fnBody.indexOf("await resolveEbayBranch(");
  if (adjustIdx < 0 || ebayIdx < 0 || ebayIdx < adjustIdx) {
    errors.push("eBay branch must run after adjust_inventory");
  }
  if (!orch.includes("resolveEbayBranch")) {
    errors.push("Orchestrator must delegate eBay to adjustChannelEbayBranch");
  }
  if (!orch.includes("projectedAvailable <= 0")) {
    errors.push("Orchestrator must skip when projected available <= 0");
  }
  notes.push("Orchestrator calls eBay after adjust; guards available > 0");

  const updateQtyBlock = branch.slice(branch.indexOf("export async function resolveEbayBranch"));
  if (!updateQtyBlock.includes('action === "update_qty"') || !updateQtyBlock.includes("runEbayUpdateQty")) {
    errors.push("Direct update_qty path must remain");
  }
  notes.push("Direct update_qty path unchanged in eBay branch");

  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  if (!preview.includes("will refresh before sync")) {
    errors.push("Preview must show qty_cache_missing refresh copy");
  }
  if (!preview.includes('ebay_sync_action === "qty_cache_missing"')) {
    errors.push("Sync toggle default must include qty_cache_missing");
  }
  notes.push("Preview updated for qty_cache_missing");

  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  if (!panel.includes("card.detail")) errors.push("Result panel must support eBay detail line");
  notes.push("Result panel supports cache sub-status detail");

  const nextSteps = readText("js/admin/inventory/services/adjustChannelNextSteps.js");
  if (nextSteps.match(/case "qty_cache_missing"[\s\S]{0,40}return null/)) {
    notes.push("qty_cache_missing handled by orchestrator");
  } else if (nextSteps.match(/qty_cache_missing[\s\S]{0,80}status:\s*"next_step"/)) {
    errors.push("qty_cache_missing must be orchestrated, not next_step deferral");
  }

  for (const rel of ADJUST_FLOW_FILES) {
    const text = readText(rel);
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(text)) errors.push(`${rel}: forbidden ${label}`);
    }
  }

  if (!orch.includes("await adjustInventory(")) {
    errors.push("adjust_inventory must remain sole stock writer");
  }
  notes.push("No relist, no snapshot refresh; adjust_inventory only stock writer");

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
      timeout: 360000,
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

async function resolveAdminEmail(env) {
  if (env.KK_ADMIN_EMAIL?.trim()) return env.KK_ADMIN_EMAIL.trim();
  process.env.SUPABASE_DB_PASSWORD =
    env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
  const pg = await import("pg");
  const { getPoolerConnectionString } = await import("./supabase/dbConnect.mjs");
  const client = new pg.default.Client({
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
  const regression = runRegressionScripts();
  let browserResult = { notes: [], errors: [] };
  try {
    browserResult = await verifyBrowser(env);
  } catch (err) {
    browserResult.errors.push(`Browser smoke skipped: ${err.message}`);
  }

  const errors = [...staticResult.errors, ...regression.errors, ...browserResult.errors];
  const notes = [...staticResult.notes, ...regression.notes, ...browserResult.notes];

  console.log("\n=== Phase 059C.3 — Adjust eBay Active Orchestrator ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059C.3 Adjust eBay cache-missing orchestrator integration\n");
  console.log("Next subphase: 059C.4 — eBay active verification\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
