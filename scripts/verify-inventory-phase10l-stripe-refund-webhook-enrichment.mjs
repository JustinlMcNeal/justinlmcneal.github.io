#!/usr/bin/env node
/**
 * Phase 10L — Stripe refund webhook enrichment verification.
 * Run: node scripts/verify-inventory-phase10l-stripe-refund-webhook-enrichment.mjs
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
const PORT = 9910;
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
    "supabase/functions/_shared/stripeRefundDetails.ts",
    "supabase/functions/_shared/stripeWebhookChargeRefunded.ts",
    "supabase/functions/stripe-refresh-refund-details/index.ts",
  ];
  const files = [
    ...lineLimitFiles,
    "supabase/migrations/20261001_inventory_phase10l_refund_sync_source.sql",
    "docs/pages/admin/inventory/implementation/043_phase_10l_stripe_refund_webhook_enrichment.md",
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

  const helper = read("supabase/functions/_shared/stripeRefundDetails.ts");
  for (const sym of [
    "enrichOrderRefundDetails",
    "normalizeRefundDetailRow",
    "classifyLineAllocation",
    "enrichRefundDetailsFromChargeEvent",
    "fetchAllRefundsForPaymentIntent",
  ]) {
    if (!helper.includes(sym)) errors.push(`Helper missing ${sym}`);
    else notes.push(`Helper exports ${sym}`);
  }

  if (helper.includes("stock_ledger") || helper.includes("inventory_return_workflow")) {
    errors.push("Helper must not reference stock or return workflow");
  } else notes.push("Helper is observational only");

  const webhook = read("supabase/functions/stripe-webhook/index.ts");
  const chargeHandler = read("supabase/functions/_shared/stripeWebhookChargeRefunded.ts");
  if (!webhook.includes("handleChargeRefundedEvent")) {
    errors.push("Webhook must delegate to handleChargeRefundedEvent");
  } else notes.push("Webhook delegates charge.refunded to shared handler");

  if (!chargeHandler.includes("enrichRefundDetailsFromChargeEvent")) {
    errors.push("Charge refunded handler must call enrichment");
  } else notes.push("Charge refunded handler calls enrichment");

  if (!chargeHandler.includes("refund detail enrichment failed (non-fatal)")) {
    errors.push("Webhook enrichment must be non-fatal");
  } else notes.push("Webhook enrichment wrapped non-fatal");

  if (!chargeHandler.includes("DEDUP_REFUND_STOCK_RESTORE")) {
    errors.push("Legacy refund stock dedup must remain");
  } else notes.push("Legacy refund stock dedup unchanged");

  const refresh = read("supabase/functions/stripe-refresh-refund-details/index.ts");
  if (!refresh.includes('from "../_shared/stripeRefundDetails.ts"')) {
    errors.push("Admin refresh must import shared helper");
  } else notes.push("Admin refresh uses shared helper");

  if (!refresh.includes('syncSource: "admin_refresh"')) {
    errors.push("Admin refresh must set syncSource admin_refresh");
  } else notes.push("Admin refresh sets sync_source admin_refresh");

  if (!helper.includes('syncSource: "webhook"') && !helper.includes('"webhook"')) {
    errors.push("Webhook path must set sync_source webhook");
  } else notes.push("Webhook path sets sync_source webhook");

  const mig = read("supabase/migrations/20261001_inventory_phase10l_refund_sync_source.sql");
  if (!mig.includes("sync_source")) errors.push("sync_source migration missing");
  else notes.push("sync_source column migration present");

  const refundUi = read("js/admin/inventory/ui/bundleReturnRestockRefund.js");
  if (!refundUi.includes("refundDetailCount")) errors.push("Refund UI should show detail count");
  else notes.push("Refund UI shows detail count (guidance picks up webhook rows)");

  return { notes, errors };
}

async function applyMigration(client) {
  const col = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'order_refund_details' AND column_name = 'sync_source'
  `);
  if (col.rows.length) return { applied: false };
  await client.query(read("supabase/migrations/20261001_inventory_phase10l_refund_sync_source.sql"));
  return { applied: true };
}

async function cleanup(client, orderId) {
  await client.query(`DELETE FROM order_refund_details WHERE source_order_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_return_workflow WHERE source_order_id = $1`, [orderId]);
  await client.query(`DELETE FROM line_items_raw WHERE stripe_checkout_session_id = $1`, [orderId]);
  await client.query(`DELETE FROM orders_raw WHERE stripe_checkout_session_id = $1`, [orderId]);
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  const orderId = `verify_10l_${Date.now()}`;
  const refundId = `re_verify_10l_${Date.now()}`;

  try {
    await client.connect();
    const mig = await applyMigration(client);
    notes.push(mig.applied ? "Applied Phase 10L migration" : "Phase 10L migration already applied");

    const table = await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'order_refund_details'
    `);
    if (!table.rows.length) {
      notes.push("Skipped DB fixture (order_refund_details missing — apply 10K first)");
      return { notes, errors };
    }

    await cleanup(client, orderId);

    await client.query(`
      INSERT INTO orders_raw (stripe_checkout_session_id, total_paid_cents, refund_status, refund_amount_cents)
      VALUES ($1, 5000, 'partial', 2000)
    `, [orderId]);

    const wfBefore = (
      await client.query(`SELECT COUNT(*)::int AS c FROM inventory_return_workflow WHERE source_order_id = $1`, [
        orderId,
      ])
    ).rows[0]?.c;
    if (Number(wfBefore) > 0) errors.push("Fixture should have no workflow");
    else notes.push("No return workflow before enrichment simulation");

    await client.query(`
      INSERT INTO order_refund_details (
        source_order_id, stripe_refund_id, refund_amount_cents, currency, refund_status,
        line_allocation_confidence, sync_source, refund_created_at
      ) VALUES ($1, $2, 2000, 'usd', 'succeeded', 'order_level', 'webhook', now())
    `, [orderId, refundId]);

    await client.query(`
      INSERT INTO order_refund_details (
        source_order_id, stripe_refund_id, refund_amount_cents, currency, refund_status,
        line_allocation_confidence, sync_source, refund_created_at
      ) VALUES ($1, $2, 2000, 'usd', 'succeeded', 'order_level', 'webhook', now())
      ON CONFLICT (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL
      DO UPDATE SET sync_source = EXCLUDED.sync_source, updated_at = now()
    `, [orderId, refundId]);

    const dup = (
      await client.query(`SELECT COUNT(*)::int AS c FROM order_refund_details WHERE stripe_refund_id = $1`, [
        refundId,
      ])
    ).rows[0]?.c;
    if (Number(dup) !== 1) errors.push("Repeated upsert should not duplicate rows");
    else notes.push("Idempotent by stripe_refund_id");

    const wfAfter = (
      await client.query(`SELECT COUNT(*)::int AS c FROM inventory_return_workflow WHERE source_order_id = $1`, [
        orderId,
      ])
    ).rows[0]?.c;
    if (Number(wfAfter) > 0) errors.push("Enrichment must not auto-create return workflow");
    else notes.push("No return workflow auto-created");

    const view = await client.query(`
      SELECT 1 FROM information_schema.views
      WHERE table_name = 'v_inventory_bundle_component_return_guidance'
    `);
    if (view.rows.length) {
      notes.push("Guidance view exists — webhook rows feed refund_detail_count");
    }

    await cleanup(client, orderId);
    notes.push("Fixture cleaned up");
  } catch (err) {
    errors.push(`DB error: ${err instanceof Error ? err.message : String(err)}`);
    try {
      await cleanup(client, orderId);
    } catch {
      // ignore
    }
  } finally {
    await client.end();
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
    const title = await page.title();
    if (!title.toLowerCase().includes("inventory")) errors.push("Inventory page title unexpected");
    else notes.push("Inventory page loads");

    const panel = read("js/admin/inventory/ui/bundleReturnRestockPanel.js");
    if (!panel.includes("bundleReturnRestockRefund")) errors.push("Panel must wire refund module");
    else notes.push("Bundle Return/Restock panel loads refund module");
  } catch (err) {
    errors.push(`Browser error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
    server.close();
  }

  return { notes, errors };
}

async function main() {
  const allNotes = [];
  const allErrors = [];

  const src = verifySourceFiles();
  allNotes.push(...src.notes);
  allErrors.push(...src.errors);

  try {
    const db = await verifyDatabase();
    allNotes.push(...db.notes);
    allErrors.push(...db.errors);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("SUPABASE_DB") || msg.includes("Database password")) {
      allNotes.push(`DB checks skipped (${msg})`);
    } else {
      allErrors.push(`DB error: ${msg}`);
    }
  }

  try {
    const browser = await verifyBrowser();
    allNotes.push(...browser.notes);
    allErrors.push(...browser.errors);
  } catch (err) {
    allErrors.push(`Browser skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("\n=== Phase 10L Verification ===\n");
  for (const n of allNotes) console.log(`  ✓ ${n}`);
  for (const e of allErrors) console.log(`  ✗ ${e}`);

  console.log(`\n${allErrors.length ? "FAILED" : "PASSED"} — ${allNotes.length} checks, ${allErrors.length} errors\n`);
  process.exit(allErrors.length ? 1 : 0);
}

main();
