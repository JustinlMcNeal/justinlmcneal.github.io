/**
 * Phase 059E.2 — Failure handling + rollback clarity verification.
 *
 * Run:
 *   node scripts/verify-inventory-phase059e2-failure-rollback-clarity.mjs
 *   node scripts/verify-inventory-phase059e2-failure-rollback-clarity.mjs --static
 *   node scripts/verify-inventory-phase059e2-failure-rollback-clarity.mjs --browser
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
const PORT = 9906;
const PAGE = "/pages/admin/inventory.html";
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const SCENARIO_TIMEOUT_MS = 30_000;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const ADJUST_FLOW = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/services/adjustChannelEbayBranch.js",
];

const COPY_CHECKS = [
  ["ADJUST_KK_SUCCESS_COPY", "KK stock was adjusted successfully."],
  ["ADJUST_PARTIAL_BANNER_TITLE", "Stock update complete. Some marketplace actions need attention."],
  ["ADJUST_PARTIAL_CHANNEL_FAILURE_COPY", "Stock remains adjusted. Retry marketplace sync from the links below."],
  ["ADJUST_NO_ROLLBACK_COPY", "Marketplace failures do not undo the stock adjustment."],
  ["AMAZON_SYNC_FAILED_COPY", "Amazon sync failed. KK stock remains adjusted."],
  ["AMAZON_DRY_RUN_COPY", "Amazon sync was previewed only. Live Amazon patching is disabled."],
  ["EBAY_QTY_FAILED_COPY", "eBay quantity sync failed. KK stock remains adjusted."],
  ["EBAY_CACHE_FAILED_COPY", "eBay cache refresh failed. Quantity sync was not attempted."],
  ["EBAY_RELIST_DRY_RUN_COPY", "eBay relist was previewed only. Live relist is disabled."],
  ["EBAY_RELIST_MANUAL_COPY", "eBay relist requires manual review."],
  ["EBAY_RELIST_FAILED_COPY", "eBay relist failed. KK stock remains adjusted."],
];

function parseArgs() {
  const args = process.argv.slice(2);
  const staticOnly = args.includes("--static");
  const browserOnly = args.includes("--browser");
  return {
    runStatic: staticOnly || !browserOnly,
    runBrowser: browserOnly || !staticOnly,
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

function spawnScript(script, timeout, extraEnv = {}) {
  const path = join(ROOT, "scripts", script);
  if (!existsSync(path)) return { ok: false, detail: "missing" };
  const result = spawnSync(process.execPath, [path, "--static"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status === 0) return { ok: true };
  const tail = (result.stdout || result.stderr || "").split("\n").slice(-2).join(" ").trim();
  return { ok: false, detail: tail.slice(0, 120) };
}

function verifyStatic() {
  const notes = [];
  const errors = [];
  const summary = readText("js/admin/inventory/services/adjustOrchestratorSummary.js");
  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");
  const ebay = readText("js/admin/inventory/services/adjustChannelEbayBranch.js");

  for (const [constName, text] of COPY_CHECKS) {
    if (!summary.includes(constName) || !summary.includes(text)) {
      errors.push(`Copy constant missing: ${constName}`);
    }
  }
  notes.push(`Standardized copy constants: ${COPY_CHECKS.length}/${COPY_CHECKS.length}`);

  if (!panel.includes("data-adjust-result-partial")) errors.push("Partial-success banner missing");
  if (!panel.includes("ADJUST_PARTIAL_BANNER_TITLE")) errors.push("Banner title not wired");
  if (!panel.includes("ADJUST_NO_ROLLBACK_COPY")) errors.push("No-rollback note missing from panel");
  if (!panel.includes("Retry via Sync Channels")) errors.push("Amazon/eBay failure retry link missing");
  if (!panel.includes("ebay-relist")) errors.push("eBay Relist Assist link missing");
  notes.push("Result panel partial banner + retry links present");

  if (!summary.includes("channelNeedsAttention")) errors.push("channelNeedsAttention helper missing");
  if (!summary.includes("dry_run")) errors.push("dry_run must be distinct from failed in summary");
  notes.push("dry_run vs failed distinction in summary helpers");

  const rollbackPatterns = [/rollbackStock/i, /undoAdjust/i, /reverseAdjustment/i];
  for (const rel of [
    "js/admin/inventory/services/adjustChannelOrchestrator.js",
    "js/admin/inventory/ui/adjustModal.js",
    "js/admin/inventory/services/adjustChannelEbayBranch.js",
  ]) {
    const text = readText(rel);
    for (const pat of rollbackPatterns) {
      if (pat.test(text)) errors.push(`${rel}: stock rollback pattern ${pat}`);
    }
  }
  const adjustCalls = (orch.match(/await adjustInventory\(/g) || []).length;
  if (adjustCalls !== 1) errors.push(`adjust_inventory must be sole stock writer (found ${adjustCalls} calls)`);
  notes.push("No stock rollback; adjust_inventory sole writer");

  for (const rel of ADJUST_FLOW) {
    if (/fetchChannelSyncPreview|issueSnapshot|refreshIssueSnapshot/.test(readText(rel))) {
      errors.push(`${rel}: forbidden heavy read`);
    }
  }

  if (!ebay.includes("EBAY_CACHE_FAILED_COPY") || !ebay.includes("EBAY_QTY_FAILED_COPY")) {
    errors.push("eBay branch must use standardized failure copy");
  }
  if (!orch.includes("AMAZON_SYNC_FAILED_COPY") || !orch.includes("AMAZON_DRY_RUN_COPY")) {
    errors.push("Amazon branch must use standardized failure/dry_run copy");
  }

  if (!readText(PLAN_DOC).includes("verify-inventory-phase059e2-failure-rollback-clarity.mjs")) {
    errors.push("Plan doc must reference 059E.2 verify script");
  }

  const e1 = spawnScript("verify-inventory-phase059e1-end-to-end-integration.mjs", 120_000);
  if (e1.ok) notes.push("059E.1 static regression PASS");
  else errors.push(`059E.1 static regression FAIL${e1.detail ? `: ${e1.detail}` : ""}`);

  return { notes, errors };
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

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

async function verifyBrowser(env) {
  const notes = [];
  const errors = [];
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
    await page.locator('[data-inventory-action="adjust-stock"]').first().waitFor({ state: "visible", timeout: 60_000 });
    notes.push("Inventory page loaded");

    const panelChecks = await page.evaluate(async () => {
      const { renderAdjustResultPanel } = await import("/js/admin/inventory/renderers/renderAdjustResultPanel.js");
      const row = {
        id: "v1",
        title: "Test",
        variant: "Default",
        variantDetail: "",
        internalSku: "KK-TEST",
        onHand: 5,
        reserved: 0,
        shortSku: "KKTEST",
      };
      const base = {
        orchestrationId: "orch-e2",
        syncChannelsEnabled: true,
        kk: {
          status: "success",
          message: "KK stock was adjusted successfully.",
          ledgerId: "led",
          stockAfter: 6,
          delta: 1,
          stockBefore: 5,
        },
        warnings: [],
        errors: [],
      };
      const cases = [
        {
          label: "channel_failure",
          amazon: { status: "failed", action: "update_qty", message: "Amazon sync failed. KK stock remains adjusted." },
          ebay: { status: "skipped", action: "no_change", message: "eBay quantity already matches available stock." },
          expect: ["Stock update complete", "Stock remains adjusted", "do not undo", "Retry via Sync Channels"],
        },
        {
          label: "amazon_dry_run",
          amazon: {
            status: "dry_run",
            action: "inactive_can_update",
            message: "Amazon sync was previewed only. Live Amazon patching is disabled.",
          },
          ebay: { status: "skipped", action: "no_change", message: "skip" },
          expect: ["Amazon sync was previewed only", "Sync Channels", "Preview only"],
        },
        {
          label: "ebay_relist_dry_run",
          amazon: { status: "skipped", action: null, message: "skip" },
          ebay: {
            status: "dry_run",
            action: "ended_needs_relist",
            message: "eBay relist was previewed only. Live relist is disabled.",
            nextStepUrl: "/pages/admin/ebay-listings.html",
          },
          expect: ["eBay relist was previewed only", "eBay Relist Assist", "Preview only"],
        },
        {
          label: "ebay_manual",
          amazon: { status: "skipped", action: null, message: "skip" },
          ebay: {
            status: "next_step",
            action: "unsupported_variation",
            message: "eBay variation listing requires manual review.",
            nextStepUrl: "/pages/admin/ebay-listings.html",
          },
          expect: ["manual review", "Open Relist Assist", "Manual step"],
        },
        {
          label: "cache_failure",
          amazon: { status: "skipped", action: null, message: "skip" },
          ebay: {
            status: "failed",
            action: "qty_cache_missing",
            message: "eBay cache refresh failed. Quantity sync was not attempted.",
          },
          expect: ["cache refresh failed", "KK stock was adjusted successfully", "Retry via Sync Channels"],
        },
      ];
      return cases.map((c) => {
        const html = renderAdjustResultPanel(
          { ...base, amazon: c.amazon, ebay: c.ebay },
          row,
        );
        const ok = c.expect.every((needle) => html.includes(needle));
        return { label: c.label, ok, hasPartial: html.includes("data-adjust-result-partial") };
      });
    });

    for (const check of panelChecks) {
      if (!check.ok) errors.push(`Browser panel case failed: ${check.label}`);
      else notes.push(`Browser panel case: ${check.label} PASS`);
    }

    await page.locator('[data-inventory-action="adjust-stock"]').first().click({ timeout: 15_000 });
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15_000 });
    notes.push("Adjust modal opens");

    const benign = consoleErrors.filter(
      (e) => !/favicon|404|Failed to load resource|\[adminNav\]/i.test(e),
    );
    if (benign.length) errors.push(`Browser console: ${benign.slice(0, 2).join(" | ")}`);
    else notes.push("Browser: no significant console errors");
  } catch (err) {
    errors.push(`Browser: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }

  return { notes, errors };
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }
  const flags = parseArgs();

  console.log("\n=== Phase 059E.2 — Failure Handling + Rollback Clarity ===\n");
  if (flags.runStatic && !flags.runBrowser) console.log("Mode: --static only\n");
  if (flags.runBrowser && !flags.runStatic) console.log("Mode: --browser only\n");

  const errors = [];

  if (flags.runStatic) {
    const staticResult = verifyStatic();
    console.log("--- Static + copy audit ---");
    for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
    for (const e of staticResult.errors) console.log(`  ✗ ${e}`);
    errors.push(...staticResult.errors);
  }

  if (flags.runBrowser) {
    const browser = await verifyBrowser(env);
    console.log("\n--- Browser smoke ---");
    for (const n of browser.notes) console.log(`  ✓ ${n}`);
    for (const e of browser.errors) console.log(`  ✗ ${e}`);
    errors.push(...browser.errors);
  }

  console.log("\n--- Live marketplace ---");
  console.log("  ○ Skipped (no RUN_* live flags)");

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059E.2 failure handling + rollback clarity\n");
  console.log("No stock rollback added. adjust_inventory remains sole stock writer.");
  console.log("Next subphase: 059E.3 — Operator UX polish\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
