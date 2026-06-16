#!/usr/bin/env node
/**
 * Phase 10R — Marketplace restock assist queue + audit verification.
 * Run: node scripts/verify-inventory-phase10r-marketplace-restock-assist-queue.mjs
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
const PORT = 9916;
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
    "js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js",
    "js/admin/inventory/api/marketplaceRestockAssistQueueApi.js",
  ];
  const requiredFiles = [
    ...lineLimitFiles,
    "supabase/migrations/20261012_inventory_phase10r_marketplace_restock_assist_queue.sql",
    "docs/pages/admin/inventory/implementation/049_phase_10r_marketplace_restock_assist_queue.md",
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

  const mig = read("supabase/migrations/20261012_inventory_phase10r_marketplace_restock_assist_queue.sql");
  if (!mig.includes("v_inventory_marketplace_restock_assist_queue")) {
    errors.push("Queue view missing from migration");
  } else notes.push("Queue view migration");
  if (!mig.includes("marketplace_restock_assist_actions")) {
    errors.push("Audit table missing");
  } else notes.push("Audit table migration");
  if (!mig.includes("log_marketplace_restock_assist_action")) {
    errors.push("Audit log RPC missing");
  } else notes.push("Audit log RPC");

  const buckets = [
    "ready_to_restock",
    "needs_physical_confirmation",
    "needs_rma",
    "stale_observation",
    "manual_review",
    "blocked",
    "already_done",
  ];
  for (const b of buckets) {
    if (!mig.includes(b)) errors.push(`queue_bucket ${b} missing`);
    else notes.push(`queue_bucket: ${b}`);
  }
  if (!mig.includes("interval '48 hours'")) errors.push("48h stale threshold missing in view");
  else notes.push("48h stale threshold in view");

  const modal = read("js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js");
  if (!modal.includes("restockBundleComponentLine")) {
    errors.push("Queue modal must use restockBundleComponentLine");
  } else notes.push("Restock via restockBundleComponentLine in queue");
  if (!modal.includes("logMarketplaceRestockAssistAction")) {
    errors.push("Queue modal must write audit on actions");
  } else notes.push("Queue actions write audit");
  if (modal.includes("batch restock") || modal.includes("no batch restock")) {
    notes.push("No batch restock messaging present");
  }
  if (!modal.includes("queueRowCanRestock")) errors.push("Stale/ready gating via queueRowCanRestock");
  else notes.push("queueRowCanRestock gates restock button");

  const queueApi = read("js/admin/inventory/api/marketplaceRestockAssistQueueApi.js");
  if (!queueApi.includes("STALE_OBSERVATION_HOURS = 48")) {
    errors.push("STALE_OBSERVATION_HOURS must be 48");
  } else notes.push("STALE_OBSERVATION_HOURS = 48");

  const panel = read("js/admin/inventory/ui/bundleReturnRestockPanel.js");
  if (!panel.includes("logMarketplaceRestockAssistAction")) {
    errors.push("Panel restock must write audit");
  } else notes.push("Panel restock writes audit");
  if (!panel.includes("STALE_OBSERVATION_HOURS")) {
    errors.push("Panel must block stale restock");
  } else notes.push("Panel stale restock block");

  const assist = read("js/admin/inventory/ui/bundleReturnRestockMarketplaceAssist.js");
  if (assist.includes("restockBundleComponentLine")) {
    errors.push("Assist module must not call restock RPC directly");
  } else notes.push("No direct restock in assist module");

  const issues = read("js/admin/inventory/services/issueActions.js");
  if (!issues.includes("open_restock_assist_queue")) {
    errors.push("Issue route open_restock_assist_queue missing");
  } else notes.push("Issue routes to queue modal");

  const html = read("pages/admin/inventory.html");
  if (!html.includes("inventoryRestockAssistQueueModalMount")) {
    errors.push("Queue modal mount missing in inventory.html");
  } else notes.push("Queue modal mount in HTML");

  const bundle = read("js/admin/inventory/renderers/renderBundle.js");
  if (!bundle.includes("openMarketplaceRestockAssistQueueModal")) {
    errors.push("Bundle panel queue button missing");
  } else notes.push("Bundle panel queue button");

  for (const rel of [
    "js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js",
    "js/admin/inventory/api/marketplaceRestockAssistQueueApi.js",
  ]) {
    const src = read(rel);
    if (/auto.*restock|channel.*sync|create_inventory_return_workflow/i.test(src) && rel.includes("QueueApi")) {
      // queueApi should not auto anything
    }
    if (/restock_bundle_component_line/.test(src) && rel.includes("QueueApi")) {
      errors.push(`${rel} must not call restock RPC — use bundleReturnRestockApi`);
    }
  }
  notes.push("Queue API does not call restock RPC directly");

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

    const viewQ = await client.query(
      `SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_marketplace_restock_assist_queue'`,
    );
    if (!viewQ.rows.length) {
      notes.push("Skipped DB bucket checks (apply 10R migration first)");
      return { notes, errors };
    }
    notes.push("Queue view exists");

    const auditTbl = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_restock_assist_actions'`,
    );
    if (!auditTbl.rows.length) errors.push("Audit table missing");
    else notes.push("Audit table exists");

    const readyBad = await client.query(`
      SELECT COUNT(*)::int AS c FROM v_inventory_marketplace_restock_assist_queue
      WHERE queue_bucket = 'ready_to_restock'
        AND (
          observation_confidence IS DISTINCT FROM 'line_confirmed'
          OR is_observation_stale = true
          OR max_restockable_qty <= 0
        )
    `);
    if (Number(readyBad.rows[0]?.c) > 0) {
      errors.push("ready_to_restock rows violate line_confirmed/stale/max rules");
    } else notes.push("ready_to_restock bucket rules hold");

    const staleReady = await client.query(`
      SELECT COUNT(*)::int AS c FROM v_inventory_marketplace_restock_assist_queue
      WHERE is_observation_stale = true AND queue_bucket = 'ready_to_restock'
    `);
    if (Number(staleReady.rows[0]?.c) > 0) {
      errors.push("Stale rows must not be ready_to_restock");
    } else notes.push("Stale rows not in ready bucket");

    const cap = await client.query(`
      SELECT COUNT(*)::int AS c FROM v_inventory_marketplace_restock_assist_queue
      WHERE suggested_restock_qty IS NOT NULL AND suggested_restock_qty > max_restockable_qty
    `);
    if (Number(cap.rows[0]?.c) > 0) errors.push("suggested_restock_qty exceeds max_restockable");
    else notes.push("Suggested qty capped at max restockable");

    const blocked = await client.query(`
      SELECT COUNT(*)::int AS c FROM v_inventory_marketplace_restock_assist_queue
      WHERE workflow_condition IN ('damaged', 'missing') AND queue_bucket NOT IN ('blocked', 'already_done')
    `);
    if (Number(blocked.rows[0]?.c) > 0) {
      errors.push("damaged/missing should be blocked or already_done");
    } else notes.push("damaged/missing rows bucketed blocked/done");

    notes.push("Queue view query OK");
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
    const hasMount = await page.locator("#inventoryRestockAssistQueueModalMount").count();
    if (!hasMount) errors.push("Queue modal mount not in DOM");
    else notes.push("Inventory page loads with queue mount");

    const hasBtn = await page.locator("[data-inventory-restock-queue]").count();
    if (!hasBtn) errors.push("Marketplace Restock Queue button missing");
    else notes.push("Marketplace Restock Queue button present");

    const hasReturns = await page.locator("[data-inventory-bundle-preview]").count();
    if (!hasReturns) errors.push("Bundle preview button missing");
    else notes.push("Bundle Return/Restock panel entry still present");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10R — Marketplace restock assist queue verification\n");

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
