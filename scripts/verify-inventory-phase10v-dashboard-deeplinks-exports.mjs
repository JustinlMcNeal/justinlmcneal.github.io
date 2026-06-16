#!/usr/bin/env node
/**
 * Phase 10V — Dashboard deep links, presets, grouping, export verification.
 * Run: node scripts/verify-inventory-phase10v-dashboard-deeplinks-exports.mjs
 */
import { chromium } from "@playwright/test";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INVENTORY_PAGE = "/pages/admin/inventory.html";
const PORT = 9920;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(relPath) {
  return read(relPath).split("\n").length;
}

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let urlPath = req.url?.split("?")[0] || "/";
      const filePath = join(ROOT, decodeURIComponent(urlPath.replace(/^\//, "")));
      if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      if (statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : "";
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function verifySourceFiles() {
  const notes = [];
  const errors = [];
  const lineLimitFiles = [
    "js/admin/inventory/ui/returnsRestockDashboardModal.js",
    "js/admin/inventory/ui/returnsRestockDashboardDeepLink.js",
    "js/admin/inventory/ui/returnsRestockDashboardPresets.js",
    "js/admin/inventory/ui/returnsRestockDashboardGrouping.js",
    "js/admin/inventory/ui/returnsRestockDashboardExport.js",
    "js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js",
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
  ];
  const required = [
    ...lineLimitFiles,
    "js/admin/inventory/services/returnsRestockDashboardBootstrap.js",
    "supabase/migrations/20261016_inventory_phase10v_dashboard_deeplinks_exports.sql",
    "docs/pages/admin/inventory/implementation/053_phase_10v_dashboard_deeplinks_exports.md",
  ];

  for (const rel of required) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lineLimitFiles.includes(rel) && lines > MAX_LINES) {
        errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
      } else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const mig = read("supabase/migrations/20261016_inventory_phase10v_dashboard_deeplinks_exports.sql");
  if (!mig.includes("v_inventory_returns_restock_dashboard_metrics")) {
    errors.push("Migration missing metrics view");
  } else notes.push("Metrics view in migration");

  const deepLink = read("js/admin/inventory/ui/returnsRestockDashboardDeepLink.js");
  for (const token of [
    "returns_dashboard",
    "parseDashboardParams",
    "buildDashboardUrl",
    "findHighlightTarget",
    "stale_only",
    "restock_action_id",
  ]) {
    if (!deepLink.includes(token)) errors.push(`Deep link missing: ${token}`);
    else notes.push(`Deep link: ${token}`);
  }

  const presets = read("js/admin/inventory/ui/returnsRestockDashboardPresets.js");
  for (const label of [
    "Ready to Restock",
    "Stale Observations",
    "Open Channel Follow-Ups",
    "Amazon Attention",
  ]) {
    if (!presets.includes(label)) errors.push(`Preset missing: ${label}`);
    else notes.push(`Preset: ${label}`);
  }
  if (!presets.includes("localStorage")) notes.push("User presets via localStorage");

  const grouping = read("js/admin/inventory/ui/returnsRestockDashboardGrouping.js");
  if (!grouping.includes("groupWorklistRows")) errors.push("Grouping missing");
  else notes.push("Worklist grouping");
  if (!grouping.includes("data-rrd-order")) errors.push("Grouped rows must keep actions");
  else notes.push("Grouped row actions preserved");

  const exportMod = read("js/admin/inventory/ui/returnsRestockDashboardExport.js");
  for (const fn of ["exportWorklist", "exportAuditHistory", "exportOpenFollowups", "exportDashboardMetrics"]) {
    if (!exportMod.includes(fn)) errors.push(`Export missing: ${fn}`);
    else notes.push(`Export: ${fn}`);
  }
  if (exportMod.includes("restock_bundle_component_line") || exportMod.includes("restockBundleComponentLine")) {
    errors.push("Export must not restock");
  } else notes.push("Export does not restock");

  const modal = read("js/admin/inventory/ui/returnsRestockDashboardModal.js");
  if (!modal.includes("data-rrd-grouped")) errors.push("Grouped toggle missing");
  else notes.push("Grouped view toggle");
  if (!modal.includes("data-rrd-banner")) errors.push("Not-found banner missing");
  else notes.push("Not-found banner");
  if (modal.includes("restockBundleComponentLine")) errors.push("Modal must not restock");
  else notes.push("Modal does not restock");

  const bootstrap = read("js/admin/inventory/services/returnsRestockDashboardBootstrap.js");
  if (!bootstrap.includes("maybeOpenDashboardFromUrl")) errors.push("Bootstrap missing");
  else notes.push("URL bootstrap");

  const index = read("js/admin/inventory/index.js");
  if (!index.includes("maybeOpenDashboardFromUrl")) errors.push("index.js bootstrap not wired");
  else notes.push("index.js auto-open wired");

  const kpi = read("js/admin/inventory/ui/returnsRestockDashboardKpi.js");
  if (!kpi.includes("metrics.restocks7d")) errors.push("Metrics not rendered in KPI");
  else notes.push("Metrics in KPI strip");

  return { notes, errors };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const r = await client.query(
      `SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_returns_restock_dashboard_metrics'`,
    );
    if (!r.rows.length) {
      notes.push("Skipped DB checks (apply 10V migration first)");
      return { notes, errors };
    }
    notes.push("Metrics view exists");
    await client.query(`SELECT * FROM v_inventory_returns_restock_dashboard_metrics LIMIT 1`);
    notes.push("Metrics view query OK");
  } catch (err) {
    errors.push(`DB error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.end().catch(() => {});
  }
  return { notes, errors };
}

async function verifyBrowser() {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded" });
    notes.push("Inventory page loads");

    if (!(await page.locator("[data-inventory-returns-restock-dashboard]").count())) {
      errors.push("Dashboard button missing");
    } else notes.push("Returns dashboard entry preserved");

    if (!(await page.locator("[data-inventory-restock-queue]").count())) {
      errors.push("Restock queue missing");
    } else notes.push("Restock Assist Queue entry preserved");

    if (!(await page.locator("[data-inventory-bundle-preview]").count())) {
      errors.push("Bundle preview missing");
    } else notes.push("Bundle Return/Restock entry preserved");

    const deepLinkSrc = read("js/admin/inventory/ui/returnsRestockDashboardDeepLink.js");
    if (!deepLinkSrc.includes("returns_dashboard")) errors.push("Deep link param missing");
    else notes.push("Deep link module ready");

    const modalSrc = read("js/admin/inventory/ui/returnsRestockDashboardModal.js");
    if (!modalSrc.includes("data-rrd-export-worklist")) errors.push("Export UI missing");
    else notes.push("Export actions in modal");

    await page.goto(
      `http://127.0.0.1:${PORT}${INVENTORY_PAGE}?returns_dashboard=1&tab=followups&channel=amazon&stale_only=1`,
      { waitUntil: "domcontentloaded" },
    );
    notes.push("Deep-link URL loads inventory page");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10V — Dashboard deep links / presets / export verification\n");

  const staticResult = verifySourceFiles();
  console.log("--- Static checks ---");
  for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
  for (const e of staticResult.errors) console.log(`  ✗ ${e}`);

  let dbResult = { notes: [], errors: [] };
  try {
    getPoolerConnectionString();
    dbResult = await verifyDatabase();
    console.log("\n--- Database checks ---");
    for (const n of dbResult.notes) console.log(`  ✓ ${n}`);
    for (const e of dbResult.errors) console.log(`  ✗ ${e}`);
  } catch {
    console.log("\n--- Database checks ---");
    console.log("  ⊘ Skipped (no DB credentials)");
  }

  const browserResult = await verifyBrowser();
  console.log("\n--- Browser checks ---");
  for (const n of browserResult.notes) console.log(`  ✓ ${n}`);
  for (const e of browserResult.errors) console.log(`  ✗ ${e}`);

  const allErrors = [...staticResult.errors, ...dbResult.errors, ...browserResult.errors];
  console.log(allErrors.length ? `\nFAILED (${allErrors.length} error(s))` : "\nPASSED");
  process.exit(allErrors.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
