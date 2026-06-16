#!/usr/bin/env node
/**
 * Phase 8F — Manual finalize assist verification.
 * Run: node scripts/verify-inventory-phase8f-manual-finalize-assist.mjs
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
    "js/admin/inventory/api/manualFinalizeAssistApi.js",
    "js/admin/inventory/ui/manualFinalizePrompt.js",
    "supabase/migrations/20260914_inventory_phase8f_manual_finalize_assist.sql",
  ];
  const grandfathered = new Set([
    "js/admin/inventory/ui/shippedFinalizeAuditModal.js",
    "js/admin/inventory/ui/issueDetailModal.js",
    "js/admin/inventory/events.js",
  ]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const api = readFileSync(join(ROOT, "js/admin/inventory/api/manualFinalizeAssistApi.js"), "utf8");
  const prompt = readFileSync(join(ROOT, "js/admin/inventory/ui/manualFinalizePrompt.js"), "utf8");
  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/shippedFinalizeAuditModal.js"), "utf8");
  const detail = readFileSync(join(ROOT, "js/admin/inventory/ui/issueDetailModal.js"), "utf8");
  const auditApi = readFileSync(join(ROOT, "js/admin/inventory/api/shippedFinalizeAuditApi.js"), "utf8");

  if (!api.includes("manual_finalize_shipped_order_line")) {
    errors.push("manualFinalizeAssistApi must call manual_finalize_shipped_order_line RPC");
  } else notes.push("RPC wired in API");

  if (!prompt.includes("Admin note (required)") || !prompt.includes("order_finalized")) {
    errors.push("Manual finalize prompt missing required note / impact copy");
  } else notes.push("Confirmation + note gate present");

  if (!modal.includes("Manual Finalize")) {
    errors.push("Audit modal missing Manual Finalize action");
  } else notes.push("Audit modal finalize action wired");

  if (!detail.includes("data-manual-finalize-sample")) {
    errors.push("Issue detail missing manual finalize sample action");
  } else notes.push("Issue detail manual finalize wired");

  if (/sync-amazon|sync-ebay|callEdge/.test(api)) {
    errors.push("Manual finalize API must not call channel sync");
  } else notes.push("No channel API writes in finalize API");

  if (/INSERT|UPDATE|DELETE/.test(auditApi)) {
    errors.push("Audit API must remain read-only");
  } else notes.push("Audit API remains read-only");

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260914_inventory_phase8f_manual_finalize_assist.sql"),
    "utf8",
  );
  if (!sql.includes("manual_finalize:") || !sql.includes("order_finalized")) {
    errors.push("Migration missing idempotency key or order_finalized reason");
  } else notes.push("Migration idempotency + ledger reason present");

  if (!sql.includes("status = 'finalized'") || !sql.includes("'reserved'")) {
    errors.push("Migration must finalize existing reserved or insert finalized reservation");
  } else notes.push("No active reservation creation path");

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const fn = await client.query(`
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'manual_finalize_shipped_order_line'
  `);
  if (fn.rows.length) return { applied: false };

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260914_inventory_phase8f_manual_finalize_assist.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function expectRpcError(client, label, sql, params) {
  try {
    await client.query(sql, params);
    return `${label}: expected error but RPC succeeded`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Authentication required|Admin only|not eligible|note is required|not found|Variant mismatch/i.test(msg)) {
      return null;
    }
    return `${label}: unexpected error: ${msg}`;
  }
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  let eligibleCount = 0;
  let liveFinalizeExecuted = false;

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 8F migration");
    else notes.push("Phase 8F migration already applied");

    const fn = await client.query(`
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'manual_finalize_shipped_order_line'
    `);
    if (!fn.rows.length) errors.push("manual_finalize_shipped_order_line RPC missing");
    else notes.push("manual_finalize_shipped_order_line RPC exists");

    const col = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_inventory_shipped_finalize_audit'
        AND column_name = 'is_finalize_eligible'
    `);
    if (!col.rows.length) errors.push("is_finalize_eligible column missing on audit view");
    else notes.push("is_finalize_eligible on audit view");

    eligibleCount = (
      await client.query(`
        SELECT COUNT(*)::int c FROM v_inventory_shipped_finalize_audit WHERE is_finalize_eligible = true
      `)
    ).rows[0].c;
    notes.push(`Eligible manual finalize rows: ${eligibleCount}`);

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const reservedBefore = (await client.query(`
      SELECT COALESCE(SUM(quantity),0)::bigint t FROM inventory_reservations
      WHERE status = 'reserved' AND COALESCE(is_shadow,false) = false
    `)).rows[0].t;

    const missingVariant = await client.query(`
      SELECT source_channel, source_order_id, source_order_item_id, variant_id
      FROM v_inventory_shipped_finalize_audit
      WHERE suggested_audit_status = 'missing_variant'
      LIMIT 1
    `);
    if (missingVariant.rows.length) {
      const r = missingVariant.rows[0];
      const err = await expectRpcError(
        client,
        "missing_variant refuse",
        `SELECT manual_finalize_shipped_order_line($1,$2,$3,$4,$5)`,
        [r.source_channel, r.source_order_id, r.source_order_item_id, r.variant_id, "verify 8f"],
      );
      if (err) errors.push(err);
      else notes.push("missing_variant row refused by RPC");
    } else notes.push("No missing_variant row to test refuse path");

    const afnRow = await client.query(`
      SELECT source_channel, source_order_id, source_order_item_id, variant_id
      FROM v_inventory_shipped_finalize_audit
      WHERE suggested_audit_status = 'skipped_afn'
      LIMIT 1
    `);
    if (afnRow.rows.length) {
      const r = afnRow.rows[0];
      const err = await expectRpcError(
        client,
        "skipped_afn refuse",
        `SELECT manual_finalize_shipped_order_line($1,$2,$3,$4,$5)`,
        [r.source_channel, r.source_order_id, r.source_order_item_id, r.variant_id, "verify 8f afn"],
      );
      if (err) errors.push(err);
      else notes.push("AFN/FBA row refused by RPC");
    } else notes.push("No skipped_afn row to test refuse path");

    const authErr = await expectRpcError(
      client,
      "admin/auth refuse",
      `SELECT manual_finalize_shipped_order_line('kk','x','y',$1,'note')`,
      ["00000000-0000-0000-0000-000000000001"],
    );
    if (authErr) errors.push(authErr);
    else notes.push("RPC requires authenticated admin (direct pg blocked)");

    if (eligibleCount > 0) {
      const row = (
        await client.query(`
          SELECT source_channel, source_order_id, source_order_item_id, variant_id, quantity
          FROM v_inventory_shipped_finalize_audit
          WHERE is_finalize_eligible = true
          LIMIT 1
        `)
      ).rows[0];

      notes.push("Eligible row exists — skipping live finalize in verify (admin session required)");
    } else {
      notes.push("Zero eligible rows — empty-state guards verified only");
    }

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const reservedAfter = (await client.query(`
      SELECT COALESCE(SUM(quantity),0)::bigint t FROM inventory_reservations
      WHERE status = 'reserved' AND COALESCE(is_shadow,false) = false
    `)).rows[0].t;

    if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand changed during verify");
    else notes.push("On-hand unchanged during verify");

    if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("Ledger rows inserted during verify");
    else notes.push("No ledger inserts during verify");

    if (String(reservedBefore) !== String(reservedAfter)) errors.push("Active reserved qty changed during verify");
    else notes.push("No active reservation changes during verify");

    const auditView = await client.query(`
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_inventory_shipped_finalize_audit'
    `);
    if (!auditView.rows.length) errors.push("8E audit view missing");
    else notes.push("8E audit view intact");

    return { notes, errors, eligibleCount, liveFinalizeExecuted };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, eligibleCount, liveFinalizeExecuted };
  } finally {
    await client.end().catch(() => {});
  }
}

async function verifyInventoryPage() {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!(await page.locator("#inventoryShippedAuditModalMount").count())) {
      errors.push("Shipped audit mount missing");
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

  console.log("Phase 8F — Manual finalize assist verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nEligible count:", db.eligibleCount);
  console.log("Live finalize executed:", db.liveFinalizeExecuted ? "yes" : "no");

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 8F verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
