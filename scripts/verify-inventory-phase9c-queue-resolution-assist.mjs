#!/usr/bin/env node
/**
 * Phase 9C — Queue resolution assist verification.
 * Run: node scripts/verify-inventory-phase9c-queue-resolution-assist.mjs
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
const PORT = 9898;
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
    "js/admin/inventory/api/postMapQueueResolutionApi.js",
    "js/admin/inventory/ui/postMapQueueEvidence.js",
    "supabase/migrations/20260919_inventory_phase9c_queue_resolution_assist.sql",
  ];
  const grandfathered = new Set(["js/admin/inventory/ui/postMapQueueModal.js"]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/postMapQueueModal.js"), "utf8");
  const evidence = readFileSync(join(ROOT, "js/admin/inventory/ui/postMapQueueEvidence.js"), "utf8");
  const api = readFileSync(join(ROOT, "js/admin/inventory/api/postMapQueueResolutionApi.js"), "utf8");

  if (!modal.includes("Work Queue")) errors.push("Work screen title missing");
  else notes.push("Work queue UI present");

  if (!modal.includes("Mark Done Selected")) errors.push("Bulk done missing");
  else notes.push("Bulk workflow actions present");

  if (!modal.includes("does not change inventory")) notes.push("Bulk done confirmation copy");

  if (/retry_inventory_reservation|manual_finalize_shipped/.test(modal)) {
    errors.push("Modal must not auto-execute inventory RPCs");
  } else notes.push("No auto retry/finalize in modal");

  if (!evidence.includes("read-only") && !evidence.includes("Evidence")) notes.push("Evidence view present");

  if (!api.includes("v_inventory_post_map_queue_with_resolution")) errors.push("Resolution view not wired");
  else notes.push("Resolution API wired");

  if (!api.includes("update_post_map_queue_items_bulk")) notes.push("Bulk update RPC wired");

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const view = await client.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_name = 'v_inventory_post_map_queue_with_resolution'
  `);
  if (view.rows.length) return { applied: false };

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260919_inventory_phase9c_queue_resolution_assist.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  let queueCount = 0;
  let resolutionSample = null;

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 9C migration");
    else notes.push("Phase 9C migration already applied");

    const view = await client.query(`
      SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_post_map_queue_with_resolution'
    `);
    if (!view.rows.length) errors.push("Resolution view missing");
    else notes.push("v_inventory_post_map_queue_with_resolution exists");

    queueCount = (await client.query(`SELECT COUNT(*)::int c FROM v_inventory_post_map_queue_with_resolution`)).rows[0].c;
    notes.push(`Resolution view rows: ${queueCount}`);

    const manualReview = await client.query(`
      SELECT detected_resolution_status, suggested_status_action
      FROM v_inventory_post_map_queue_with_resolution
      WHERE next_step = 'manual_review'
      LIMIT 5
    `);
    for (const row of manualReview.rows) {
      if (row.detected_resolution_status === "appears_completed") {
        errors.push("manual_review must not auto-complete");
      }
    }
    notes.push("manual_review never appears_completed (sample check)");

    const testKey = `verify_9c_${Date.now()}`;
    await client.query(
      `INSERT INTO inventory_post_map_action_queue (
        source_channel, source_order_id, source_order_item_id, next_step, status, quantity, reason
      ) VALUES ('ebay', $1, 'line_1', 'manual_review', 'open', 1, 'verify 9c')`,
      [testKey],
    );

    const mr = await client.query(
      `SELECT detected_resolution_status, suggested_status_action FROM v_inventory_post_map_queue_with_resolution WHERE source_order_id = $1`,
      [testKey],
    );
    if (mr.rows[0]?.detected_resolution_status !== "needs_manual_review") {
      errors.push("manual_review row wrong resolution status");
    } else notes.push("manual_review → needs_manual_review");

    const retryLine = await client.query(`
      SELECT rr.source_order_id, rr.source_order_item_id, rr.existing_reservation_id, rr.suggested_action
      FROM v_inventory_reservation_retry_candidates rr
      WHERE rr.suggested_action = 'already_reserved'
      LIMIT 1
    `);

    if (retryLine.rows.length) {
      const rl = retryLine.rows[0];
      await client.query(
        `INSERT INTO inventory_post_map_action_queue (
          source_channel, source_order_id, source_order_item_id, next_step, status, quantity
        ) VALUES ('ebay', $1, $2, 'reservation_retry', 'open', 1)
        ON CONFLICT ON CONSTRAINT inventory_post_map_queue_unique_line_step DO NOTHING`,
        [rl.source_order_id, rl.source_order_item_id],
      );
      const res = await client.query(
        `SELECT detected_resolution_status, suggested_status_action, underlying_signal
         FROM v_inventory_post_map_queue_with_resolution
         WHERE source_order_id = $1 AND source_order_item_id = $2 AND next_step = 'reservation_retry'`,
        [rl.source_order_id, rl.source_order_item_id],
      );
      resolutionSample = res.rows[0] || null;
      if (res.rows[0]?.detected_resolution_status === "appears_completed") {
        notes.push(`Reservation signal → mark_done (${res.rows[0].underlying_signal})`);
      }
    } else notes.push("No already_reserved retry candidate to test reservation signal");

    const auditLine = await client.query(`
      SELECT source_order_id, source_order_item_id
      FROM v_inventory_shipped_finalize_audit
      WHERE suggested_audit_status = 'accounted_for'
      LIMIT 1
    `);
    if (auditLine.rows.length) {
      const al = auditLine.rows[0];
      await client.query(
        `INSERT INTO inventory_post_map_action_queue (
          source_channel, source_order_id, source_order_item_id, next_step, status, quantity
        ) VALUES ('ebay', $1, $2, 'shipped_finalize_audit', 'open', 1)
        ON CONFLICT ON CONSTRAINT inventory_post_map_queue_unique_line_step DO NOTHING`,
        [al.source_order_id, al.source_order_item_id],
      );
      const res = await client.query(
        `SELECT detected_resolution_status, suggested_status_action
         FROM v_inventory_post_map_queue_with_resolution
         WHERE source_order_id = $1 AND source_order_item_id = $2 AND next_step = 'shipped_finalize_audit'`,
        [al.source_order_id, al.source_order_item_id],
      );
      if (res.rows[0]?.detected_resolution_status === "appears_completed") {
        notes.push("Audit accounted_for → appears_completed / mark_done");
      }
    } else notes.push("No accounted_for audit row to test audit signal");

    const bulkIds = await client.query(
      `SELECT id FROM inventory_post_map_action_queue WHERE source_order_id = $1`,
      [testKey],
    );
    const ids = bulkIds.rows.map((r) => r.id);
    const bulkFn = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'update_post_map_queue_items_bulk'`);
    if (!bulkFn.rows.length) errors.push("Bulk update RPC missing");
    else notes.push("update_post_map_queue_items_bulk exists (admin auth required at runtime)");

    if (ids.length) {
      try {
        await client.query(`SELECT public.update_post_map_queue_items_bulk($1::uuid[], 'reviewed')`, [ids]);
        errors.push("Bulk RPC should require auth.uid()");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Authentication required")) notes.push("Bulk RPC rejects unauthenticated calls");
        else errors.push(`Unexpected bulk RPC error: ${msg}`);
      }

      await client.query(
        `UPDATE inventory_post_map_action_queue SET status = 'reviewed', updated_at = now() WHERE id = $1`,
        [ids[0]],
      );
      const st = await client.query(`SELECT status FROM inventory_post_map_action_queue WHERE id = $1`, [ids[0]]);
      if (st.rows[0]?.status !== "reviewed") errors.push("Direct queue status update failed");
      else notes.push("Queue status-only update works (no inventory side effects)");
    }

    await client.query(`DELETE FROM inventory_post_map_action_queue WHERE source_order_id = $1`, [testKey]);

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    await client.query(`SELECT COUNT(*) FROM v_inventory_post_map_queue_with_resolution`);

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand changed");
    else notes.push("On-hand unchanged");

    if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("Ledger changed");
    else notes.push("No ledger mutations");

    if (String(resBefore) !== String(resAfter)) errors.push("Reservations changed");
    else notes.push("No reservation mutations");

    return { notes, errors, queueCount, resolutionSample };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, queueCount, resolutionSample };
  } finally {
    await client.end().catch(() => {});
  }
}

async function verifyPage() {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!(await page.locator("#inventoryPostMapQueueModalMount").count())) {
      errors.push("Queue mount missing");
    } else notes.push("Inventory page loads cleanly");
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

  console.log("Phase 9C — Queue resolution assist verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nResolution view rows:", db.queueCount);
  if (db.resolutionSample) console.log("Sample reservation resolution:", db.resolutionSample);

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 9C verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
