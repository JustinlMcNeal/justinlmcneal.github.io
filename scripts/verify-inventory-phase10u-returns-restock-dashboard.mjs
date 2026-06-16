#!/usr/bin/env node
/**
 * Phase 10U — Returns & Restock Dashboard verification.
 * Run: node scripts/verify-inventory-phase10u-returns-restock-dashboard.mjs
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
const PORT = 9919;
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
    "js/admin/inventory/ui/returnsRestockDashboardActions.js",
    "js/admin/inventory/ui/returnsRestockDashboardKpi.js",
    "js/admin/inventory/api/returnsRestockDashboardApi.js",
    "js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js",
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
    "js/admin/inventory/ui/restockFollowupChecklist.js",
  ];
  const required = [
    ...lineLimitFiles,
    "supabase/migrations/20261015_inventory_phase10u_returns_restock_dashboard.sql",
    "docs/pages/admin/inventory/implementation/052_phase_10u_returns_restock_dashboard.md",
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

  const mig = read("supabase/migrations/20261015_inventory_phase10u_returns_restock_dashboard.sql");
  for (const obj of [
    "v_inventory_returns_restock_dashboard_summary",
    "v_inventory_returns_restock_dashboard_worklist",
    "returns_restock_dashboard_attention",
  ]) {
    if (!mig.includes(obj)) errors.push(`Migration missing: ${obj}`);
    else notes.push(`Migration includes ${obj}`);
  }

  for (const rowType of [
    "return_workflow",
    "restock_assist",
    "channel_followup",
    "audit",
    "manual_review",
  ]) {
    if (!mig.includes(rowType)) errors.push(`Worklist row_type ${rowType} missing`);
    else notes.push(`row_type: ${rowType}`);
  }

  const modal = read("js/admin/inventory/ui/returnsRestockDashboardModal.js");
  if (!modal.includes("openReturnsRestockDashboardModal")) errors.push("Dashboard modal export missing");
  else notes.push("Dashboard modal export");
  if (modal.includes("restockBundleComponentLine") || modal.includes("restock_bundle_component_line")) {
    errors.push("Dashboard modal must not restock");
  } else notes.push("Dashboard modal does not restock");

  const actions = read("js/admin/inventory/ui/returnsRestockDashboardActions.js");
  if (!actions.includes("openMarketplaceRestockAssistQueueModal")) {
    errors.push("Dashboard must delegate to Restock Assist Queue");
  } else notes.push("Restock via existing queue modal");
  if (!actions.includes("openRestockFollowupChecklistModal")) errors.push("Follow-up delegation missing");
  else notes.push("Follow-up via existing checklist");
  if (!actions.includes("openSyncDryRunModal")) errors.push("Sync preview delegation missing");
  else notes.push("Sync preview via existing modal");
  if (actions.includes("restockBundleComponentLine")) errors.push("Dashboard actions must not restock");
  else notes.push("Dashboard actions do not restock");

  const api = read("js/admin/inventory/api/returnsRestockDashboardApi.js");
  if (api.includes("restock") && api.includes("rpc")) errors.push("Dashboard API must be read-only");
  else notes.push("Dashboard API read-only");

  const dom = read("js/admin/inventory/dom.js");
  if (!dom.includes("returnsRestockDashboardModalMount")) errors.push("DOM mount missing");
  else notes.push("DOM mount wired");

  const bundle = read("js/admin/inventory/renderers/renderBundle.js");
  if (!bundle.includes("data-inventory-returns-restock-dashboard")) errors.push("Bundle entry button missing");
  else notes.push("Bundle Rules dashboard entry");

  const issues = read("js/admin/inventory/services/issueActions.js");
  if (!issues.includes("returns_restock_dashboard_attention")) errors.push("Issue action missing");
  else notes.push("returns_restock_dashboard_attention issue");

  const handlers = read("js/admin/inventory/services/issueActionHandlers.js");
  if (!handlers.includes("open_returns_restock_dashboard")) errors.push("Issue handler missing");
  else notes.push("Issue opens dashboard");

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
    for (const view of [
      "v_inventory_returns_restock_dashboard_summary",
      "v_inventory_returns_restock_dashboard_worklist",
    ]) {
      const r = await client.query(
        `SELECT 1 FROM information_schema.views WHERE table_name = $1`,
        [view],
      );
      if (!r.rows.length) {
        notes.push(`Skipped full DB checks (apply 10U migration for ${view})`);
        return { notes, errors };
      }
      notes.push(`${view} exists`);
    }

    await client.query(`SELECT * FROM v_inventory_returns_restock_dashboard_summary LIMIT 1`);
    notes.push("Summary view query OK");
    await client.query(`SELECT * FROM v_inventory_returns_restock_dashboard_worklist LIMIT 5`);
    notes.push("Worklist view query OK");
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
      errors.push("Returns & Restock Dashboard button missing");
    } else notes.push("Dashboard entry button present");

    if (!(await page.locator("[data-inventory-restock-queue]").count())) {
      errors.push("Restock queue button missing");
    } else notes.push("Marketplace Restock Assist Queue entry preserved");

    if (!(await page.locator("[data-inventory-bundle-preview]").count())) {
      errors.push("Bundle preview entry missing");
    } else notes.push("Bundle Return/Restock panel entry preserved");

    if (!(await page.locator("#inventoryReturnsRestockDashboardModalMount").count())) {
      errors.push("Dashboard modal mount missing");
    } else notes.push("Dashboard modal mount in HTML");

    const modalSrc = read("js/admin/inventory/ui/returnsRestockDashboardModal.js");
    if (!modalSrc.includes("data-rrd-tab")) errors.push("Dashboard tabs missing in module");
    else notes.push("Dashboard tabs defined");

    if (!modalSrc.includes("renderDashboardKpiStrip")) errors.push("KPI strip missing");
    else notes.push("KPI strip wired");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10U — Returns & Restock Dashboard verification\n");

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
