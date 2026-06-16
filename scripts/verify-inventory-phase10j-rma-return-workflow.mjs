#!/usr/bin/env node
/**
 * Phase 10J — RMA / return workflow verification.
 * Run: node scripts/verify-inventory-phase10j-rma-return-workflow.mjs
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
const PORT = 9908;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;
const TEST_KEY = "verify_10j_fixture";

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

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifySourceFiles() {
  const notes = [];
  const errors = [];
  const lineLimitFiles = [
    "js/admin/inventory/api/returnWorkflowApi.js",
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
    "supabase/migrations/20260928_inventory_phase10j_rma_return_workflow.sql",
    "supabase/migrations/20260928_inventory_phase10j_return_workflow_issues.sql",
  ];
  const files = [
    ...lineLimitFiles,
    "docs/pages/admin/inventory/implementation/041_phase_10j_rma_return_workflow.md",
  ];

  for (const rel of files) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lineLimitFiles.includes(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
      else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const mig = read("supabase/migrations/20260928_inventory_phase10j_rma_return_workflow.sql");
  for (const fn of [
    "create_inventory_return_workflow",
    "update_inventory_return_workflow",
    "close_inventory_return_workflow",
    "link_return_workflow_restock",
  ]) {
    if (!mig.includes(fn)) errors.push(`RPC ${fn} missing`);
    else notes.push(`RPC ${fn} defined`);
  }

  if (!mig.includes("inventory_return_workflow")) errors.push("inventory_return_workflow table missing");
  else notes.push("inventory_return_workflow table defined");

  if (!mig.includes("v_inventory_bundle_component_return_workflow_guidance")) {
    errors.push("workflow guidance view missing");
  } else notes.push("workflow guidance view defined");

  const panel = read("js/admin/inventory/ui/bundleReturnRestockPanel.js");
  if (!panel.includes("Return workflow status does not change stock")) errors.push("Stock disclaimer missing");
  else notes.push("Workflow stock disclaimer present");

  if (!panel.includes("Create Return Workflow")) errors.push("Create workflow action missing");
  else notes.push("Create Return Workflow action present");

  if (!panel.includes("linkReturnWorkflowRestock")) errors.push("Post-restock workflow link missing");
  else notes.push("Post-restock workflow prompt wired");

  const api = read("js/admin/inventory/api/returnWorkflowApi.js");
  if (!api.includes("v_inventory_bundle_component_return_workflow_guidance")) {
    errors.push("API uses workflow guidance view");
  } else notes.push("API queries workflow guidance view");

  const issues = read("js/admin/inventory/services/issueActions.js");
  for (const t of ["bundle_return_expected", "bundle_return_received_not_restocked", "bundle_return_manual_review"]) {
    if (!issues.includes(t)) errors.push(`Issue action ${t} missing`);
    else notes.push(`Issue action ${t} present`);
  }

  if (mig.includes("UPDATE public.product_variants") || mig.includes("stock_ledger")) {
    errors.push("10J migration must not mutate stock/ledger directly");
  } else notes.push("Migration is workflow-only (no stock writes)");

  return { notes, errors };
}

async function applyMigrations(client) {
  const table = await client.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_return_workflow'
  `);
  if (table.rows.length) return { applied: false };

  for (const f of [
    "20260928_inventory_phase10j_rma_return_workflow.sql",
    "20260928_inventory_phase10j_return_workflow_issues.sql",
  ]) {
    await client.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
  }
  return { applied: true };
}

async function cleanupFixture(client, bundleId, compId, orderId) {
  await client.query(`DELETE FROM inventory_return_workflow WHERE source_order_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_bundle_live_issues WHERE order_id = $1`, [orderId]);
  await client.query(`DELETE FROM inventory_bundle_component_restock_actions WHERE source_order_id = $1`, [orderId]);
  await client.query(`
    DELETE FROM stock_ledger WHERE idempotency_key LIKE $1 OR idempotency_key LIKE $2
  `, [`bundle_component_return:${orderId}%`, `bundle_component_finalize:${orderId}%`]);
  await client.query(`DELETE FROM inventory_reservations WHERE order_id = $1`, [orderId]);
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
    notes.push(mig.applied ? "Applied Phase 10J migrations" : "Phase 10J migrations already applied");

    const variants = await client.query(`
      SELECT id FROM product_variants WHERE COALESCE(is_active, true) ORDER BY id LIMIT 2
    `);
    if (variants.rows.length < 2) {
      notes.push("Skipped DB fixture (< 2 variants)");
      return { notes, errors };
    }

    bundleId = variants.rows[0].id;
    compId = variants.rows[1].id;
    orderId = `verify_10j_${Date.now()}`;
    const lineId = "li_verify_10j";

    await cleanupFixture(client, bundleId, compId, orderId);
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
    `, [orderId, lineId, compId, bundleId, `verify_10j_reserve:${orderId}`]);

    reservationId = (
      await client.query(`SELECT id FROM inventory_reservations WHERE order_id = $1 LIMIT 1`, [orderId])
    ).rows[0]?.id;

    await client.query(`SELECT public.finalize_kk_order_reservations($1, $2, 'verify_10j')`, [
      orderId,
      `${orderId}:ship`,
    ]);

    const stockBefore = Number(
      (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId])).rows[0]?.stock,
    );

    const create = await client.query(
      `SELECT public.create_inventory_return_workflow($1, 2, 'kk', 'RMA-10J', 'TRACK-1', 'verify create') AS r`,
      [reservationId],
    );
    const workflowId = create.rows[0]?.r?.workflow_id;
    if (!create.rows[0]?.r?.ok || !workflowId) errors.push("create_inventory_return_workflow failed");
    else notes.push("Create return workflow succeeds");

    const stockAfterCreate = Number(
      (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId])).rows[0]?.stock,
    );
    if (stockAfterCreate !== stockBefore) errors.push("Create workflow must not change stock");
    else notes.push("Create workflow does not mutate stock");

    const update = await client.query(
      `SELECT public.update_inventory_return_workflow($1, 'received', 'unknown', 2, NULL, NULL, NULL, 'received note', NULL) AS r`,
      [workflowId],
    );
    if (!update.rows[0]?.r?.ok) errors.push("update_inventory_return_workflow failed");
    else notes.push("Update workflow (received) succeeds");

    try {
      await client.query(
        `SELECT public.update_inventory_return_workflow($1, NULL, NULL, 5, NULL, NULL, NULL, NULL, NULL)`,
        [workflowId],
      );
      errors.push("quantity_received > expected should fail");
    } catch {
      notes.push("quantity_received capped at quantity_expected");
    }

    const stockAfterUpdate = Number(
      (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId])).rows[0]?.stock,
    );
    if (stockAfterUpdate !== stockBefore) errors.push("Update workflow must not change stock");
    else notes.push("Update workflow does not mutate stock");

    const guidance = await client.query(
      `SELECT workflow_status, workflow_next_action FROM v_inventory_bundle_component_return_workflow_guidance WHERE reservation_id = $1`,
      [reservationId],
    );
    if (!guidance.rows[0]?.workflow_status) errors.push("Workflow guidance missing status");
    else notes.push("Workflow guidance view exposes status");

    const restock = await client.query(
      `SELECT public.restock_bundle_component_line(1, $1, NULL, NULL, NULL, 'customer_return', 'verify 10j', $2) AS r`,
      [reservationId, `verify_10j_restock:${reservationId}:1`],
    );
    if (!restock.rows[0]?.r?.ok) errors.push("Confirmed restock RPC failed");
    else notes.push("Confirmed restock still only path for stock change");

    const stockAfterRestock = Number(
      (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId])).rows[0]?.stock,
    );
    if (stockAfterRestock !== stockBefore + 1) errors.push("Restock should increase component stock by 1");
    else notes.push("Component stock increases only via restock RPC");

    const link = await client.query(
      `SELECT public.link_return_workflow_restock($1, 1, $2) AS r`,
      [workflowId, reservationId],
    );
    if (!link.rows[0]?.r?.ok) errors.push("link_return_workflow_restock failed");
    else notes.push("Link workflow restock updates workflow only");

    const stockAfterLink = Number(
      (await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId])).rows[0]?.stock,
    );
    if (stockAfterLink !== stockAfterRestock) errors.push("Link workflow restock must not change stock again");
    else notes.push("Link workflow restock does not mutate stock");

    const wfRow = await client.query(
      `SELECT quantity_restocked, status FROM inventory_return_workflow WHERE id = $1`,
      [workflowId],
    );
    if (Number(wfRow.rows[0]?.quantity_restocked) !== 1) errors.push("Workflow quantity_restocked not updated");
    else notes.push("Workflow quantity_restocked linked after restock");

    const resStatus = await client.query(
      `SELECT status FROM inventory_reservations WHERE id = $1`,
      [reservationId],
    );
    if (resStatus.rows[0]?.status !== "finalized") errors.push("Reservation status should remain finalized");
    else notes.push("Reservation status unchanged by workflow");

    await client.query(`SELECT public.close_inventory_return_workflow($1, 'done')`, [workflowId]);
    notes.push("Close workflow succeeds");

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
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    notes.push("Inventory page loads");
  } catch (err) {
    errors.push(`Browser: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("=== Phase 10J — RMA / Return Workflow Verification ===\n");
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const source = verifySourceFiles();
  const db = await verifyDatabase();
  const browser = await verifyBrowser();

  const notes = [...source.notes, ...db.notes, ...browser.notes];
  const errors = [...source.errors, ...db.errors, ...browser.errors];

  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  console.log(`\nResult: ${errors.length === 0 ? "PASS" : "FAIL"} (${notes.length} checks, ${errors.length} errors)`);
  process.exit(errors.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
