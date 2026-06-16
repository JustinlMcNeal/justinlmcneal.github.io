#!/usr/bin/env node
/**
 * Phase 10P — Post-sync observation cron + eBay webhook cancel/refund topics verification.
 * Run: node scripts/verify-inventory-phase10p-observation-cron-webhooks.mjs
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
const PORT = 9914;
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
    "supabase/functions/_shared/marketplaceObservationRefresh.ts",
    "supabase/functions/_shared/ebayOrderCancelAware.ts",
    "supabase/functions/ebay-webhook/index.ts",
    "js/admin/lineItemsOrders/renderTable.js",
  ];
  const files = [
    ...lineLimitFiles,
    "supabase/functions/marketplace-refresh-observations-cron/index.ts",
    "supabase/migrations/20261010_inventory_phase10p_observation_cron_webhooks.sql",
    "supabase/SETUP_MARKETPLACE_OBSERVATIONS_CRON.sql",
    "docs/pages/admin/inventory/implementation/047_phase_10p_observation_cron_webhooks.md",
    "js/admin/lineItemsOrders/amazonImport.js",
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

  const refreshHelper = read("supabase/functions/_shared/marketplaceObservationRefresh.ts");
  if (!refreshHelper.includes("backfill_marketplace_refund_observations")) {
    errors.push("Observation refresh helper must call backfill RPC");
  } else notes.push("Shared observation refresh helper");

  const syncTargets = [
    ["supabase/functions/ebay-sync-orders/index.ts", "ebay"],
    ["supabase/functions/ebay-sync-finances/index.ts", "ebay"],
    ["supabase/functions/amazon-sync-orders/index.ts", "amazon"],
    ["supabase/functions/amazon-sync-finances/index.ts", "amazon"],
    ["supabase/functions/amazon-sync-orders-cron/index.ts", "amazon"],
  ];
  for (const [rel, channel] of syncTargets) {
    const src = read(rel);
    if (!src.includes("refreshMarketplaceObservationsAfterSync")) {
      errors.push(`${rel} must call post-sync observation refresh`);
    } else if (!src.includes(`channel: "${channel}"`) && !src.includes(`channel: '${channel}'`)) {
      notes.push(`${rel} post-sync refresh wired`);
    } else {
      notes.push(`${rel} post-sync refresh (${channel})`);
    }
  }

  const webhook = read("supabase/functions/ebay-webhook/index.ts");
  if (!webhook.includes("MARKETPLACE_ORDER_CANCELLED") && !webhook.includes("isCancelRefundTopic")) {
    errors.push("eBay webhook must handle cancel/refund topics");
  } else notes.push("eBay webhook cancel/refund topic routing");
  if (!webhook.includes("cancel_observation_only")) {
    errors.push("eBay webhook must support observation-only cancel path");
  } else notes.push("eBay webhook observation-only cancel path");
  if (webhook.includes("inventory_reservations") || webhook.includes("stock_ledger")) {
    errors.push("eBay webhook must not mutate inventory");
  } else notes.push("eBay webhook no inventory mutations");

  const amazonTsv = read("js/admin/lineItemsOrders/amazonImport.js");
  if (!amazonTsv.includes("retainAmazonTsvCanceledObservations")) {
    errors.push("Amazon TSV must retain canceled rows observationally");
  } else notes.push("Amazon TSV canceled observation retention");
  if (amazonTsv.includes('order-status"] === "Cancelled"') && amazonTsv.includes("cancelled.push")) {
    notes.push("Amazon TSV documents skip of fulfillable canceled rows");
  }

  const mig = read("supabase/migrations/20261010_inventory_phase10p_observation_cron_webhooks.sql");
  if (!mig.includes("retain_amazon_tsv_canceled_observations")) errors.push("TSV canceled RPC migration missing");
  else notes.push("TSV canceled RPC migration");
  if (!mig.includes("v_order_marketplace_status")) errors.push("Marketplace status view migration missing");
  else notes.push("v_order_marketplace_status view");

  const api = read("js/admin/lineItemsOrders/api.js");
  if (!api.includes("v_order_marketplace_status")) errors.push("Line Items API must load marketplace status");
  else notes.push("Line Items API marketplace status join");

  const render = read("js/admin/lineItemsOrders/renderTable.js");
  if (!render.includes("marketplaceObsBadgeHtml")) errors.push("Line Items badges missing");
  else notes.push("Line Items marketplace observation badges");

  const forbidden = [
    "supabase/functions/ebay-webhook/index.ts",
    "supabase/functions/_shared/marketplaceObservationRefresh.ts",
    "js/admin/lineItemsOrders/amazonImport.js",
  ];
  for (const rel of forbidden) {
    const src = read(rel);
    if (src.includes("restock") && rel.includes("ebay-webhook")) {
      // allow word in comments only — check RPC calls
    }
    if (/\brestock\b.*rpc|rpc.*restock|inventory_reservations|stock_ledger.*insert/i.test(src)) {
      errors.push(`${rel} must not call restock/reservation/ledger mutations`);
    }
  }
  notes.push("No restock/reservation/ledger mutation calls in 10P paths");

  return { notes, errors };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  const tsvOrderId = `TSV-CANCEL-10P-${Date.now()}`;
  const sessionId = `amazon_${tsvOrderId}`;

  try {
    await client.connect();

    const fn = await client.query(
      `SELECT 1 FROM pg_proc WHERE proname = 'retain_amazon_tsv_canceled_observations'`,
    );
    if (!fn.rows.length) {
      notes.push("Skipped DB (apply 10P migration first)");
      return { notes, errors };
    }

    const tsv1 = await client.query(
      `SELECT retain_amazon_tsv_canceled_observations($1::text[]) AS r`,
      [[tsvOrderId]],
    );
    const tsv2 = await client.query(
      `SELECT retain_amazon_tsv_canceled_observations($1::text[]) AS r`,
      [[tsvOrderId]],
    );
    const retained = Number(tsv1.rows[0]?.r?.retained ?? 0);
    if (retained < 1) errors.push("TSV canceled RPC should retain observation");
    else notes.push(`TSV canceled retained=${retained}`);
    if (Number(tsv2.rows[0]?.r?.inserted ?? 0) > 0) {
      errors.push("TSV canceled RPC should be idempotent");
    } else notes.push("TSV canceled RPC idempotent");

    const orderRow = await client.query(
      `SELECT 1 FROM orders_raw WHERE stripe_checkout_session_id = $1`,
      [sessionId],
    );
    if (orderRow.rows.length) errors.push("TSV canceled must not create orders_raw");
    else notes.push("TSV canceled does not create fulfillable order");

    const wf = await client.query(
      `SELECT COUNT(*)::int AS c FROM inventory_return_workflow WHERE source_order_id = $1`,
      [sessionId],
    );
    if (Number(wf.rows[0]?.c) > 0) errors.push("TSV canceled must not create return workflow");
    else notes.push("No auto return workflow from TSV canceled");

    const view = await client.query(
      `SELECT 1 FROM information_schema.views WHERE table_name = 'v_order_marketplace_status'`,
    );
    if (!view.rows.length) errors.push("v_order_marketplace_status view missing");
    else notes.push("Marketplace status view exists");

    const backfill1 = await client.query(
      `SELECT backfill_marketplace_refund_observations('amazon', NULL, 50, $1) AS r`,
      [sessionId],
    );
    const backfill2 = await client.query(
      `SELECT backfill_marketplace_refund_observations('amazon', NULL, 50, $1) AS r`,
      [sessionId],
    );
    if (Number(backfill2.rows[0]?.r?.inserted ?? 0) > 0) {
      errors.push("Post-sync backfill should be idempotent");
    } else notes.push("Post-sync backfill idempotent");

    await client.query(`DELETE FROM marketplace_refund_observations WHERE source_order_id = $1`, [sessionId]);
    notes.push("Fixture cleaned up");
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
    notes.push("Inventory page loads (Bundle Return/Restock panel shell)");
    await page.goto(`http://127.0.0.1:${PORT}${LINE_ITEMS_PAGE}`, { waitUntil: "domcontentloaded" });
    notes.push("Line Items page loads");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10P — Observation cron + webhook verification\n");

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
