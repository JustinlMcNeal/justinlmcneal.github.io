#!/usr/bin/env node
/**
 * Phase 10X — Dashboard pagination verification.
 * Run: node scripts/verify-inventory-phase10x-dashboard-pagination.mjs
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
const PORT = 9922;
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
    "js/admin/inventory/api/returnsRestockDashboardApi.js",
    "js/admin/inventory/ui/returnsRestockDashboardPage.js",
    "js/admin/inventory/ui/returnsRestockDashboardPagination.js",
    "js/admin/inventory/ui/returnsRestockDashboardGrouping.js",
  ];
  const required = [
    ...lineLimitFiles,
    "supabase/migrations/20261018_inventory_phase10x_dashboard_pagination.sql",
    "docs/pages/admin/inventory/implementation/055_phase_10x_dashboard_pagination.md",
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

  const mig = read("supabase/migrations/20261018_inventory_phase10x_dashboard_pagination.sql");
  if (!mig.includes("get_returns_restock_dashboard_worklist_page")) {
    errors.push("Migration missing paginated RPC");
  } else notes.push("Paginated RPC in migration");
  for (const token of ["bucket_counts", "target_found", "p_seek_target", "total_count"]) {
    if (!mig.includes(token)) errors.push(`RPC missing: ${token}`);
    else notes.push(`RPC includes ${token}`);
  }

  const api = read("js/admin/inventory/api/returnsRestockDashboardApi.js");
  if (!api.includes("fetchReturnsRestockDashboardWorklistPage")) errors.push("Page fetch API missing");
  else notes.push("fetchReturnsRestockDashboardWorklistPage");
  if (!api.includes("fetchAllFilteredWorklistRows")) errors.push("Filtered export loop missing");
  else notes.push("Filtered export loop");
  if (api.includes("restock_bundle_component_line")) errors.push("API must not restock");
  else notes.push("API does not restock");

  const modal = read("js/admin/inventory/ui/returnsRestockDashboardModal.js");
  if (!modal.includes("loadWorklistPage")) errors.push("Modal must use paginated loader");
  else notes.push("Modal uses paginated loader");
  if (!modal.includes("data-rrd-prev")) errors.push("Pagination UI missing");
  else notes.push("Pagination UI");
  if (!modal.includes("data-rrd-load-target")) errors.push("Load target button missing");
  else notes.push("Load target row");
  if (!modal.includes("CSV Filtered")) errors.push("Filtered export button missing");
  else notes.push("Filtered export button");
  if (modal.includes("restockBundleComponentLine")) errors.push("Modal must not restock");
  else notes.push("Modal does not restock");

  const deep = read("js/admin/inventory/ui/returnsRestockDashboardDeepLink.js");
  if (!deep.includes("page_size")) errors.push("URL page_size missing");
  else notes.push("URL page_size param");

  const grouping = read("js/admin/inventory/ui/returnsRestockDashboardGrouping.js");
  if (!grouping.includes("data-rrd-order")) errors.push("Grouping must preserve actions");
  else notes.push("Grouped actions preserved");

  const exportMod = read("js/admin/inventory/ui/returnsRestockDashboardExport.js");
  if (!exportMod.includes("exportFilteredWorklist")) errors.push("exportFilteredWorklist missing");
  else notes.push("exportFilteredWorklist");

  const digest = read("js/admin/inventory/ui/returnsRestockDigestPreview.js");
  if (!digest.includes("previewReturnsRestockDigest")) errors.push("Digest preview missing");
  else notes.push("Digest preview preserved");

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
      `SELECT 1 FROM pg_proc WHERE proname = 'get_returns_restock_dashboard_worklist_page'`,
    );
    if (!r.rows.length) {
      notes.push("Skipped RPC test (apply 10X migration first)");
      return { notes, errors };
    }
    notes.push("Paginated RPC exists");
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
      errors.push("Dashboard entry missing");
    } else notes.push("Dashboard entry");

    await page.goto(
      `http://127.0.0.1:${PORT}${INVENTORY_PAGE}?returns_dashboard=1&tab=ready&page=2&page_size=50`,
      { waitUntil: "domcontentloaded" },
    );
    notes.push("Deep-link pagination URL loads");

    if (!(await page.locator("#inventoryReturnsRestockDigestPreviewMount").count())) {
      errors.push("Digest mount missing");
    } else notes.push("Digest preview mount");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10X — Dashboard pagination verification\n");

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
