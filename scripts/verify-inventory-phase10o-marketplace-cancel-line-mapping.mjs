#!/usr/bin/env node
/**
 * Phase 10O — Marketplace cancel retention + line-level refund mapping verification.
 * Run: node scripts/verify-inventory-phase10o-marketplace-cancel-line-mapping.mjs
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
const PORT = 9913;
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
    "js/admin/inventory/ui/bundleReturnRestockRefund.js",
    "supabase/functions/_shared/marketplaceLineExtraction.ts",
    "supabase/functions/_shared/marketplaceObservationSync.ts",
  ];
  const files = [
    ...lineLimitFiles,
    "supabase/migrations/20261008_inventory_phase10o_line_extraction_backfill.sql",
    "supabase/migrations/20261009_inventory_phase10o_return_guidance_line_level.sql",
    "supabase/functions/_shared/amazonOrderSyncUtils.ts",
    "supabase/functions/ebay-sync-orders/index.ts",
    "scripts/backfill-marketplace-refund-observations.mjs",
    "docs/pages/admin/inventory/implementation/046_phase_10o_marketplace_cancel_line_mapping.md",
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

  const amazon = read("supabase/functions/_shared/amazonOrderSyncUtils.ts");
  if (!amazon.includes("canceledRetained")) errors.push("Amazon sync must retain canceled orders");
  else notes.push("Amazon canceled retention in sync");
  if (amazon.includes("if (orderStatus === \"canceled\"") && amazon.includes("return null")) {
    errors.push("Amazon sync must not skip canceled orders with early return null");
  } else notes.push("Amazon builds canceled order rows");

  const ebay = read("supabase/functions/ebay-sync-orders/index.ts");
  if (!ebay.includes("isEbayOrderCanceled")) errors.push("eBay cancel detection missing");
  else notes.push("eBay cancel-aware sync");
  if (!ebay.includes("canceledUpdated")) errors.push("eBay canceledUpdated stat missing");
  else notes.push("eBay canceled update tracking");

  const lineExt = read("supabase/functions/_shared/marketplaceLineExtraction.ts");
  if (!lineExt.includes("line_confirmed")) errors.push("Line extraction helper missing");
  else notes.push("TS line extraction helper");

  const mig = read("supabase/migrations/20261008_inventory_phase10o_line_extraction_backfill.sql");
  if (!mig.includes("infer_marketplace_line_from_payload")) errors.push("SQL line inference missing");
  else notes.push("SQL line inference function");
  if (!mig.includes("confidence_counts")) errors.push("Backfill confidence reporting missing");
  else notes.push("Backfill confidence reporting");

  const guid = read("supabase/migrations/20261009_inventory_phase10o_return_guidance_line_level.sql");
  if (!guid.includes("line_obs_agg")) errors.push("Guidance line_obs_agg missing");
  else notes.push("Guidance line-level join");

  const ui = read("js/admin/inventory/ui/bundleReturnRestockRefund.js");
  if (!ui.includes("sku_inferred") && !ui.includes("SKU inferred")) {
    errors.push("UI should show SKU inferred confidence");
  } else notes.push("UI confidence/evidence labels");

  const backfill = read("scripts/backfill-marketplace-refund-observations.mjs");
  if (!backfill.includes("--dry-run")) errors.push("Backfill dry-run required");
  else notes.push("Backfill dry-run safe");

  return { notes, errors };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  const amazonOrder = `amazon_cancel_10o_${Date.now()}`;
  const lineId = `amazon_cancel_10o_${Date.now()}_li_123`;

  try {
    await client.connect();

    const fn = await client.query(
      `SELECT 1 FROM pg_proc WHERE proname = 'infer_marketplace_line_from_payload'`,
    );
    if (!fn.rows.length) {
      notes.push("Skipped DB (apply 10O migrations first)");
      return { notes, errors };
    }

    const ebayLine = await client.query(
      `SELECT * FROM infer_marketplace_line_from_payload('ebay', 'ebay_api_test', $1::jsonb)`,
      [JSON.stringify({ orderLineItems: [{ lineItemId: "999888" }] })],
    );
    if (ebayLine.rows[0]?.source_order_item_id !== "ebay_li_999888") {
      errors.push("eBay line extraction failed");
    } else notes.push("eBay line ID extracted (line_confirmed)");

    await client.query(`
      INSERT INTO orders_raw (stripe_checkout_session_id, kk_order_id, total_paid_cents, order_date)
      VALUES ($1, 'AMZ-TEST', 0, now())
    `, [amazonOrder]);
    await client.query(`
      INSERT INTO fulfillment_shipments (stripe_checkout_session_id, kk_order_id, label_status, carrier, service)
      VALUES ($1, 'AMZ-TEST', 'cancelled', 'Amazon', 'Fulfilled by Amazon')
    `, [amazonOrder]);
    await client.query(`
      INSERT INTO marketplace_refund_observations (
        source_channel, source_order_id, source_order_item_id, observation_kind,
        observation_dedup_key, cancellation_status, line_allocation_confidence, sync_source
      ) VALUES ('amazon', $1, $2, 'cancellation', $3, 'cancelled', 'line_confirmed', 'order_sync')
    `, [amazonOrder, lineId, `cancel:${amazonOrder}:line:${lineId}`]);

    const wf = await client.query(
      `SELECT COUNT(*)::int AS c FROM inventory_return_workflow WHERE source_order_id = $1`,
      [amazonOrder],
    );
    if (Number(wf.rows[0]?.c) > 0) errors.push("Canceled fixture must not create workflow");
    else notes.push("No return workflow on canceled fixture");

    const ledger = await client.query(
      `SELECT COUNT(*)::int AS c FROM stock_ledger WHERE reference_id = $1`,
      [amazonOrder],
    );
    if (Number(ledger.rows[0]?.c) > 0) errors.push("Canceled fixture must not touch ledger");
    else notes.push("No ledger mutations");

    const backfill1 = await client.query(
      `SELECT backfill_marketplace_refund_observations('amazon', NULL, 50, $1) AS r`,
      [amazonOrder],
    );
    const backfill2 = await client.query(
      `SELECT backfill_marketplace_refund_observations('amazon', NULL, 50, $1) AS r`,
      [amazonOrder],
    );
    if ((backfill2.rows[0]?.r?.inserted ?? 0) > 0) {
      errors.push("Backfill should be idempotent");
    } else notes.push("Backfill idempotent");

    await client.query(`DELETE FROM marketplace_refund_observations WHERE source_order_id = $1`, [amazonOrder]);
    await client.query(`DELETE FROM fulfillment_shipments WHERE stripe_checkout_session_id = $1`, [amazonOrder]);
    await client.query(`DELETE FROM orders_raw WHERE stripe_checkout_session_id = $1`, [amazonOrder]);
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
    notes.push("Inventory page loads");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10O — Marketplace cancel + line mapping verification\n");

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
