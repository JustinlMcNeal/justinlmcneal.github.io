#!/usr/bin/env node
/**
 * Phase 10Q — Marketplace restock assist verification.
 * Run: node scripts/verify-inventory-phase10q-marketplace-restock-assist.mjs
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
const LINE_ITEMS_PAGE = "/pages/admin/lineItemsOrders.html";
const PORT = 9915;
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
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
    "js/admin/inventory/ui/bundleReturnRestockMarketplaceAssist.js",
    "js/admin/inventory/api/marketplaceRestockAssistApi.js",
  ];
  const files = [
    ...lineLimitFiles,
    "supabase/migrations/20261011_inventory_phase10q_marketplace_restock_assist.sql",
    "docs/pages/admin/inventory/implementation/048_phase_10q_marketplace_restock_assist.md",
  ];

  for (const rel of files) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lineLimitFiles.includes(rel) && lines > MAX_LINES) {
        errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
      } else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const mig = read("supabase/migrations/20261011_inventory_phase10q_marketplace_restock_assist.sql");
  if (!mig.includes("v_inventory_marketplace_restock_assist_candidates")) {
    errors.push("Assist candidates view missing");
  } else notes.push("Assist candidates view migration");
  for (const status of [
    "eligible_line_confirmed",
    "needs_rma_workflow",
    "needs_physical_return_confirmation",
    "sku_inferred_manual_review",
    "order_level_manual_review",
    "afn_external_review",
  ]) {
    if (!mig.includes(status)) errors.push(`assist_status ${status} missing`);
    else notes.push(`assist_status: ${status}`);
  }
  if (!mig.includes("physical_return_confirmed_at")) errors.push("physical return confirmation columns missing");
  else notes.push("physical return confirmation fields");
  if (!mig.includes("marketplace_observation_stale")) errors.push("stale observation issue missing");
  else notes.push("marketplace_observation_stale issue group");
  if (mig.includes("LEAST") && mig.includes("max_restockable_qty")) {
    notes.push("suggested qty capped by max_restockable");
  } else {
    errors.push("suggested qty must cap at max_restockable");
  }

  const panel = read("js/admin/inventory/ui/bundleReturnRestockPanel.js");
  if (!panel.includes("restock_bundle_component_line") && !panel.includes("restockBundleComponentLine")) {
    errors.push("Panel must use restock_bundle_component_line RPC");
  } else notes.push("Restock via restockBundleComponentLine");
  if (!panel.includes("physically returned and is resellable")) {
    errors.push("Panel must require physical return confirmation copy");
  } else notes.push("Physical return confirmation copy");
  if (!panel.includes("renderMarketplaceAssistBlock")) errors.push("Marketplace assist UI missing");
  else notes.push("Marketplace assist UI wired");

  const assist = read("js/admin/inventory/ui/bundleReturnRestockMarketplaceAssist.js");
  if (assist.includes("restock_bundle_component_line")) {
    errors.push("Assist module must not call restock RPC directly");
  } else notes.push("No direct restock RPC in assist module");

  const wfApi = read("js/admin/inventory/api/returnWorkflowApi.js");
  if (!wfApi.includes("confirmPhysicalReturn")) errors.push("confirmPhysicalReturn API missing");
  else notes.push("confirmPhysicalReturn API");

  const issues = read("js/admin/inventory/services/issueActions.js");
  if (!issues.includes("marketplace_observation_stale")) errors.push("Stale issue action missing");
  else notes.push("Stale observation issue routing");

  const forbidden = [
    "js/admin/inventory/ui/bundleReturnRestockMarketplaceAssist.js",
    "js/admin/inventory/api/marketplaceRestockAssistApi.js",
  ];
  for (const rel of forbidden) {
    const src = read(rel);
    if (/create_inventory_return_workflow|auto.*restock|channel.*sync/i.test(src)) {
      errors.push(`${rel} must not auto-create RMA or auto-restock`);
    }
  }
  notes.push("No auto-RMA/auto-restock in assist paths");

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
    const view = await client.query(
      `SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_marketplace_restock_assist_candidates'`,
    );
    if (!view.rows.length) {
      notes.push("Skipped DB (apply 10Q migration first)");
      return { notes, errors };
    }

    const col = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_return_workflow' AND column_name = 'physical_return_confirmed_at'
    `);
    if (!col.rows.length) errors.push("physical_return_confirmed_at column missing");
    else notes.push("Workflow physical return column exists");

    const skuRow = await client.query(`
      SELECT assist_status, suggested_restock_qty, max_restockable_qty
      FROM v_inventory_marketplace_restock_assist_candidates
      WHERE observation_confidence = 'sku_inferred'
      LIMIT 1
    `);
    if (skuRow.rows[0]?.suggested_restock_qty != null) {
      errors.push("sku_inferred must not prefill suggested_restock_qty");
    } else notes.push("sku_inferred rows omit suggested qty prefill");

    const cap = await client.query(`
      SELECT COUNT(*)::int AS c FROM v_inventory_marketplace_restock_assist_candidates
      WHERE suggested_restock_qty IS NOT NULL AND suggested_restock_qty > max_restockable_qty
    `);
    if (Number(cap.rows[0]?.c) > 0) errors.push("suggested_restock_qty exceeds max_restockable");
    else notes.push("suggested qty never exceeds max restockable");

    notes.push("Assist view query OK");
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
    await page.goto(`http://127.0.0.1:${PORT}${LINE_ITEMS_PAGE}`, { waitUntil: "domcontentloaded" });
    notes.push("Line Items page loads");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10Q — Marketplace restock assist verification\n");

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
