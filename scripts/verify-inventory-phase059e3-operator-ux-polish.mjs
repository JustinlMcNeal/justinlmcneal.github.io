/**
 * Phase 059E.3 — Operator UX polish verification.
 *
 * Run:
 *   node scripts/verify-inventory-phase059e3-operator-ux-polish.mjs
 *   node scripts/verify-inventory-phase059e3-operator-ux-polish.mjs --static
 *   node scripts/verify-inventory-phase059e3-operator-ux-polish.mjs --browser
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
const PORT = 9907;
const PAGE = "/pages/admin/inventory.html";
const PLAN_DOC = "docs/pages/admin/inventory/implementation/059_adjust_stock_unified_channel_restock_plan.md";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const ADJUST_FLOW = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
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

async function closeAdjustModal(page) {
  const cancel = page.getByRole("button", { name: "Cancel" });
  if (await cancel.count()) {
    await cancel.click({ timeout: 5000 });
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForSelector("#inventoryAdjustForm", { state: "hidden", timeout: 5000 }).catch(() => {});
}

function spawnScript(script, timeout, args = []) {
  const path = join(ROOT, "scripts", script);
  if (!existsSync(path)) return { ok: false, detail: "missing" };
  const result = spawnSync(process.execPath, [path, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    env: process.env,
  });
  if (result.status === 0) return { ok: true };
  const tail = (result.stdout || result.stderr || "").split("\n").slice(-2).join(" ").trim();
  return { ok: false, detail: tail.slice(0, 120) };
}

function verifyStatic() {
  const notes = [];
  const errors = [];
  const renderer = readText("js/admin/inventory/renderers/renderAdjustChannelPreview.js");
  const preview = readText("js/admin/inventory/services/adjustChannelPreview.js");
  const controller = readText("js/admin/inventory/ui/adjustModalChannelPreview.js");
  const panel = readText("js/admin/inventory/renderers/renderAdjustResultPanel.js");
  const orch = readText("js/admin/inventory/services/adjustChannelOrchestrator.js");

  if (!renderer.includes("ADJUST_SYNC_TOGGLE_LABEL")) errors.push("Toggle label constant missing");
  if (!renderer.includes("Sync marketplaces after stock adjustment")) errors.push("Toggle label copy missing");
  if (!renderer.includes("Marketplace failures do not undo the stock adjustment")) {
    errors.push("Toggle helper copy missing");
  }
  notes.push("Toggle label + helper copy present");

  if (!controller.includes("syncToggleUserSet")) errors.push("Manual toggle preservation flag missing");
  if (!controller.includes("markAdjustSyncToggleUserSet")) errors.push("markAdjustSyncToggleUserSet missing");
  notes.push("Manual toggle override preserved");

  if (!preview.includes("computeSyncToggleDefault")) errors.push("computeSyncToggleDefault missing");
  for (const token of ["update_qty", "inactive_can_update", "qty_cache_missing", "ended_needs_relist", "ready_to_relist"]) {
    if (!preview.includes(token)) errors.push(`Toggle default rule token missing: ${token}`);
  }
  notes.push("Toggle default rules in preview service");

  const previewLabels = [
    "KK stock will update immediately",
    "Amazon quantity will update",
    "Amazon inactive offer can be restored",
    "Amazon FBA listing skipped",
    "No Amazon mapping",
    "eBay quantity will update",
    "eBay cache will refresh before sync",
    "eBay ended listing can be relisted",
    "eBay variation requires manual handling",
    "No eBay mapping",
  ];
  for (const label of previewLabels) {
    if (!preview.includes(label)) errors.push(`Preview label missing: ${label}`);
  }
  notes.push(`Preview labels: ${previewLabels.length}/${previewLabels.length}`);

  const cardOrder = panel.indexOf('label: "KK"');
  const amzOrder = panel.indexOf('label: "Amazon"');
  const ebayOrder = panel.indexOf('label: "eBay"');
  if (!(cardOrder < amzOrder && amzOrder < ebayOrder)) errors.push("Result cards must be KK → Amazon → eBay");
  if (!panel.includes("data-adjust-result-partial")) errors.push("Partial-success banner missing");
  if (!panel.includes("ADJUST_NO_ROLLBACK_COPY")) errors.push("No-rollback note missing");
  if (!panel.includes('dry_run: "Preview only"')) errors.push("dry_run status label must be Preview only");
  if (!panel.includes("border-amber-200 bg-amber-50") || !panel.includes("dry_run")) {
    errors.push("dry_run must use amber/info tone");
  }
  if (!panel.includes("Retry via Sync Channels") || !panel.includes("data-adjust-result-link")) {
    errors.push("Retry/next-step links missing");
  }
  notes.push("Result panel order, banner, dry_run styling, links");

  if (!readText(PLAN_DOC).includes("10T follow-up checklist deferred")) {
    errors.push("Plan must document 10T checklist deferral");
  }
  if (readText("js/admin/inventory/ui/adjustModal.js").includes("restockFollowupChecklist")) {
    errors.push("10T checklist must not be wired into adjust modal in 059E.3");
  }
  notes.push("10T follow-up checklist intentionally deferred");

  for (const rel of ADJUST_FLOW) {
    if (/fetchChannelSyncPreview|issueSnapshot|refreshIssueSnapshot/.test(readText(rel))) {
      errors.push(`${rel}: forbidden heavy read`);
    }
  }
  const adjustCalls = (orch.match(/await adjustInventory\(/g) || []).length;
  if (adjustCalls !== 1) errors.push(`adjust_inventory sole writer (found ${adjustCalls})`);
  if (/rollbackStock|undoAdjust|reverseAdjustment/.test(orch)) errors.push("Stock rollback pattern in orchestrator");

  if (!readText(PLAN_DOC).includes("verify-inventory-phase059e3-operator-ux-polish.mjs")) {
    errors.push("Plan doc must reference 059E.3 verify script");
  }

  for (const { script, args } of [
    { script: "verify-inventory-phase059e1-end-to-end-integration.mjs", args: ["--static"] },
    { script: "verify-inventory-phase059e2-failure-rollback-clarity.mjs", args: ["--static"] },
  ]) {
    const r = spawnScript(script, 120_000, args);
    if (r.ok) notes.push(`${script} static regression PASS`);
    else errors.push(`${script} static regression FAIL${r.detail ? `: ${r.detail}` : ""}`);
  }

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

    await page.route("**/rest/v1/v_inventory_channel_sync_candidates**", async (route) => {
      const body = route.request().postDataJSON?.() ?? null;
      void body;
      const scenario = /** @type {string} */ (await page.evaluate(() => window.__e3Scenario || "safe"));
      const rows = {
        safe: {
          variant_id: "v1",
          product_id: "p1",
          available_qty: 6,
          on_hand_qty: 6,
          reserved_qty: 0,
          amazon_sync_action: "update_qty",
          ebay_sync_action: "no_change",
        },
        manual: {
          variant_id: "v1",
          product_id: "p1",
          available_qty: 6,
          on_hand_qty: 6,
          reserved_qty: 0,
          amazon_sync_action: "no_change",
          ebay_sync_action: "unsupported_variation",
        },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(rows[scenario] || rows.safe),
      });
    });

    // Safe candidate — toggle ON
    await page.evaluate(() => {
      window.__e3Scenario = "safe";
    });
    await page.locator('[data-inventory-action="adjust-stock"]').first().click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15_000 });
    await page.waitForFunction(
      () => !document.querySelector("[data-adjust-channel-loading]"),
      { timeout: 15_000 },
    );
    const toggle = page.locator("[data-adjust-sync-toggle]");
    if (!(await toggle.isChecked())) errors.push("Safe candidate: sync toggle should default ON");
    else notes.push("Safe candidate: toggle defaults ON");
    const toggleLabel = await page.locator("[data-adjust-sync-toggle-wrap]").innerText();
    if (!/Sync marketplaces after stock adjustment/i.test(toggleLabel)) {
      errors.push("Toggle label not visible in modal");
    } else notes.push("Toggle label visible");

    await closeAdjustModal(page);

    // Manual-only — toggle OFF
    await page.evaluate(() => {
      window.__e3Scenario = "manual";
    });
    await page.locator('[data-inventory-action="adjust-stock"]').first().click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15_000 });
    await page.waitForFunction(
      () => !document.querySelector("[data-adjust-channel-loading]"),
      { timeout: 15_000 },
    );
    const manualToggle = page.locator("[data-adjust-sync-toggle]");
    if (await manualToggle.isChecked()) errors.push("Manual-only candidate: toggle should default OFF");
    else notes.push("Manual-only candidate: toggle defaults OFF");
    const ebayCard = await page.locator("[data-adjust-channel-card='ebay']").innerText();
    if (!/manual handling/i.test(ebayCard)) errors.push("Manual eBay preview copy missing");

    await closeAdjustModal(page);

    // User override: on safe path, uncheck then change qty
    await page.evaluate(() => {
      window.__e3Scenario = "safe";
    });
    await page.locator('[data-inventory-action="adjust-stock"]').first().click({ timeout: 15_000 });
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector("[data-adjust-channel-loading]"), { timeout: 15_000 });
    const overrideToggle = page.locator("[data-adjust-sync-toggle]");
    await overrideToggle.evaluate((el) => {
      if (!(el instanceof HTMLInputElement)) return;
      el.checked = false;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.fill("#inventoryAdjustQty", "2");
    await page.waitForTimeout(100);
    if (await overrideToggle.isChecked()) errors.push("User toggle OFF should be preserved");
    else notes.push("User toggle override preserved");

    // Result panel smoke
    const panelHtml = await page.evaluate(async () => {
      const { renderAdjustResultPanel } = await import("/js/admin/inventory/renderers/renderAdjustResultPanel.js");
      const row = { id: "v1", title: "T", variant: "D", internalSku: "KK-T", onHand: 5, reserved: 0, shortSku: "KKT" };
      const allClear = {
        orchestrationId: "o1",
        syncChannelsEnabled: true,
        kk: { status: "success", message: "KK stock was adjusted successfully.", ledgerId: "l", stockAfter: 6, delta: 1, stockBefore: 5 },
        amazon: { status: "success", action: "update_qty", message: "Amazon FBM quantity sync requested." },
        ebay: { status: "skipped", action: "no_change", message: "skip" },
        warnings: [],
        errors: [],
      };
      const partial = {
        ...allClear,
        amazon: { status: "failed", action: "update_qty", message: "Amazon sync failed. KK stock remains adjusted." },
      };
      const dryRun = {
        ...allClear,
        amazon: { status: "dry_run", action: "inactive_can_update", message: "Amazon sync was previewed only. Live Amazon patching is disabled." },
      };
      return {
        allClear: renderAdjustResultPanel(allClear, row),
        partial: renderAdjustResultPanel(partial, row),
        dryRun: renderAdjustResultPanel(dryRun, row),
      };
    });
    if (panelHtml.allClear.includes("data-adjust-result-partial")) {
      errors.push("All-clear flow should not show partial banner");
    } else notes.push("All-clear flow not cluttered");
    if (!panelHtml.partial.includes("data-adjust-result-partial")) errors.push("Partial failure banner missing");
    else notes.push("Partial failure banner renders");
    if (!panelHtml.dryRun.includes("Preview only") || !panelHtml.dryRun.includes("border-amber-200")) {
      errors.push("dry_run should render as Preview only with amber tone");
    } else notes.push("dry_run uses info/warning styling");

    await closeAdjustModal(page);

    const benign = consoleErrors.filter(
      (e) => !/favicon|404|Failed to load resource|\[adminNav\]/i.test(e),
    );
    if (benign.length) errors.push(`Console: ${benign.slice(0, 2).join(" | ")}`);
    else notes.push("No significant console errors");
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

  console.log("\n=== Phase 059E.3 — Operator UX Polish ===\n");
  const errors = [];

  if (flags.runStatic) {
    const s = verifyStatic();
    console.log("--- Static UX audit ---");
    for (const n of s.notes) console.log(`  ✓ ${n}`);
    for (const e of s.errors) console.log(`  ✗ ${e}`);
    errors.push(...s.errors);
  }

  if (flags.runBrowser) {
    const b = await verifyBrowser(env);
    console.log("\n--- Browser smoke ---");
    for (const n of b.notes) console.log(`  ✓ ${n}`);
    for (const e of b.errors) console.log(`  ✗ ${e}`);
    errors.push(...b.errors);
  }

  console.log("\n--- Live marketplace ---");
  console.log("  ○ Skipped (no RUN_* live flags)");

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059E.3 operator UX polish\n");
  console.log("No new marketplace behavior. adjust_inventory remains sole stock writer.");
  console.log("Next subphase: 059E.4 — Production verification\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
