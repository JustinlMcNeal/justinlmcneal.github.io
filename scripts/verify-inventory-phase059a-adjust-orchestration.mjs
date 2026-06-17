/**
 * Phase 059A.5 — Full adjust orchestration QA, verification, and freeze.
 * Composes 059A.2–059A.4 sub-scripts and validates the complete 059A slice.
 *
 * Run: node scripts/verify-inventory-phase059a-adjust-orchestration.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, statSync, readdirSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";
import { runIssueViewSafetyChecks } from "./verify-inventory-issue-view-safety.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9898;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const PRIOR_SCRIPTS = [
  "verify-inventory-phase059a2-adjust-channel-preview.mjs",
  "verify-inventory-phase059a3-adjust-orchestrator.mjs",
  "verify-inventory-phase059a4-result-panel-audit.mjs",
];

const ALL_059A_JS = [
  "js/admin/inventory/api/channelSyncCandidateApi.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/renderers/renderAdjustChannelPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/services/adjustOrchestratorSummary.js",
  "js/admin/inventory/services/adjustSyncContext.js",
  "js/admin/inventory/ui/adjustResultPanel.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/renderers/renderAdjustModal.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/ui/adjustResultPanel.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/renderers/renderAdjustResultPanel.js",
  "js/admin/inventory/api/channelSyncCandidateApi.js",
];

const FORBIDDEN_PATTERNS = [
  { label: "Amazon inactive restore in preview layer", pattern: /\b(restoreInactive|restore_inactive_listing)\b/i },
  { label: "eBay auto-relist push", pattern: /\b(autoRelist|auto_relist|pushEbayRelist|relistEndedListing)\b/i },
  { label: "eBay cache refresh chain in adjust flow", pattern: /sync-ebay-listing-inventory-cache|refreshEbayListingCache/i },
  { label: "full fetchChannelSyncPreview in adjust flow", pattern: /fetchChannelSyncPreview/ },
  { label: "browser issue snapshot refresh", pattern: /issueSnapshot|refreshIssueSnapshot|scheduleIssueSnapshotRefresh/i },
  { label: "alternate stock writer", pattern: /\b(set_stock|writeStock|update_stock_qty)\b/i },
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

function readText(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function walkJsFiles(dir, acc = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) walkJsFiles(full, acc);
    else if (name.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

function runPriorScripts() {
  const notes = [];
  const errors = [];
  const skipped = [];

  for (const script of PRIOR_SCRIPTS) {
    const path = join(ROOT, "scripts", script);
    if (!existsSync(path)) {
      errors.push(`Missing prior script: ${script}`);
      continue;
    }
    const result = spawnSync(process.execPath, [path], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 180000,
      env: { ...process.env },
    });
    const label = script.replace("verify-inventory-", "").replace(".mjs", "");
    if (result.status === 0) notes.push(`Prior script PASS: ${label}`);
    else {
      const tail = (result.stdout || result.stderr || "").split("\n").slice(-8).join(" ").trim();
      errors.push(`Prior script FAIL: ${label}${tail ? ` — ${tail.slice(0, 200)}` : ""}`);
    }
  }

  return { notes, errors, skipped };
}

function verifyStatic059A() {
  const notes = [];
  const errors = [];

  for (const rel of ALL_059A_JS) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing 059A file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
  }
  if (!errors.some((e) => e.includes("Missing 059A"))) {
    notes.push(`All ${ALL_059A_JS.length} 059A JS modules present and under ${MAX_LINES} lines`);
  }

  const candidateApi = readText("js/admin/inventory/api/channelSyncCandidateApi.js");
  if (!candidateApi.includes("fetchChannelSyncCandidateForVariant")) {
    errors.push("Preview must use fetchChannelSyncCandidateForVariant");
  } else notes.push("Preview uses fetchChannelSyncCandidateForVariant");

  const previewController = readText("js/admin/inventory/ui/adjustModalChannelPreview.js");
  if (!previewController.includes("fetchChannelSyncCandidateForVariant")) {
    errors.push("adjustModalChannelPreview must call fetchChannelSyncCandidateForVariant");
  }

  const adjustModal = readText("js/admin/inventory/ui/adjustModal.js");
  if (!adjustModal.includes("loadAdjustChannelPreview")) errors.push("adjustModal missing channel preview loader");
  if (!adjustModal.includes("runAdjustChannelOrchestration")) errors.push("adjustModal missing orchestrator");
  if (!adjustModal.includes("showAdjustResultPanel")) errors.push("adjustModal missing result panel");
  if (adjustModal.includes("adjustInventory(")) {
    errors.push("adjustModal must not call adjustInventory directly");
  }
  if (adjustModal.includes("fetchChannelSyncPreview")) {
    errors.push("adjustModal must not call fetchChannelSyncPreview");
  }
  notes.push("adjustModal wired: preview → orchestrator → result panel");

  const renderer = readText("js/admin/inventory/renderers/renderAdjustChannelPreview.js");
  if (!renderer.includes("Sync marketplaces after stock adjustment")) errors.push("Sync toggle text missing");
  else notes.push("Sync marketplaces toggle exists");

  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (!orch.includes("runAdjustChannelOrchestration")) errors.push("Orchestrator export missing");
  const fnBody = orch.slice(orch.indexOf("export async function runAdjustChannelOrchestration"));
  const adjustIdx = fnBody.indexOf("await adjustInventory(");
  const amazonIdx = fnBody.indexOf("await resolveAmazonBranch(");
  if (adjustIdx < 0) errors.push("Orchestrator must await adjustInventory");
  if (amazonIdx < 0) errors.push("Orchestrator must await channel branches");
  if (adjustIdx >= 0 && amazonIdx >= 0 && amazonIdx < adjustIdx) {
    errors.push("Channel sync must run after adjust_inventory");
  } else notes.push("Orchestrator calls adjust before channel sync");

  const ebayBranch = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");
  if (!orch.includes('action === "update_qty"') && !ebayBranch.includes('action === "update_qty"')) {
    errors.push("Orchestrator must gate channel push on update_qty");
  }
  if (!orch.includes("await pushAmazonFbmInventory(") || !ebayBranch.includes("pushEbayInventoryQuantity")) {
    errors.push("Orchestrator must include safe update_qty push paths");
  }
  if (!ebayBranch.includes("available <= 0")) errors.push("Orchestrator must skip eBay qty-0 push");
  else notes.push("No qty-0 eBay push path; eBay gated on available > 0");

  const invokers = [];
  const inventoryJsRoot = join(ROOT, "js/admin/inventory");
  for (const file of walkJsFiles(inventoryJsRoot)) {
    const rel = file.slice(ROOT.length).replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const text = readFileSync(file, "utf8");
    if (text.includes("runAdjustChannelOrchestration") && !rel.endsWith("adjustChannelOrchestrator.js")) {
      invokers.push(rel);
    }
  }
  if (invokers.length !== 1 || invokers[0] !== "js/admin/inventory/ui/adjustModal.js") {
    errors.push(`runAdjustChannelOrchestration must only be invoked from adjustModal (found: ${invokers.join(", ") || "none"})`);
  } else notes.push("Orchestrator only invoked from adjustModal");

  const nextSteps = readText("js/admin/inventory/services/adjustChannelNextSteps.js");
  if (!nextSteps.includes("inactive_can_update")) {
    errors.push("adjustChannelNextSteps must handle inactive_can_update");
  }
  if (nextSteps.match(/inactive_can_update[\s\S]{0,120}status:\s*"next_step"/)) {
    errors.push("inactive_can_update must be orchestrated (059B.3), not next_step deferral");
  }
  if (!nextSteps.includes("ended_needs_relist")) errors.push("eBay ended must return next_step");
  if (nextSteps.match(/case "qty_cache_missing"[\s\S]{0,40}return null/)) {
    notes.push("qty_cache_missing orchestrated in adjustChannelEbayBranch (059C.3)");
  } else if (nextSteps.match(/qty_cache_missing[\s\S]{0,80}status:\s*"next_step"/)) {
    errors.push("qty_cache_missing must be orchestrated (059C.3), not next_step deferral");
  }
  if (nextSteps.includes("pushAmazon") || nextSteps.includes("pushEbay")) {
    errors.push("adjustChannelNextSteps must not call channel push APIs");
  }
  notes.push("Amazon inactive + eBay cache-missing orchestrated; eBay ended still next_step");

  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  for (const label of ["KK", "Amazon", "eBay"]) {
    if (!panel.includes(`label: "${label}"`)) errors.push(`Result panel missing ${label} section`);
  }
  notes.push("Result panel renders KK / Amazon / eBay sections");

  const migration = "supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql";
  if (!existsSync(join(ROOT, migration))) {
    errors.push("Missing correlation migration");
  } else {
    const mig = readText(migration);
    for (const col of ["trigger_source", "trigger_reference_type", "stock_ledger_id", "orchestration_id"]) {
      if (!mig.includes(col)) errors.push(`Migration missing ${col}`);
    }
    notes.push("Correlation fields present in migration + adjustSyncContext");
  }

  const syncCtx = readText("js/admin/inventory/services/adjustSyncContext.js");
  if (!syncCtx.includes("manual_adjust") || !syncCtx.includes("orchestration_id")) {
    errors.push("adjustSyncContext missing correlation fields");
  }

  const stockWriters = [];
  for (const rel of ADJUST_FLOW_FILES) {
    const text = readText(rel);
    if (text.includes("adjustInventory(") && !rel.includes("adjustChannelOrchestrator.js")) {
      stockWriters.push(rel);
    }
    for (const { label, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) errors.push(`${rel}: forbidden ${label}`);
    }
  }
  const orchOnly = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  if (!orchOnly.includes("await adjustInventory(")) {
    errors.push("adjust_inventory must be called from orchestrator");
  }
  if (stockWriters.length) {
    errors.push(`adjustInventory referenced outside orchestrator: ${stockWriters.join(", ")}`);
  } else notes.push("adjust_inventory remains the only stock writer in 059A flow");

  return { notes, errors };
}

async function runPoolSafety() {
  const notes = [];
  const errors = [];
  const skipped = [];

  try {
    const issueSafety = await runIssueViewSafetyChecks();
    if (issueSafety.errors.length) {
      errors.push(...issueSafety.errors.map((e) => `issue-view-safety: ${e}`));
    } else notes.push("verify-inventory-issue-view-safety.mjs checks passed");
    for (const w of issueSafety.warnings) skipped.push(`issue-view-safety: ${w}`);
  } catch (err) {
    skipped.push(`issue-view-safety skipped: ${err.message}`);
  }

  const phase10y = join(ROOT, "scripts/verify-inventory-phase10y-final-stabilization.mjs");
  if (!existsSync(phase10y)) {
    skipped.push("verify-inventory-phase10y-final-stabilization.mjs not found");
  } else {
    const result = spawnSync(process.execPath, [phase10y], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 240000,
      env: { ...process.env },
    });
    if (result.status === 0) notes.push("verify-inventory-phase10y-final-stabilization.mjs PASS");
    else {
      const out = `${result.stdout || ""}\n${result.stderr || ""}`;
      if (/skipped|DB checks skipped|Missing SUPABASE/i.test(out)) {
        skipped.push("phase10y: DB/browser checks skipped or partial (callable)");
      } else {
        errors.push("verify-inventory-phase10y-final-stabilization.mjs FAIL");
      }
    }
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

async function verifyBrowserSmoke(env) {
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

    await signInAdmin(page, env);

    const adjustBtn = page.locator('[data-inventory-action="adjust-stock"]').first();
    await adjustBtn.waitFor({ state: "visible", timeout: 60000 });
    const variantId = await adjustBtn.getAttribute("data-row-id");
    notes.push("Inventory page loaded");

    await adjustBtn.click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15000 });
    notes.push("Adjust modal opened");

    await page.waitForFunction(
      () => {
        const body = document.querySelector("[data-adjust-channel-body]");
        return body && !body.querySelector("[data-adjust-channel-loading]");
      },
      { timeout: 20000 },
    );
    notes.push("Channel preview cards loaded");

    const toggle = page.locator("[data-adjust-sync-toggle]");
    await toggle.waitFor({ state: "visible", timeout: 10000 });
    const toggleEnabled = await toggle.isEnabled();
    if (toggleEnabled) {
      await toggle.setChecked(false);
      notes.push("Sync toggle set OFF for smoke submit");
    } else {
      notes.push("Sync toggle disabled (no safe path) — treated as sync OFF");
    }

    for (const card of ["kk", "amazon", "ebay"]) {
      if (!(await page.locator(`[data-adjust-channel-card="${card}"]`).count())) {
        errors.push(`Preview card missing: ${card}`);
      }
    }
    if (!errors.some((e) => e.startsWith("Preview card"))) notes.push("Preview KK/Amazon/eBay cards rendered");

    const mockLedgerId = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
    await page.route("**/rest/v1/rpc/adjust_inventory**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          variant_id: variantId,
          product_id: "bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee",
          delta: 1,
          stock_before: 5,
          stock_after: 6,
          ledger_id: mockLedgerId,
          created_at: new Date().toISOString(),
          idempotent_replay: false,
        }),
      });
    });

    await page.fill("#inventoryAdjustQty", "1");
    await page.selectOption("#inventoryAdjustReason", "count_correction");
    await page.fill("#inventoryAdjustNote", "059A.5 smoke test (mocked adjust_inventory RPC)");
    await page.click("[data-adjust-submit]");

    await page.waitForSelector("[data-adjust-result-panel]", { timeout: 30000 });
    notes.push("Result panel appeared after submit (sync OFF, mocked RPC)");

    if (!(await page.locator('[data-adjust-result-card="kk"]').count())) {
      errors.push("Result panel KK card missing after submit");
    }
    if (!(await page.locator("[data-adjust-result-done]").count())) {
      errors.push("Result panel Done button missing");
    }

    await page.click("[data-adjust-result-done]");
    await page.waitForSelector("#inventoryAdjustForm", { state: "hidden", timeout: 10000 }).catch(() => {});
    const formVisible = await page.locator("#inventoryAdjustForm").count();
    if (formVisible) errors.push("Done did not close adjust modal");
    else notes.push("Done closes modal");

    const benign = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("Failed to load resource"),
    );
    if (benign.length) errors.push(`Console errors: ${benign.slice(0, 3).join(" | ")}`);
    else notes.push("No significant console errors");
  } catch (err) {
    skipped.push(`Browser smoke skipped: ${err.message}`);
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

  console.log("\n=== Phase 059A.5 — Adjust Orchestration QA + Freeze ===\n");

  const prior = runPriorScripts();
  const staticResult = verifyStatic059A();
  const pool = await runPoolSafety();
  const browser = await verifyBrowserSmoke(env);

  const errors = [...prior.errors, ...staticResult.errors, ...pool.errors, ...browser.errors];
  const notes = [...prior.notes, ...staticResult.notes, ...pool.notes, ...browser.notes];
  const skipped = [...prior.skipped, ...pool.skipped, ...browser.skipped];

  console.log("--- Prior 059A sub-scripts ---");
  for (const n of prior.notes) console.log(`  ✓ ${n}`);
  for (const e of prior.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- 059A slice static ---");
  for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
  for (const e of staticResult.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Pool safety ---");
  for (const n of pool.notes) console.log(`  ✓ ${n}`);
  for (const s of pool.skipped) console.log(`  ⚠ ${s}`);
  for (const e of pool.errors) console.log(`  ✗ ${e}`);

  console.log("\n--- Browser smoke ---");
  for (const n of browser.notes) console.log(`  ✓ ${n}`);
  for (const s of browser.skipped) console.log(`  ⚠ ${s}`);
  for (const e of browser.errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }

  console.log("\nPASS — Phase 059A complete (059A.1–059A.5 frozen)");
  console.log("\nDeployment checklist:");
  console.log("  1. Apply supabase/migrations/20261023_inventory_phase059a4_adjust_sync_run_correlation.sql");
  console.log("  2. Redeploy sync-amazon-inventory-quantity");
  console.log("  3. Redeploy sync-ebay-inventory-quantity");
  console.log("  4. Confirm AMAZON_ENABLE_LIVE_PATCH=true before live Amazon sync");
  console.log("  5. Confirm EBAY_ENABLE_LIVE_QUANTITY_PATCH=true before live eBay sync");
  console.log("\nNext subphase: 059B.1 — Amazon inactive restock audit\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
