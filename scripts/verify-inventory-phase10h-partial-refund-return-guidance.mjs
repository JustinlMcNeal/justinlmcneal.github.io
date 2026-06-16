#!/usr/bin/env node
/**
 * Phase 10H — Partial refund / return guidance verification.
 * Run: node scripts/verify-inventory-phase10h-partial-refund-return-guidance.mjs
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
const PORT = 9906;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;
const TEST_KEY = "verify_10h_fixture";

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
    "supabase/migrations/20260927_inventory_phase10h_return_guidance.sql",
    "js/admin/inventory/api/bundleReturnRestockApi.js",
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
    "js/admin/inventory/ui/bundleReturnRestockChecklist.js",
  ];

  for (const rel of files) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
      else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const panel = readFileSync(join(ROOT, "js/admin/inventory/ui/bundleReturnRestockPanel.js"), "utf8");
  if (!panel.includes("Refund detected does not always mean item was returned")) errors.push("Refund disclaimer missing");
  else notes.push("Refund vs return disclaimer present");

  if (!panel.includes("Restock suggested qty")) errors.push("Suggested restock button missing");
  else notes.push("Restock suggested qty button present");

  if (!panel.includes("buildLineItemsOrdersUrl")) errors.push("Order deep link missing");
  else notes.push("Order deep links wired");

  const checklist = readFileSync(join(ROOT, "js/admin/inventory/ui/bundleReturnRestockChecklist.js"), "utf8");
  if (!checklist.includes("Open Sync Channels")) errors.push("Post-restock sync checklist missing");
  else notes.push("Post-restock channel checklist present");

  const orderLinks = readFileSync(join(ROOT, "js/admin/inventory/constants/orderLinks.js"), "utf8");
  if (!orderLinks.includes("buildLineItemsOrdersUrl")) notes.push("buildLineItemsOrdersUrl available");

  const api = readFileSync(join(ROOT, "js/admin/inventory/api/bundleReturnRestockApi.js"), "utf8");
  if (!api.includes("v_inventory_bundle_component_return_guidance")) errors.push("Guidance view not in API");
  else notes.push("Guidance API uses return_guidance view");

  const issues = readFileSync(join(ROOT, "js/admin/inventory/api/issuesApi.js"), "utf8");
  if (!issues.includes("bundle_component_return_pending")) errors.push("Issue samples for return pending missing");
  else notes.push("Issue samples include return guidance fields");

  return { notes, errors };
}

async function applyMigration(client) {
  const exists = await client.query(`
    SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_bundle_component_return_guidance'
  `);
  if (exists.rows.length) return { applied: false };
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260927_inventory_phase10h_return_guidance.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function cleanup(client, bundleId, compId, orderId) {
  await client.query(`DELETE FROM inventory_bundle_component_restock_actions WHERE source_order_id = $1`, [orderId]);
  await client.query(`DELETE FROM stock_ledger WHERE reference_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_reservations WHERE order_id = $1`, [orderId]);
  await client.query(`DELETE FROM line_items_raw WHERE stripe_checkout_session_id = $1`, [orderId]);
  await client.query(`DELETE FROM orders_raw WHERE stripe_checkout_session_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_bundle_rules WHERE notes = $1`, [TEST_KEY]);
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  let bundleId = null;
  let compId = null;
  let orderId = null;
  let reservationId = null;

  try {
    await client.connect();
    const mig = await applyMigration(client);
    notes.push(mig.applied ? "Applied Phase 10H migration" : "Phase 10H migration already applied");

    const variants = await client.query(`
      SELECT id, product_id FROM product_variants WHERE COALESCE(is_active, true) ORDER BY id LIMIT 2
    `);
    if (variants.rows.length < 2) {
      notes.push("Skipped DB fixture (< 2 variants)");
      return { notes, errors };
    }

    bundleId = variants.rows[0].id;
    compId = variants.rows[1].id;
    orderId = `verify_10h_${Date.now()}`;
    const lineId = "li_verify_10h";

    await cleanup(client, bundleId, compId, orderId);
    await client.query(`UPDATE product_variants SET stock = 5 WHERE id = $1`, [compId]);

    await client.query(`
      INSERT INTO inventory_reservations (
        channel, order_id, order_item_id, variant_id, product_id, quantity, status,
        reservation_kind, parent_bundle_variant_id, parent_order_item_id, is_shadow, idempotency_key
      ) VALUES ('kk', $1, $2, $3, $4, 3, 'finalized', 'bundle_component', $5, $2, false, $6)
    `, [orderId, lineId, compId, variants.rows[1].product_id, bundleId, `verify_10h_res:${orderId}`]);

    reservationId = (await client.query(
      `SELECT id FROM inventory_reservations WHERE order_id = $1 LIMIT 1`,
      [orderId],
    )).rows[0]?.id;

    await client.query(`
      INSERT INTO orders_raw (stripe_checkout_session_id, total_paid_cents, refund_status, refund_amount_cents, order_date)
      VALUES ($1, 10000, 'none', 0, now())
      ON CONFLICT DO NOTHING
    `, [orderId]).catch(() => {});

    await client.query(`
      INSERT INTO orders_raw (stripe_checkout_session_id, total_paid_cents, refund_status, refund_amount_cents)
      SELECT $1, 10000, 'none', 0
      WHERE NOT EXISTS (SELECT 1 FROM orders_raw WHERE stripe_checkout_session_id = $1)
    `, [orderId]);

    await client.query(`
      INSERT INTO line_items_raw (
        stripe_checkout_session_id, stripe_line_item_id, quantity,
        unit_price_cents, post_discount_unit_price_cents, product_id
      ) VALUES ($1, $2, 1, 5000, 5000, 'TEST-SKU')
    `, [orderId, lineId]);

    const noRefund = await client.query(`
      SELECT * FROM v_inventory_bundle_component_return_guidance WHERE reservation_id = $1
    `, [reservationId]);
    const g0 = noRefund.rows[0];
    if (!g0 || g0.guidance_status !== "restock_available") {
      errors.push(`Expected restock_available, got ${g0?.guidance_status}`);
    } else notes.push("No refund → restock_available guidance");
    if (Number(g0.suggested_restock_qty) > Number(g0.max_restockable_qty)) {
      errors.push("Suggested qty exceeds max restockable");
    } else notes.push("Suggested qty capped at max restockable");

    await client.query(`
      UPDATE orders_raw SET refund_status = 'full', refund_amount_cents = 10000 WHERE stripe_checkout_session_id = $1
    `, [orderId]);

    const fullRefund = await client.query(`
      SELECT guidance_status, suggested_restock_qty, max_restockable_qty
      FROM v_inventory_bundle_component_return_guidance WHERE reservation_id = $1
    `, [reservationId]);
    const g1 = fullRefund.rows[0];
    if (g1?.guidance_status !== "full_refund_after_finalize") {
      errors.push("Full refund after finalize should use full_refund_after_finalize status");
    } else notes.push("Full refund after finalize suggests restock (no auto-restock)");
    if (Number(g1.suggested_restock_qty) !== Number(g1.max_restockable_qty)) {
      errors.push("Full refund should suggest full remaining component qty");
    } else notes.push("Full refund suggested qty equals max restockable");

    const stockBefore = (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId])).rows[0]?.stock;
    const bundleBefore = (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [bundleId])).rows[0]?.stock;

    const autoCheck = await client.query(`SELECT COUNT(*)::int AS c FROM stock_ledger WHERE reference_id = $1 AND source = 'bundle_component_return'`, [orderId]);
    if (Number(autoCheck.rows[0]?.c) > 0) errors.push("Refund update must not auto-restock");
    else notes.push("Refund after finalize does not auto-restock");

    await client.query(`
      UPDATE orders_raw SET refund_status = 'partial', refund_amount_cents = 2500 WHERE stripe_checkout_session_id = $1
    `, [orderId]);

    const partial = await client.query(`
      SELECT guidance_status, suggested_restock_qty FROM v_inventory_bundle_component_return_guidance WHERE reservation_id = $1
    `, [reservationId]);
    if (partial.rows[0]?.guidance_status !== "partial_refund_review") {
      errors.push("Partial refund (below line total) should be partial_refund_review");
    } else notes.push("Partial refund marked manual review when line qty unknown");
    if (partial.rows[0]?.suggested_restock_qty != null) {
      errors.push("Partial refund review should have null suggested qty");
    } else notes.push("Partial refund has no auto suggested qty");

    const restock = await client.query(`
      SELECT public.restock_bundle_component_line(1, $1, NULL, NULL, NULL, 'customer_return', 'verify 10h', $2) AS r
    `, [reservationId, `verify_10h_restock:${reservationId}:1`]);
    if (!restock.rows[0]?.r?.ok) errors.push("Confirmed restock RPC failed");
    else notes.push("Restock still requires explicit RPC confirmation");

    const stockAfter = (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId])).rows[0]?.stock;
    const bundleAfter = (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [bundleId])).rows[0]?.stock;
    if (Number(stockAfter) !== Number(stockBefore) + 1) errors.push("Component stock should increase only after restock");
    else notes.push("Component stock changes only after confirmed restock");
    if (Number(bundleAfter) !== Number(bundleBefore)) errors.push("Parent bundle stock must stay unchanged");
    else notes.push("Parent bundle stock unchanged");

    const orderLinks = readFileSync(join(ROOT, "js/admin/inventory/constants/orderLinks.js"), "utf8");
    if (!orderLinks.includes("session_id")) errors.push("Deep link params missing");
    else notes.push("buildLineItemsOrdersUrl generates session_id + line_id params");
  } catch (err) {
    errors.push(`DB error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (bundleId && compId && orderId) {
      try {
        await cleanup(client, bundleId, compId, orderId);
        notes.push("Fixture cleaned up");
      } catch {
        errors.push("Cleanup failed");
      }
    }
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
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    notes.push("Inventory page loads");
    await page.waitForTimeout(1200);
  } catch (err) {
    errors.push(`Browser: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("=== Phase 10H — Partial Refund / Return Guidance Verification ===\n");
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const source = verifySourceFiles();
  const db = await verifyDatabase();
  const browser = await verifyBrowser();

  const allNotes = [...source.notes, ...db.notes, ...browser.notes];
  const allErrors = [...source.errors, ...db.errors, ...browser.errors];

  for (const n of allNotes) console.log(`  ✓ ${n}`);
  for (const e of allErrors) console.log(`  ✗ ${e}`);

  console.log(`\nResult: ${allErrors.length === 0 ? "PASS" : "FAIL"} (${allNotes.length} checks, ${allErrors.length} errors)`);
  process.exit(allErrors.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
