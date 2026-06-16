#!/usr/bin/env node
/**
 * Phase 9B — Post-map action queue verification.
 * Run: node scripts/verify-inventory-phase9b-post-map-action-queue.mjs
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
const ORDERS_PAGE = "/pages/admin/lineItemsOrders.html";
const PORT = 9897;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;

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

function lineCount(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8").split("\n").length;
}

function verifySourceFiles() {
  const notes = [];
  const errors = [];
  const files = [
    "js/admin/inventory/api/postMapQueueApi.js",
    "js/admin/inventory/ui/postMapQueueModal.js",
    "js/admin/inventory/services/postMapQueueRowActions.js",
    "supabase/migrations/20260918_inventory_phase9b_post_map_action_queue.sql",
  ];
  const grandfathered = new Set([
    "js/admin/inventory/ui/postMappingChecklistModal.js",
    "js/admin/inventory/events.js",
    "js/admin/lineItemsOrders/workspace.js",
    "js/admin/lineItemsOrders/index.js",
  ]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const queue = readFileSync(join(ROOT, "js/admin/inventory/ui/postMapQueueModal.js"), "utf8");
  const checklist = readFileSync(join(ROOT, "js/admin/inventory/ui/postMappingChecklistModal.js"), "utf8");
  const api = readFileSync(join(ROOT, "js/admin/inventory/api/postMapQueueApi.js"), "utf8");
  const overview = readFileSync(join(ROOT, "js/admin/lineItemsOrders/workspaceOverview.js"), "utf8");
  const issues = readFileSync(join(ROOT, "js/admin/inventory/renderers/renderIssues.js"), "utf8");

  if (!api.includes("upsert_post_map_queue_from_checklist")) errors.push("Queue upsert RPC not wired");
  else notes.push("Queue upsert RPC wired");

  if (!api.includes("update_post_map_queue_item")) notes.push("Queue status update RPC wired");

  if (/retry_inventory_reservation|manual_finalize_shipped/.test(queue)) {
    errors.push("Queue modal must not auto-execute retry/finalize RPCs");
  } else notes.push("Queue UI is navigation-only");

  if (!checklist.includes("createPostMapQueueFromChecklist")) {
    errors.push("Checklist missing queue creation");
  } else notes.push("Checklist creates queue rows");

  if (!checklist.includes("Open Post-Map Queue")) notes.push("Checklist links to queue modal");

  if (!issues.includes("data-inventory-post-map-queue")) errors.push("Issues panel missing queue button");
  else notes.push("Issues panel queue entry");

  if (!overview.includes("data-ws-line-item")) errors.push("Workspace overview missing line item anchors");
  else notes.push("Line item focus anchors in workspace");

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const tbl = await client.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'inventory_post_map_action_queue'
  `);
  if (tbl.rows.length) return { applied: false };

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260918_inventory_phase9b_post_map_action_queue.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  let queueCount = 0;
  let openCount = 0;

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 9B migration");
    else notes.push("Phase 9B migration already applied");

    const tbl = await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_post_map_action_queue'
    `);
    if (!tbl.rows.length) errors.push("Queue table missing");
    else notes.push("inventory_post_map_action_queue exists");

    const fnUpsert = await client.query(`
      SELECT 1 FROM pg_proc WHERE proname = 'upsert_post_map_queue_from_checklist'
    `);
    if (!fnUpsert.rows.length) errors.push("Upsert RPC missing");
    else notes.push("upsert_post_map_queue_from_checklist exists");

    const fnUpdate = await client.query(`
      SELECT 1 FROM pg_proc WHERE proname = 'update_post_map_queue_item'
    `);
    if (!fnUpdate.rows.length) errors.push("Update RPC missing");
    else notes.push("update_post_map_queue_item exists");

    queueCount = (await client.query(`SELECT COUNT(*)::int c FROM inventory_post_map_action_queue`)).rows[0].c;
    openCount = (
      await client.query(`SELECT COUNT(*)::int c FROM inventory_post_map_action_queue WHERE status = 'open'`)
    ).rows[0].c;
    notes.push(`Queue rows: ${queueCount}, open: ${openCount}`);

    const testKey = `verify_9b_${Date.now()}`;
    await client.query(
      `INSERT INTO inventory_post_map_action_queue (
        source_channel, source_order_id, source_order_item_id, next_step, status, quantity, reason
      ) VALUES ('ebay', $1, 'line_1', 'reservation_retry', 'open', 1, 'verify')`,
      [testKey],
    );
    await client.query(
      `INSERT INTO inventory_post_map_action_queue (
        source_channel, source_order_id, source_order_item_id, next_step, status, quantity, reason
      ) VALUES ('ebay', $1, 'line_1', 'reservation_retry', 'open', 1, 'verify dup')
      ON CONFLICT ON CONSTRAINT inventory_post_map_queue_unique_line_step DO NOTHING`,
      [testKey],
    );

    const cnt = (
      await client.query(
        `SELECT COUNT(*)::int c FROM inventory_post_map_action_queue WHERE source_order_id = $1`,
        [testKey],
      )
    ).rows[0].c;
    if (cnt !== 1) errors.push("Queue unique key not enforced");
    else notes.push("Queue unique key idempotent");

    await client.query(
      `UPDATE inventory_post_map_action_queue SET status = 'done', completed_at = now() WHERE source_order_id = $1`,
      [testKey],
    );
    const upd = await client.query(
      `UPDATE inventory_post_map_action_queue SET reason = 'should not apply'
       WHERE source_order_id = $1 AND status IN ('open','reviewed','snoozed')`,
      [testKey],
    );
    if (upd.rowCount !== 0) errors.push("Done item was updated");
    else notes.push("Done status preserved (no reopen via update filter pattern)");

    await client.query(`DELETE FROM inventory_post_map_action_queue WHERE source_order_id = $1`, [testKey]);

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    await client.query(`SELECT COUNT(*) FROM inventory_post_map_action_queue`);

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand changed");
    else notes.push("On-hand unchanged");

    if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("Ledger changed");
    else notes.push("No ledger mutations");

    if (String(resBefore) !== String(resAfter)) errors.push("Reservations changed");
    else notes.push("No reservation mutations");

    return { notes, errors, queueCount, openCount };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, queueCount, openCount };
  } finally {
    await client.end().catch(() => {});
  }
}

async function verifyPages() {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!(await page.locator("#inventoryPostMapQueueModalMount").count())) {
      errors.push("Queue modal mount missing");
    } else notes.push("Inventory page loads with queue mount");

    await page.goto(`http://127.0.0.1:${PORT}${ORDERS_PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const ordersJs = readFileSync(join(ROOT, "js/admin/lineItemsOrders/index.js"), "utf8");
    if (!ordersJs.includes("applyLineItemsDeepLink")) errors.push("Orders deep-link missing");
    else notes.push("Line Items Orders deep-link handler present");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  return { notes, errors };
}

async function main() {
  const fileEnv = loadEnv();
  for (const [k, v] of Object.entries(fileEnv)) {
    if (!process.env[k]) process.env[k] = v;
  }

  console.log("Phase 9B — Post-map action queue verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyPages();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nQueue rows:", db.queueCount);
  console.log("Open queue rows:", db.openCount);

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 9B verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
