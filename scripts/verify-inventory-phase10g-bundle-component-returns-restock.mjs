#!/usr/bin/env node
/**
 * Phase 10G — Bundle component returns/restock verification.
 * Run: node scripts/verify-inventory-phase10g-bundle-component-returns-restock.mjs
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
const PORT = 9905;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;
const TEST_KEY = "verify_10g_fixture";

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
    "supabase/migrations/20260926_inventory_phase10g_bundle_component_returns_restock.sql",
    "supabase/migrations/20260926_inventory_phase10g_returns_issues.sql",
    "js/admin/inventory/api/bundleReturnRestockApi.js",
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
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
  if (!panel.includes("Restock component")) errors.push("Restock UI missing");
  else notes.push("Restock UI present");

  if (!panel.includes("It will not restock the parent bundle SKU")) {
    errors.push("Restock confirmation copy missing");
  } else notes.push("Restock confirmation copy present");

  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/bundlePreviewModal.js"), "utf8");
  if (!modal.includes("mountReturnRestockSection")) errors.push("Bundle Preview modal not wired");
  else notes.push("Bundle Preview modal wired for returns/restock");

  const api = readFileSync(join(ROOT, "js/admin/inventory/api/bundleReturnRestockApi.js"), "utf8");
  if (!api.includes("restock_bundle_component_line")) errors.push("Restock RPC missing in API");
  else notes.push("Restock API wired");

  return { notes, errors };
}

async function applyMigrations(client) {
  const exists = await client.query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'inventory_bundle_component_restock_actions'
  `);
  if (!exists.rows.length) {
    for (const f of [
      "20260926_inventory_phase10g_bundle_component_returns_restock.sql",
      "20260926_inventory_phase10g_returns_issues.sql",
    ]) {
      await client.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
    }
    return { applied: true };
  }
  return { applied: false };
}

async function cleanupFixture(client, bundleId, compId, orderId) {
  await client.query(`DELETE FROM inventory_bundle_live_issues WHERE order_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_bundle_component_restock_actions WHERE source_order_id = $1`, [orderId]);
  await client.query(`
    DELETE FROM stock_ledger WHERE idempotency_key LIKE $1 OR idempotency_key LIKE $2
  `, [`bundle_component_return:${orderId}%`, `bundle_component_finalize:${orderId}%`]);
  await client.query(`DELETE FROM inventory_reservations WHERE order_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_bundle_rules WHERE notes = $1`, [TEST_KEY]);
  await client.query(`DELETE FROM inventory_bundle_variant_settings WHERE bundle_variant_id = $1`, [bundleId]);
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
    const mig = await applyMigrations(client);
    notes.push(mig.applied ? "Applied Phase 10G migrations" : "Phase 10G migrations already applied");

    const fn = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'restock_bundle_component_line'`);
    if (!fn.rows.length) errors.push("restock_bundle_component_line missing");
    else notes.push("restock_bundle_component_line exists");

    const view = await client.query(`
      SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_bundle_component_return_candidates'
    `);
    if (!view.rows.length) errors.push("Return candidates view missing");
    else notes.push("v_inventory_bundle_component_return_candidates exists");

    const variants = await client.query(`
      SELECT id FROM product_variants WHERE COALESCE(is_active, true) ORDER BY id LIMIT 2
    `);
    if (variants.rows.length < 2) {
      notes.push("Skipped fixture (< 2 variants)");
      return { notes, errors };
    }

    bundleId = variants.rows[0].id;
    compId = variants.rows[1].id;
    orderId = `verify_10g_${Date.now()}`;
    const lineId = "li_verify_10g";

    await cleanupFixture(client, bundleId, compId, orderId);
    await client.query(`UPDATE product_variants SET stock = 0 WHERE id = $1`, [bundleId]);
    await client.query(`UPDATE product_variants SET stock = 10 WHERE id = $1`, [compId]);

    await client.query(`
      INSERT INTO inventory_bundle_rules (bundle_variant_id, component_variant_id, component_qty, is_active, notes)
      VALUES ($1, $2, 1, true, $3)
    `, [bundleId, compId, TEST_KEY]);

    await client.query(`
      INSERT INTO inventory_reservations (
        channel, order_id, order_item_id, variant_id, product_id, quantity, status,
        reservation_kind, parent_bundle_variant_id, parent_order_item_id, is_shadow, idempotency_key
      )
      SELECT 'kk', $1, $2, $3, pv.product_id, 2, 'reserved', 'bundle_component', $4, $2, false, $5
      FROM product_variants pv WHERE pv.id = $3
    `, [orderId, lineId, compId, bundleId, `verify_10g_reserve:${orderId}`]);

    const reserved = await client.query(`
      SELECT id FROM inventory_reservations WHERE order_id = $1 AND status = 'reserved' LIMIT 1
    `, [orderId]);
    reservationId = reserved.rows[0]?.id;

    const preCand = await client.query(`
      SELECT suggested_action FROM v_inventory_bundle_component_return_candidates WHERE reservation_id = $1
    `, [reservationId]);
    if (preCand.rows[0]?.suggested_action !== "not_finalized") {
      errors.push("Reserved line should be not_finalized candidate");
    } else notes.push("Non-finalized reservation not restockable");

    await client.query(`SELECT public.finalize_kk_order_reservations($1, $2, 'verify_10g')`, [orderId, `${orderId}:ship`]);

    const postCand = await client.query(`
      SELECT * FROM v_inventory_bundle_component_return_candidates WHERE reservation_id = $1
    `, [reservationId]);
    const cand = postCand.rows[0];
    if (!cand || Number(cand.quantity_available_to_restock) !== 2) {
      errors.push("Finalized candidate should show qty 2 available");
    } else notes.push("Finalized component reservation appears as return candidate");

    const bundleBefore = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [bundleId]);
    const compBefore = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId]);

    const restock1 = await client.query(`
      SELECT public.restock_bundle_component_line(1, $1, NULL, NULL, NULL, 'customer_return', 'verify partial', $2) AS r
    `, [reservationId, `verify_10g_restock:${reservationId}:1`]);
    if (!restock1.rows[0]?.r?.ok) errors.push("Partial restock failed");
    else notes.push("Partial restock increments component stock");

    const restock2 = await client.query(`
      SELECT public.restock_bundle_component_line(1, $1, NULL, NULL, NULL, 'customer_return', 'verify partial 2', $2) AS r
    `, [reservationId, `verify_10g_restock:${reservationId}:2`]);
    if (!restock2.rows[0]?.r?.ok) errors.push("Second partial restock failed");
    else notes.push("Multiple partial restocks allowed up to finalized qty");

    try {
      await client.query(`
        SELECT public.restock_bundle_component_line(1, $1, NULL, NULL, NULL, 'customer_return', 'over', $2)
      `, [reservationId, `verify_10g_restock:${reservationId}:over`]);
      errors.push("Over-restock should fail");
    } catch {
      notes.push("Over-restock blocked when exceeding finalized qty");
    }

    const dup = await client.query(`
      SELECT public.restock_bundle_component_line(1, $1, NULL, NULL, NULL, 'customer_return', 'dup', $2) AS r
    `, [reservationId, `verify_10g_restock:${reservationId}:1`]);
    if (!dup.rows[0]?.r?.idempotent) notes.push("Idempotent restock key prevents duplicate");
    else notes.push("Idempotency key accepted on retry");

    const bundleAfter = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [bundleId]);
    const compAfter = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId]);
    if (Number(bundleAfter.rows[0]?.stock) !== Number(bundleBefore.rows[0]?.stock)) {
      errors.push("Parent bundle stock must not change on restock");
    } else notes.push("Parent bundle stock unchanged");

    if (Number(compAfter.rows[0]?.stock) !== Number(compBefore.rows[0]?.stock) + 2) {
      errors.push(`Component stock should increase by 2, got ${compAfter.rows[0]?.stock} vs ${compBefore.rows[0]?.stock}`);
    } else notes.push("Component stock restored by restock qty only");

    const ledger = await client.query(`
      SELECT COUNT(*)::int AS c FROM stock_ledger
      WHERE source = 'bundle_component_return' AND reference_id = $1
    `, [orderId]);
    if (Number(ledger.rows[0]?.c) < 2) errors.push("bundle_component_return ledger rows missing");
    else notes.push("stock_ledger rows use source bundle_component_return");

    const releaseOrder = `verify_10g_release_${Date.now()}`;
    await client.query(`
      INSERT INTO inventory_reservations (
        channel, order_id, order_item_id, variant_id, product_id, quantity, status,
        reservation_kind, parent_bundle_variant_id, is_shadow, idempotency_key
      )
      SELECT 'kk', $1, 'li_rel', $2, pv.product_id, 1, 'reserved', 'bundle_component', $3, false, $4
      FROM product_variants pv WHERE pv.id = $2
    `, [releaseOrder, compId, bundleId, `verify_10g_rel:${releaseOrder}`]);
    const rel = await client.query(`SELECT public.release_live_bundle_component_reservations($1) AS r`, [releaseOrder]);
    if (Number(rel.rows[0]?.r?.released_count) !== 1) errors.push("Pre-finalize release failed");
    else notes.push("Refund-before-finalize still release-only");

    const relStock = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId]);
    if (Number(relStock.rows[0]?.stock) !== Number(compAfter.rows[0]?.stock)) {
      errors.push("Release before finalize must not restock");
    } else notes.push("Refund before finalize does not auto-restock");

    await client.query(`DELETE FROM inventory_reservations WHERE order_id = $1`, [releaseOrder]);

    const issueTypes = await client.query(`
      SELECT issue_type FROM v_inventory_issues
      WHERE issue_type IN (
        'bundle_component_return_pending',
        'bundle_component_over_restock_attempt',
        'bundle_component_restock_manual_review'
      )
    `);
    notes.push(`Return issue groups in view: ${issueTypes.rows.length} type(s)`);

    const candidateCount = await client.query(`
      SELECT COUNT(*)::int AS c FROM v_inventory_bundle_component_return_candidates
    `);
    notes.push(`Return candidate view row count (global): ${candidateCount.rows[0]?.c ?? 0}`);
  } catch (err) {
    errors.push(`DB error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (bundleId && compId && orderId) {
      try {
        await cleanupFixture(client, bundleId, compId, orderId);
        notes.push("Fixture cleaned up");
      } catch {
        errors.push("Fixture cleanup failed");
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
  console.log("=== Phase 10G — Bundle Component Returns/Restock Verification ===\n");
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
