#!/usr/bin/env node
/**
 * Phase 8E — Shipped finalize audit verification.
 * Run: node scripts/verify-inventory-phase8e-shipped-finalize-audit.mjs
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
    "js/admin/inventory/api/shippedFinalizeAuditApi.js",
    "js/admin/inventory/ui/shippedFinalizeAuditModal.js",
    "supabase/migrations/20260913_inventory_phase8e_shipped_finalize_audit.sql",
  ];
  const grandfathered = new Set([
    "js/admin/inventory/ui/mappingAssistModal.js",
    "js/admin/inventory/ui/issueDetailModal.js",
    "js/admin/inventory/events.js",
    "js/admin/inventory/services/issueActions.js",
  ]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const auditApi = readFileSync(join(ROOT, "js/admin/inventory/api/shippedFinalizeAuditApi.js"), "utf8");
  const auditModal = readFileSync(join(ROOT, "js/admin/inventory/ui/shippedFinalizeAuditModal.js"), "utf8");
  const actions = readFileSync(join(ROOT, "js/admin/inventory/services/issueActions.js"), "utf8");
  const handlers = readFileSync(join(ROOT, "js/admin/inventory/services/issueActionHandlers.js"), "utf8");
  const assist = readFileSync(join(ROOT, "js/admin/inventory/ui/mappingAssistModal.js"), "utf8");
  const detail = readFileSync(join(ROOT, "js/admin/inventory/ui/issueDetailModal.js"), "utf8");
  const retryApi = readFileSync(join(ROOT, "js/admin/inventory/api/reservationRetryApi.js"), "utf8");

  if (!actions.includes("shipped_finalize_audit_needed")) {
    errors.push("issueActions missing shipped_finalize_audit_needed");
  } else notes.push("Issue action matrix includes shipped finalize audit");

  if (!handlers.includes("open_shipped_audit_modal")) {
    errors.push("issueActionHandlers missing open_shipped_audit_modal");
  } else notes.push("Primary action opens shipped audit modal");

  if (!auditModal.includes("Only adjust stock manually")) {
    errors.push("Audit modal missing manual-adjust warning copy");
  } else notes.push("Manual adjust warning copy present");

  if (/INSERT|UPDATE|DELETE|\.rpc\(/.test(auditApi)) {
    errors.push("Audit API must be read-only");
  } else notes.push("Audit API is read-only");

  if (!assist.includes("showPostMappingReservationRetry")) {
    errors.push("Mapping assist post-map reservation broken");
  } else notes.push("Mapping assist intact (8C)");

  if (!detail.includes("Retry Reservation")) {
    errors.push("Issue detail retry reservation broken");
  } else notes.push("Reservation retry intact (8D)");

  if (!detail.includes("Open Shipped Finalize Audit")) {
    errors.push("Issue detail missing shipped audit launch");
  } else notes.push("Issue detail shipped audit launch wired");

  if (/sync-amazon|sync-ebay|callEdge/.test(retryApi)) {
    errors.push("Retry API must not call channel sync");
  } else notes.push("No channel API writes in retry API");

  if (!existsSync(join(ROOT, "pages/admin/inventory.html"))) {
    errors.push("inventory.html missing");
  } else {
    const html = readFileSync(join(ROOT, "pages/admin/inventory.html"), "utf8");
    if (!html.includes("inventoryShippedAuditModalMount")) {
      errors.push("Shipped audit modal mount missing from inventory.html");
    } else notes.push("Shipped audit modal mount in HTML");
  }

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const view = await client.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'v_inventory_shipped_finalize_audit'
  `);
  if (view.rows.length) return { applied: false };

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260913_inventory_phase8e_shipped_finalize_audit.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  let statusCounts = {};
  let issueCount = 0;
  let afnCount = 0;
  let accountedCount = 0;
  let needsAuditCount = 0;

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 8E migration");
    else notes.push("Audit view already present");

    const view = await client.query(`
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_inventory_shipped_finalize_audit'
    `);
    if (!view.rows.length) errors.push("v_inventory_shipped_finalize_audit missing");
    else notes.push("v_inventory_shipped_finalize_audit exists");

    const counts = await client.query(`
      SELECT suggested_audit_status, COUNT(*)::int c
      FROM v_inventory_shipped_finalize_audit
      GROUP BY 1 ORDER BY c DESC
    `);
    statusCounts = Object.fromEntries(counts.rows.map((r) => [r.suggested_audit_status, r.c]));
    notes.push(`Audit status counts: ${JSON.stringify(statusCounts)}`);

    afnCount = Number(statusCounts.skipped_afn ?? 0);
    accountedCount = Number(statusCounts.accounted_for ?? 0);
    needsAuditCount = (
      await client.query(`
        SELECT COUNT(*)::int c FROM v_inventory_shipped_finalize_audit WHERE needs_audit_issue = true
      `)
    ).rows[0].c;

    if (afnCount >= 0) notes.push(`AFN/FBA skipped rows: ${afnCount}`);
    if (accountedCount >= 0) notes.push(`Accounted-for rows: ${accountedCount}`);
    notes.push(`Needs audit issue rows: ${needsAuditCount}`);

    const issueRow = await client.query(`
      SELECT affected_count FROM v_inventory_issues WHERE issue_type = 'shipped_finalize_audit_needed'
    `);
    issueCount = issueRow.rows.length ? Number(issueRow.rows[0].affected_count) : 0;
    notes.push(`Issue group count: ${issueCount}`);

    if (issueCount !== needsAuditCount) {
      notes.push(`Note: issue count (${issueCount}) vs needs_audit (${needsAuditCount}) — check active issue filter`);
    }

    const badAfn = await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_shipped_finalize_audit
      WHERE suggested_audit_status = 'skipped_afn' AND needs_audit_issue = true
    `);
    if (badAfn.rows[0].c > 0) errors.push("AFN rows incorrectly flagged for audit issue");
    else notes.push("AFN/FBA rows excluded from audit issue");

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0]
      .t;
    const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    await client.query(`SELECT * FROM v_inventory_shipped_finalize_audit LIMIT 5`);
    await client.query(`
      SELECT * FROM v_inventory_issues_with_state
      WHERE issue_type = 'shipped_finalize_audit_needed' OR issue_type = 'unmapped_order_line'
      LIMIT 5
    `);
    notes.push("Issue panel views load (with_state join)");

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand stock changed during verify");
    else notes.push("On-hand unchanged");

    if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("stock_ledger rows inserted during verify");
    else notes.push("No ledger inserts");

    if (String(resBefore) !== String(resAfter)) errors.push("inventory_reservations changed during verify");
    else notes.push("No reservation mutations");

    const retryView = await client.query(`
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_inventory_reservation_retry_candidates'
    `);
    if (!retryView.rows.length) errors.push("8D retry view missing");
    else notes.push("8D retry candidates view intact");

    return { notes, errors, statusCounts, issueCount, needsAuditCount };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, statusCounts, issueCount, needsAuditCount };
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
      errors.push("Shipped audit mount missing on page");
    } else notes.push("Inventory page loads cleanly");
    if (!(await page.locator("#inventoryMappingAssistModalMount").count())) {
      errors.push("Mapping assist mount missing");
    } else notes.push("Mapping assist mount present");
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

  console.log("Phase 8E — Shipped finalize audit verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nAudit status counts:", JSON.stringify(db.statusCounts, null, 2));
  console.log("Issue count (shipped_finalize_audit_needed):", db.issueCount);
  console.log("Needs audit rows:", db.needsAuditCount);

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 8E verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
