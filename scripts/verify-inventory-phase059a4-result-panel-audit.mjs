/**
 * Phase 059A.4 — Unified result panel + audit correlation verification.
 * Run: node scripts/verify-inventory-phase059a4-result-panel-audit.mjs
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
const PORT = 9897;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const PHASE_FILES = [
  "js/admin/inventory/ui/adjustResultPanel.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/services/adjustSyncContext.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustOrchestratorSummary.js",
  "js/admin/inventory/ui/adjustModal.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/ui/adjustResultPanel.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
];

const FORBIDDEN_PATTERNS = [
  { label: "eBay auto-relist", pattern: /auto.?relist|ended.*relist.*push/i },
  { label: "eBay cache refresh chain", pattern: /sync-ebay-listing-inventory-cache|cache_refresh.*adjust/i },
  { label: "full fetchChannelSyncPreview in adjust flow", pattern: /fetchChannelSyncPreview/ },
  { label: "browser snapshot refresh", pattern: /issueSnapshot|refreshIssueSnapshot/i },
];

/** Files where Amazon inactive restore automation is still forbidden (059A preview scope). */
const PREVIEW_ONLY_FILES = [
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
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

function lineCount(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8").split("\n").length;
}

function verifyStatic() {
  const notes = [];
  const errors = [];

  for (const rel of PHASE_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
    else notes.push(`${rel}: ${lineCount(rel)} lines`);
  }

  const migration = "supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql";
  if (!existsSync(join(ROOT, migration))) {
    errors.push("Missing migration for sync run correlation");
  } else {
    const mig = readFileSync(join(ROOT, migration), "utf8");
    for (const col of [
      "trigger_source",
      "trigger_reference_type",
      "stock_ledger_id",
      "orchestration_id",
    ]) {
      if (!mig.includes(col)) errors.push(`Migration missing column ${col}`);
    }
    notes.push("Migration extends inventory_channel_sync_runs for audit correlation");
  }

  const panelRender = readFileSync(
    join(ROOT, "js/admin/inventory/renderers/renderAdjustResultPanel.js"),
    "utf8",
  );
  for (const label of ["KK", "Amazon", "eBay"]) {
    if (!panelRender.includes(`label: "${label}"`)) {
      errors.push(`Result panel missing ${label} status card`);
    }
  }
  for (const status of ["success", "failed", "skipped", "next_step", "dry_run"]) {
    if (!panelRender.includes(status)) errors.push(`Result panel missing status ${status}`);
  }
  if (!panelRender.includes("orchestrationId")) {
    errors.push("Result panel must show orchestrationId");
  }
  if (!panelRender.includes("ledgerId")) {
    errors.push("Result panel must show ledger id when available");
  }
  notes.push("Result panel includes KK/Amazon/eBay status labels");

  const summary = readFileSync(
    join(ROOT, "js/admin/inventory/services/adjustOrchestratorSummary.js"),
    "utf8",
  );
  if (!summary.includes("ADJUST_PARTIAL_CHANNEL_FAILURE_COPY")) {
    errors.push("Partial failure copy missing");
  }
  if (!summary.includes("Stock remains adjusted")) {
    errors.push("Partial failure message must state stock remains adjusted");
  }
  notes.push("Partial failure copy present");

  const syncCtx = readFileSync(
    join(ROOT, "js/admin/inventory/services/adjustSyncContext.js"),
    "utf8",
  );
  if (!syncCtx.includes("manual_adjust") || !syncCtx.includes("stock_ledger")) {
    errors.push("adjustSyncContext must set manual_adjust + stock_ledger correlation");
  }

  const orch = readFileSync(
    join(ROOT, "js/admin/inventory/services/adjustChannelOrchestrator.js"),
    "utf8",
  );
  if (!orch.includes("orchestrationId")) errors.push("Orchestrator must return orchestrationId");
  if (!orch.includes("buildAdjustSyncContext")) {
    errors.push("Orchestrator must build sync context for channel pushes");
  }
  if (!orch.includes("syncContext")) {
    errors.push("Orchestrator must pass syncContext to channel push APIs");
  }
  if (!orch.includes('mode: "inactive_restock"')) {
    errors.push("Orchestrator must support Amazon inactive_restock (059B.3+)");
  }
  notes.push("Orchestrator includes orchestrationId, syncContext, and inactive restock");

  const amazonUtils = readFileSync(
    join(ROOT, "supabase/functions/_shared/inventoryAmazonSyncUtils.ts"),
    "utf8",
  );
  if (!amazonUtils.includes("parseInventorySyncRunContext")) {
    errors.push("Edge shared utils must parse syncContext");
  }
  if (!amazonUtils.includes("trigger_source")) {
    errors.push("createInventorySyncRun must persist trigger_source");
  }
  notes.push("Edge functions support sync run correlation fields");

  const adjustModal = readFileSync(join(ROOT, "js/admin/inventory/ui/adjustModal.js"), "utf8");
  if (!adjustModal.includes("showAdjustResultPanel")) {
    errors.push("adjustModal must render result panel after orchestration");
  }
  const successBlock = adjustModal.slice(adjustModal.indexOf("orchestration.kk.status"));
  if (
    successBlock.includes("closeAdjustModal()") &&
    successBlock.indexOf("closeAdjustModal()") < successBlock.indexOf("showAdjustResultPanel")
  ) {
    errors.push("adjustModal must not close before showing result panel");
  }
  notes.push("adjustModal shows result panel before close/Done");

  for (const rel of ADJUST_FLOW_FILES) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const { label, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) errors.push(`${rel} must not include ${label}`);
    }
    if (PREVIEW_ONLY_FILES.includes(rel) && /restoreInactive|pushAmazonFbmInventory/.test(text)) {
      errors.push(`${rel} must not execute Amazon inactive restore (preview only)`);
    }
  }
  notes.push("Adjust flow excludes eBay automation and heavy reads; inactive restore in orchestrator only");

  const orchOnly = readFileSync(
    join(ROOT, "js/admin/inventory/services/adjustChannelOrchestrator.js"),
    "utf8",
  );
  if (!orchOnly.includes("await adjustInventory(")) {
    errors.push("Stock must change only via adjustInventory in orchestrator");
  }
  notes.push("adjust_inventory remains sole stock writer");

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

    const adjustBtn = page.locator('[data-inventory-action="adjust-stock"]').first();
    await adjustBtn.waitFor({ state: "visible", timeout: 60000 });
    notes.push("Inventory page loaded");

    await adjustBtn.click();
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
    browserResult.errors.push(`Browser verification failed: ${err.message}`);
  }

  const errors = [...staticResult.errors, ...browserResult.errors];
  const notes = [...staticResult.notes, ...browserResult.notes];

  console.log("\n=== Phase 059A.4 — Result Panel + Audit Correlation ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059A.4 result panel + audit correlation\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
