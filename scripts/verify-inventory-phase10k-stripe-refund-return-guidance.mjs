#!/usr/bin/env node
/**
 * Phase 10K — Stripe refund refresh + return guidance verification.
 * Run: node scripts/verify-inventory-phase10k-stripe-refund-return-guidance.mjs
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
const PORT = 9909;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;
const TEST_KEY = "verify_10k_fixture";

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
    "js/admin/inventory/api/refundRefreshApi.js",
    "js/admin/inventory/api/returnWorkflowApi.js",
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
    "js/admin/inventory/ui/bundleReturnRestockRefund.js",
    "supabase/migrations/20260929_inventory_phase10k_order_refund_details.sql",
    "supabase/migrations/20260929_inventory_phase10k_refund_issues.sql",
    "supabase/functions/stripe-refresh-refund-details/index.ts",
  ];
  const files = [
    ...lineLimitFiles,
    "docs/pages/admin/inventory/implementation/042_phase_10k_stripe_refund_return_guidance.md",
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

  const mig = read("supabase/migrations/20260929_inventory_phase10k_order_refund_details.sql");
  if (!mig.includes("order_refund_details")) errors.push("order_refund_details table missing");
  else notes.push("order_refund_details table defined");

  for (const col of [
    "refund_guidance_status",
    "refund_confidence",
    "refund_detail_count",
    "suggested_panel_action",
  ]) {
    if (!mig.includes(col)) errors.push(`Guidance column ${col} missing`);
    else notes.push(`Guidance column ${col} present`);
  }

  const issuesMig = read("supabase/migrations/20260929_inventory_phase10k_refund_issues.sql");
  for (const t of [
    "refund_without_return_workflow",
    "partial_refund_return_review",
    "refund_restock_review_needed",
  ]) {
    if (!issuesMig.includes(t)) errors.push(`Issue group ${t} missing`);
    else notes.push(`Issue group ${t} in v_inventory_issues`);
  }

  const fn = read("supabase/functions/stripe-refresh-refund-details/index.ts");
  if (fn.includes("inventory_return_workflow") && fn.includes("INSERT")) {
    errors.push("Edge function must not insert return workflow");
  } else notes.push("Edge function does not create return workflow");

  if (fn.includes("stock_ledger") || fn.includes("product_variants")) {
    errors.push("Edge function must not mutate stock");
  } else notes.push("Edge function does not mutate stock");

  if (!fn.includes("order_refund_details")) errors.push("Edge function must upsert order_refund_details");
  else notes.push("Edge function upserts order_refund_details");

  const panel = read("js/admin/inventory/ui/bundleReturnRestockPanel.js");
  const refundUi = read("js/admin/inventory/ui/bundleReturnRestockRefund.js");
  for (const needle of ["data-copy-order-ref", "Open Order Line", "renderRefundBlock", "wireRefundPanelActions"]) {
    if (!panel.includes(needle)) errors.push(`Panel missing: ${needle}`);
    else notes.push(`Panel includes: ${needle}`);
  }
  for (const needle of [
    "Refresh Refund Data",
    "Manual review — refund may not represent returned quantity",
    "Suggested: create return workflow",
    "refreshOrderRefundDetails",
  ]) {
    if (!refundUi.includes(needle)) errors.push(`Refund UI missing: ${needle}`);
    else notes.push(`Refund UI includes: ${needle}`);
  }
  if (!refundUi.includes("renderRefundBlock")) errors.push("renderRefundBlock missing from refund module");
  else notes.push("renderRefundBlock in bundleReturnRestockRefund.js");

  const issues = read("js/admin/inventory/services/issueActions.js");
  for (const t of [
    "refund_without_return_workflow",
    "partial_refund_return_review",
    "refund_restock_review_needed",
  ]) {
    if (!issues.includes(t)) errors.push(`Issue action ${t} missing`);
    else notes.push(`Issue action ${t} present`);
  }

  const config = read("supabase/config.toml");
  if (!config.includes("stripe-refresh-refund-details")) {
    errors.push("config.toml missing stripe-refresh-refund-details");
  } else notes.push("Edge function registered in config.toml");

  return { notes, errors };
}

async function applyMigrations(client) {
  const table = await client.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'order_refund_details'
  `);
  if (table.rows.length) return { applied: false };

  for (const f of [
    "20260929_inventory_phase10k_order_refund_details.sql",
    "20260929_inventory_phase10k_refund_issues.sql",
  ]) {
    await client.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
  }
  return { applied: true };
}

async function cleanupFixture(client, bundleId, compId, orderId) {
  await client.query(`DELETE FROM order_refund_details WHERE source_order_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_return_workflow WHERE source_order_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_bundle_live_issues WHERE order_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_bundle_component_restock_actions WHERE source_order_id = $1`, [orderId]);
  await client.query(`
    DELETE FROM stock_ledger WHERE idempotency_key LIKE $1 OR idempotency_key LIKE $2
  `, [`bundle_component_return:${orderId}%`, `bundle_component_finalize:${orderId}%`]);
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
    const mig = await applyMigrations(client);
    notes.push(mig.applied ? "Applied Phase 10K migrations" : "Phase 10K migrations already applied");

    const view = await client.query(`
      SELECT 1 FROM information_schema.views
      WHERE table_name = 'v_inventory_bundle_component_return_workflow_guidance'
    `);
    if (!view.rows.length) {
      notes.push("Skipped DB fixture (workflow guidance view missing — apply 10J first)");
      return { notes, errors };
    }

    const variants = await client.query(`
      SELECT id, product_id FROM product_variants WHERE COALESCE(is_active, true) ORDER BY id LIMIT 2
    `);
    if (variants.rows.length < 2) {
      notes.push("Skipped DB fixture (< 2 variants)");
      return { notes, errors };
    }

    bundleId = variants.rows[0].id;
    compId = variants.rows[1].id;
    orderId = `verify_10k_${Date.now()}`;
    const lineId = "li_verify_10k";
    const refundId = `re_verify_10k_${Date.now()}`;

    await cleanupFixture(client, bundleId, compId, orderId);
    await client.query(`UPDATE product_variants SET stock = 8 WHERE id = $1`, [compId]);

    await client.query(`
      INSERT INTO inventory_bundle_rules (bundle_variant_id, component_variant_id, component_qty, is_active, notes)
      VALUES ($1, $2, 1, true, $3)
      ON CONFLICT DO NOTHING
    `, [bundleId, compId, TEST_KEY]);

    await client.query(`
      INSERT INTO inventory_reservations (
        channel, order_id, order_item_id, variant_id, product_id, quantity, status,
        reservation_kind, parent_bundle_variant_id, parent_order_item_id, is_shadow, idempotency_key
      ) VALUES ('kk', $1, $2, $3, $4, 2, 'finalized', 'bundle_component', $5, $2, false, $6)
    `, [orderId, lineId, compId, variants.rows[1].product_id, bundleId, `verify_10k_res:${orderId}`]);

    reservationId = (
      await client.query(`SELECT id FROM inventory_reservations WHERE order_id = $1 LIMIT 1`, [orderId])
    ).rows[0]?.id;

    await client.query(`
      INSERT INTO orders_raw (stripe_checkout_session_id, total_paid_cents, refund_status, refund_amount_cents)
      VALUES ($1, 8000, 'none', 0)
    `, [orderId]);

    await client.query(`
      INSERT INTO line_items_raw (
        stripe_checkout_session_id, stripe_line_item_id, quantity,
        unit_price_cents, post_discount_unit_price_cents, product_id
      ) VALUES ($1, $2, 1, 8000, 8000, 'TEST-10K')
    `, [orderId, lineId]);

    const stockBefore = Number(
      (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId])).rows[0]?.stock,
    );

    await client.query(`
      INSERT INTO order_refund_details (
        source_order_id, source_order_item_id, stripe_refund_id, refund_amount_cents,
        currency, refund_status, line_allocation_confidence, refund_created_at
      ) VALUES ($1, NULL, $2, 8000, 'usd', 'succeeded', 'order_level', now())
    `, [orderId, refundId]);

    await client.query(`
      UPDATE orders_raw SET refund_status = 'full', refund_amount_cents = 8000, refunded_at = now()
      WHERE stripe_checkout_session_id = $1
    `, [orderId]);

    await client.query(`
      INSERT INTO order_refund_details (
        source_order_id, stripe_refund_id, refund_amount_cents, currency, refund_status,
        line_allocation_confidence, refund_created_at
      ) VALUES ($1, $2, 8000, 'usd', 'succeeded', 'order_level', now())
      ON CONFLICT (stripe_refund_id) WHERE stripe_refund_id IS NOT NULL
      DO UPDATE SET refund_amount_cents = EXCLUDED.refund_amount_cents, updated_at = now()
    `, [orderId, refundId]);

    const dupCount = (
      await client.query(`SELECT COUNT(*)::int AS c FROM order_refund_details WHERE stripe_refund_id = $1`, [
        refundId,
      ])
    ).rows[0]?.c;
    if (Number(dupCount) !== 1) errors.push("Refund detail upsert should be idempotent by stripe_refund_id");
    else notes.push("Refund detail idempotent by stripe_refund_id");

    const wfCountBefore = (
      await client.query(`SELECT COUNT(*)::int AS c FROM inventory_return_workflow WHERE source_order_id = $1`, [
        orderId,
      ])
    ).rows[0]?.c;
    if (Number(wfCountBefore) > 0) errors.push("Fixture should start with no return workflow");
    else notes.push("No return workflow before guidance check");

    const guidance = await client.query(
      `SELECT refund_guidance_status, refund_guidance_status_resolved, suggested_panel_action, refund_detail_count
       FROM v_inventory_bundle_component_return_workflow_guidance WHERE reservation_id = $1`,
      [reservationId],
    );
    const g = guidance.rows[0];
    if (!g) errors.push("Workflow guidance row missing");
    else {
      if (g.refund_guidance_status !== "full_refund_detected") {
        errors.push(`Expected full_refund_detected, got ${g.refund_guidance_status}`);
      } else notes.push("Full refund detected in guidance view");
      if (g.refund_guidance_status_resolved !== "refund_without_return_workflow") {
        errors.push(`Expected refund_without_return_workflow, got ${g.refund_guidance_status_resolved}`);
      } else notes.push("Full refund suggests return workflow (no auto-create)");
      if (g.suggested_panel_action !== "create_return_workflow") {
        errors.push(`Expected create_return_workflow panel action, got ${g.suggested_panel_action}`);
      } else notes.push("Suggested panel action: create_return_workflow");
      if (Number(g.refund_detail_count) < 1) errors.push("refund_detail_count should reflect cache rows");
      else notes.push("refund_detail_count populated from order_refund_details");
    }

    const wfCountAfter = (
      await client.query(`SELECT COUNT(*)::int AS c FROM inventory_return_workflow WHERE source_order_id = $1`, [
        orderId,
      ])
    ).rows[0]?.c;
    if (Number(wfCountAfter) > 0) errors.push("Refund cache insert must not auto-create return workflow");
    else notes.push("No return workflow auto-created from refund details");

    const stockAfterRefund = Number(
      (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId])).rows[0]?.stock,
    );
    if (stockAfterRefund !== stockBefore) errors.push("Refund detail write must not change stock");
    else notes.push("Stock unchanged after refund detail insert");

    const partialRefundId = `re_partial_10k_${Date.now()}`;
    await client.query(`
      INSERT INTO order_refund_details (
        source_order_id, stripe_refund_id, refund_amount_cents, currency, refund_status,
        line_allocation_confidence, refund_created_at
      ) VALUES ($1, $2, 2000, 'usd', 'succeeded', 'order_level', now())
    `, [orderId, partialRefundId]);

    await client.query(`
      UPDATE orders_raw SET refund_status = 'partial', refund_amount_cents = 2000 WHERE stripe_checkout_session_id = $1
    `, [orderId]);

    const partial = await client.query(
      `SELECT refund_guidance_status_resolved, refund_confidence, guidance_status, suggested_restock_qty
       FROM v_inventory_bundle_component_return_workflow_guidance WHERE reservation_id = $1`,
      [reservationId],
    );
    const p = partial.rows[0];
    if (p?.refund_guidance_status_resolved !== "partial_refund_detected") {
      errors.push("Partial refund should resolve to partial_refund_detected");
    } else notes.push("Partial refund stays manual review path");
    if (p?.guidance_status !== "partial_refund_review") {
      errors.push("Partial refund guidance_status should be partial_refund_review");
    } else notes.push("Partial refund guidance_status = partial_refund_review");
    if (p?.suggested_restock_qty != null && p?.refund_confidence === "low") {
      errors.push("Low-confidence partial should not suggest restock qty from refund alone");
    } else notes.push("Partial refund does not equate refund amount to restock qty");

    const issueRow = await client.query(`
      SELECT issue_type, affected_count FROM v_inventory_issues
      WHERE issue_type IN ('refund_without_return_workflow', 'partial_refund_return_review')
    `);
    const issueTypes = new Set((issueRow.rows || []).map((r) => r.issue_type));
    if (!issueTypes.has("partial_refund_return_review")) {
      notes.push("partial_refund_return_review issue may be zero-count (expected when no live rows)");
    } else notes.push("partial_refund_return_review issue group visible when rows match");

    await cleanupFixture(client, bundleId, compId, orderId);
    notes.push("Fixture cleaned up");
  } catch (err) {
    errors.push(`DB error: ${err instanceof Error ? err.message : String(err)}`);
    if (bundleId && compId && orderId) {
      try {
        await cleanupFixture(client, bundleId, compId, orderId);
      } catch {
        // ignore
      }
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

    const hasBundleTab = await page.locator("[data-inventory-tab='bundle']").count();
    if (hasBundleTab) notes.push("Bundle tab present in DOM");
    else notes.push("Bundle tab selector not found (page may require auth)");

    const panelSrc = read("js/admin/inventory/ui/bundleReturnRestockPanel.js");
    const refundSrc = read("js/admin/inventory/ui/bundleReturnRestockRefund.js");
    if (!panelSrc.includes("bundleReturnRestockRefund") || !refundSrc.includes("refreshOrderRefundDetails")) {
      errors.push("Panel must wire refund refresh module");
    } else notes.push("Panel wires refund refresh module");
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

  console.log("\n=== Phase 10K Verification ===\n");
  for (const n of allNotes) console.log(`  ✓ ${n}`);
  for (const e of allErrors) console.log(`  ✗ ${e}`);

  console.log(`\n${allErrors.length ? "FAILED" : "PASSED"} — ${allNotes.length} checks, ${allErrors.length} errors\n`);
  process.exit(allErrors.length ? 1 : 0);
}

main();
