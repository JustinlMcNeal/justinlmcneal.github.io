/**
 * Phase 059B.3 — Adjust orchestrator Amazon inactive restock integration verification.
 * Run: node scripts/verify-inventory-phase059b3-adjust-amazon-inactive-orchestrator.mjs
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
const PORT = 9899;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const PHASE_FILES = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/services/adjustOrchestratorSummary.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/api/amazonSyncPushApi.js",
  "js/admin/inventory/ui/adjustModal.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
];

const FORBIDDEN = [
  { label: "eBay auto-relist implementation", pattern: /pushEbayRelist|autoRelistListing|sync-ebay.*relist/i },
  { label: "eBay cache refresh chain", pattern: /sync-ebay-listing-inventory-cache|refreshEbayListingCache/i },
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
  notes.push("059B.3 JS modules present and under 500 lines");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const fnBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));

  if (!orch.includes("runAmazonInactiveRestock")) {
    errors.push("Orchestrator missing runAmazonInactiveRestock");
  }
  if (!orch.includes('mode: "inactive_restock"')) {
    errors.push("Orchestrator must call pushAmazonFbmInventory with mode inactive_restock");
  }
  if (!orch.includes('action === "inactive_can_update"')) {
    errors.push("Orchestrator must branch on inactive_can_update");
  }

  const adjustIdx = fnBody.indexOf("await adjustInventory(");
  const amazonIdx = fnBody.indexOf("await resolveAmazonBranch(");
  if (adjustIdx < 0 || amazonIdx < 0 || amazonIdx < adjustIdx) {
    errors.push("Amazon branch must run after adjust_inventory");
  }
  notes.push("Orchestrator calls inactive restock after adjust success");

  if (!orch.includes("variantIds: [variantId]") || !orch.includes("limit: 1")) {
    errors.push("Inactive restock must pass single variantId and limit 1");
  }
  if (!orch.includes("syncContext")) {
    errors.push("Orchestrator must pass syncContext to Amazon push");
  }
  if (!orch.includes("fetchChannelSyncCandidateForVariant")) {
    errors.push("Orchestrator must re-fetch post-adjust candidate");
  }
  notes.push("Single variant, syncContext, post-adjust candidate refresh");

  if (!orch.includes("projectedAvailable <= 0")) {
    errors.push("Orchestrator must skip marketplace sync when projected available <= 0");
  }

  const updateQtyBlock = orch.slice(0, orch.indexOf("runAmazonInactiveRestock"));
  if (updateQtyBlock.includes('mode: "inactive_restock"')) {
    errors.push("update_qty path must not use inactive_restock mode");
  }
  notes.push("update_qty path unchanged; inactive_restock isolated");

  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  if (!preview.includes("Amazon inactive offer can be restored")) {
    errors.push("Preview must show inactive restore available copy");
  }
  if (!preview.includes("inactive_can_update")) {
    errors.push("Preview must handle inactive_can_update in toggle default");
  }
  notes.push("Preview labels updated for inactive restore");

  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  for (const token of ["dry_run", "failed", "success"]) {
    if (!panel.includes(token)) errors.push(`Result panel missing status ${token}`);
  }
  if (!orch.includes("Amazon inactive offer restore requested")) {
    errors.push("Orchestrator missing inactive success message");
  }
  if (!orch.includes("Live Amazon patching is disabled") && !orch.includes("AMAZON_DRY_RUN_COPY")) {
    errors.push("Orchestrator missing inactive dry_run message");
  }
  notes.push("Result panel and orchestrator inactive restore copy");

  const api = readText("js/admin/inventory/api/amazonSyncPushApi.js");
  if (!api.includes("inactive_restock")) {
    errors.push("amazonSyncPushApi JSDoc must document mode inactive_restock");
  }

  const syncModal = readText("js/admin/inventory/ui/syncDryRunModal.js");
  if (syncModal.includes("inactive_restock")) {
    errors.push("Sync Channels must not pass inactive_restock mode");
  }
  notes.push("Sync Channels default update_qty preserved");

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
  notes.push("No eBay changes, no heavy reads, adjust_inventory only stock writer");

  return { notes, errors };
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
    notes.push("Inventory page loaded");
    await page.locator('[data-inventory-action="adjust-stock"]').first().click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15000 });
    notes.push("Adjust modal opened");
    const benign = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("Failed to load resource"),
    );
    if (benign.length) errors.push(`Console errors: ${benign.slice(0, 3).join(" | ")}`);
    else notes.push("No significant console errors");
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
  let browserResult = { notes: [], errors: [] };
  try {
    browserResult = await verifyBrowser(env);
  } catch (err) {
    browserResult.errors.push(`Browser smoke skipped: ${err.message}`);
  }

  const errors = [...staticResult.errors, ...browserResult.errors];
  const notes = [...staticResult.notes, ...browserResult.notes];

  console.log("\n=== Phase 059B.3 — Adjust Amazon Inactive Orchestrator ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059B.3 Adjust Amazon inactive orchestrator integration\n");
  console.log("Next subphase: 059B.4 — Amazon inactive verification\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
