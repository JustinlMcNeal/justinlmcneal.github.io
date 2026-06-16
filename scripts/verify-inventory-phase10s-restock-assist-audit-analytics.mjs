#!/usr/bin/env node
/**
 * Phase 10S — Restock assist audit viewer + queue analytics verification.
 * Run: node scripts/verify-inventory-phase10s-restock-assist-audit-analytics.mjs
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
const PORT = 9917;
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
    "js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js",
    "js/admin/inventory/ui/marketplaceRestockAssistQueueActions.js",
    "js/admin/inventory/ui/marketplaceRestockAssistAuditPanel.js",
    "js/admin/inventory/ui/marketplaceRestockAssistQueueKpi.js",
    "js/admin/inventory/api/marketplaceRestockAssistAnalyticsApi.js",
    "js/admin/inventory/api/marketplaceRestockAssistQueueApi.js",
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
  ];
  const requiredFiles = [
    ...lineLimitFiles,
    "supabase/migrations/20261013_inventory_phase10s_restock_assist_audit_analytics.sql",
    "docs/pages/admin/inventory/implementation/050_phase_10s_restock_assist_audit_analytics.md",
  ];

  for (const rel of requiredFiles) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lineLimitFiles.includes(rel) && lines > MAX_LINES) {
        errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
      } else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const mig = read("supabase/migrations/20261013_inventory_phase10s_restock_assist_audit_analytics.sql");
  for (const obj of [
    "v_inventory_marketplace_restock_assist_queue_summary",
    "v_inventory_marketplace_restock_assist_audit",
    "v_inventory_marketplace_restock_assist_queue_with_triage",
    "marketplace_restock_assist_queue_states",
    "upsert_marketplace_restock_assist_queue_state",
  ]) {
    if (!mig.includes(obj)) errors.push(`Migration missing: ${obj}`);
    else notes.push(`Migration includes ${obj}`);
  }

  const modal = read("js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js");
  if (!modal.includes("renderQueueKpiStrip")) errors.push("KPI strip not wired in modal");
  else notes.push("KPI strip wired");
  if (!modal.includes("Audit History")) errors.push("Audit History tab missing");
  else notes.push("Audit History tab");
  if (!modal.includes("upsertMarketplaceRestockQueueState")) {
    errors.push("Snooze/review must use queue state RPC");
  } else notes.push("Queue state RPC for snooze/review");
  const actions = read("js/admin/inventory/ui/marketplaceRestockAssistQueueActions.js");
  if (!actions.includes("restockBundleComponentLine")) errors.push("Restock must use restockBundleComponentLine");
  else notes.push("Restock via restockBundleComponentLine");
  if (!modal.includes("no batch restock")) notes.push("No batch restock");

  const analyticsApi = read("js/admin/inventory/api/marketplaceRestockAssistAnalyticsApi.js");
  if (analyticsApi.includes("restockBundleComponentLine") || analyticsApi.includes("restock_bundle_component_line")) {
    errors.push("Analytics API must not call restock RPC");
  } else notes.push("Analytics API read-only");
  if (!analyticsApi.includes("fetchMarketplaceRestockAudit")) errors.push("Audit fetch missing");
  else notes.push("Audit fetch API");

  const auditPanel = read("js/admin/inventory/ui/marketplaceRestockAssistAuditPanel.js");
  if (auditPanel.includes("restockBundleComponentLine")) errors.push("Audit panel must be read-only");
  else notes.push("Audit panel read-only");

  const queueApi = read("js/admin/inventory/api/marketplaceRestockAssistQueueApi.js");
  if (!queueApi.includes("v_inventory_marketplace_restock_assist_queue_with_triage")) {
    errors.push("Queue must fetch triage view");
  } else notes.push("Queue uses triage view");

  for (const rel of [
    "js/admin/inventory/api/marketplaceRestockAssistAnalyticsApi.js",
    "js/admin/inventory/ui/marketplaceRestockAssistAuditPanel.js",
  ]) {
    const src = read(rel);
    if (/createReturnWorkflow|create_inventory_return_workflow/i.test(src)) {
      errors.push(`${rel} must not auto-create RMA`);
    }
  }
  notes.push("No auto-RMA in analytics/audit paths");

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

    const summaryView = await client.query(
      `SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_marketplace_restock_assist_queue_summary'`,
    );
    if (!summaryView.rows.length) {
      notes.push("Skipped DB checks (apply 10S migration first)");
      return { notes, errors };
    }
    notes.push("Queue summary view exists");

    const auditView = await client.query(
      `SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_marketplace_restock_assist_audit'`,
    );
    if (!auditView.rows.length) errors.push("Audit view missing");
    else notes.push("Audit view exists");

    const stateTbl = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_restock_assist_queue_states'`,
    );
    if (!stateTbl.rows.length) errors.push("Queue states table missing");
    else notes.push("Queue states table exists");

    const summary = await client.query(`SELECT * FROM v_inventory_marketplace_restock_assist_queue_summary`);
    if (summary.rows[0]) notes.push("Summary view returns aggregate row");
    else errors.push("Summary view empty");

    notes.push("DB checks OK");
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

    const hasQueueBtn = await page.locator("[data-inventory-restock-queue]").count();
    if (!hasQueueBtn) errors.push("Marketplace Restock Queue button missing");
    else notes.push("Marketplace Restock Assist Queue entry present");

    const hasBundle = await page.locator("[data-inventory-bundle-preview]").count();
    if (!hasBundle) errors.push("Bundle Return/Restock entry missing");
    else notes.push("Bundle Return/Restock panel entry present");

    const hasMount = await page.locator("#inventoryRestockAssistQueueModalMount").count();
    if (!hasMount) errors.push("Queue modal mount missing");
    else notes.push("Queue modal mount present");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10S — Restock assist audit analytics verification\n");

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
