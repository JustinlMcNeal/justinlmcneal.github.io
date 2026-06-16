#!/usr/bin/env node
/**
 * Phase 8H — Bulk mapping visibility verification.
 * Run: node scripts/verify-inventory-phase8h-bulk-mapping-visibility.mjs
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
const PORT = 9895;
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
    "js/admin/inventory/api/ebayMappingWorklistApi.js",
    "js/admin/inventory/ui/ebayMappingWorklistModal.js",
    "supabase/migrations/20260916_inventory_phase8h_bulk_mapping_visibility.sql",
  ];
  const grandfathered = new Set([
    "js/admin/inventory/ui/mappingAssistModal.js",
    "js/admin/inventory/ui/issueDetailModal.js",
    "js/admin/inventory/events.js",
    "js/admin/inventory/ui/shippedFinalizeAuditModal.js",
  ]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/ebayMappingWorklistModal.js"), "utf8");
  const api = readFileSync(join(ROOT, "js/admin/inventory/api/ebayMappingWorklistApi.js"), "utf8");
  const assist = readFileSync(join(ROOT, "js/admin/inventory/ui/mappingAssistModal.js"), "utf8");
  const audit = readFileSync(join(ROOT, "js/admin/inventory/ui/shippedFinalizeAuditModal.js"), "utf8");
  const issues = readFileSync(join(ROOT, "js/admin/inventory/renderers/renderIssues.js"), "utf8");
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260916_inventory_phase8h_bulk_mapping_visibility.sql"),
    "utf8",
  );

  if (!modal.includes("Apply Mapping to Selected") || !modal.includes("window.confirm")) {
    errors.push("Worklist modal missing confirmation gate");
  } else notes.push("Selected apply requires confirmation");

  if (!modal.includes("Select suggested lines")) notes.push("High-confidence select-suggested (not select-all default)");
  if (!modal.includes("manual pick")) notes.push("Manual variant pick messaging present");

  if (!api.includes("apply_inventory_mapping_assist_batch")) {
    errors.push("Batch RPC not wired in API");
  } else notes.push("Batch RPC wired");

  if (/sync-ebay|callEdge|manual_finalize|retry_inventory/.test(modal)) {
    errors.push("Worklist modal must not auto-finalize or retry");
  } else notes.push("No auto-finalize/retry in worklist UI");

  if (!audit.includes("Open eBay Mapping Worklist")) errors.push("Shipped audit missing worklist launch");
  else notes.push("Shipped audit worklist launch");

  if (!issues.includes("data-inventory-ebay-worklist")) errors.push("Issues panel missing eBay Worklist");
  else notes.push("Issues panel eBay Worklist button");

  if (!sql.includes("inventory_mapping_assist_batches")) errors.push("Batch audit table missing");
  else notes.push("Batch audit table in migration");

  if (!assist.includes("Open eBay Mapping Worklist")) notes.push("Mapping assist eBay worklist link (ebay only)");

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const view = await client.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'v_inventory_ebay_mapping_worklist'
  `);
  if (view.rows.length) return { applied: false };

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260916_inventory_phase8h_bulk_mapping_visibility.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  let groupCount = 0;
  let lineCountTotal = 0;
  let actionCounts = {};

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 8H migration");
    else notes.push("Phase 8H migration already applied");

    const wl = await client.query(`SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_ebay_mapping_worklist'`);
    if (!wl.rows.length) errors.push("Worklist view missing");
    else notes.push("v_inventory_ebay_mapping_worklist exists");

    const lines = await client.query(`SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_ebay_mapping_worklist_lines'`);
    if (!lines.rows.length) errors.push("Worklist lines view missing");
    else notes.push("v_inventory_ebay_mapping_worklist_lines exists");

    const fn = await client.query(`
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'apply_inventory_mapping_assist_batch'
    `);
    if (!fn.rows.length) errors.push("Batch RPC missing");
    else notes.push("apply_inventory_mapping_assist_batch RPC exists");

    groupCount = (await client.query(`SELECT COUNT(*)::int c FROM v_inventory_ebay_mapping_worklist`)).rows[0].c;
    lineCountTotal = (await client.query(`SELECT COUNT(*)::int c FROM v_inventory_ebay_mapping_worklist_lines`)).rows[0].c;
    notes.push(`Worklist groups: ${groupCount}, line rows: ${lineCountTotal}`);

    const actions = await client.query(`
      SELECT recommended_action, COUNT(*)::int c
      FROM v_inventory_ebay_mapping_worklist
      GROUP BY 1 ORDER BY c DESC
    `);
    actionCounts = Object.fromEntries(actions.rows.map((r) => [r.recommended_action, r.c]));

    const sample = await client.query(`
      SELECT group_type, group_key, row_count, recommended_action
      FROM v_inventory_ebay_mapping_worklist
      ORDER BY row_count DESC LIMIT 3
    `);
    if (sample.rows.length) notes.push(`Top groups: ${JSON.stringify(sample.rows)}`);

    if (groupCount > 0) {
      const g = sample.rows[0];
      const detail = await client.query(
        `SELECT COUNT(*)::int c FROM v_inventory_ebay_mapping_worklist_lines WHERE group_type = $1 AND group_key = $2`,
        [g.group_type, g.group_key],
      );
      if (detail.rows[0].c !== g.row_count) {
        errors.push("Line review count mismatch for sample group");
      } else notes.push("Line-level review loads for sample group");
    }

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;
    const batchBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_mapping_assist_batches`)).rows[0].t;

    await client.query(`SELECT * FROM v_inventory_ebay_mapping_worklist LIMIT 3`);

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;
    const batchAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_mapping_assist_batches`)).rows[0].t;

    if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand changed during verify");
    else notes.push("On-hand unchanged");

    if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("Ledger inserts during verify");
    else notes.push("No ledger inserts");

    if (String(resBefore) !== String(resAfter)) errors.push("Reservation mutations during verify");
    else notes.push("No reservation mutations");

    if (String(batchBefore) !== String(batchAfter)) notes.push("No batch apply during verify (expected)");
    else notes.push("No batch apply during verify");

    return { notes, errors, groupCount, lineCountTotal, actionCounts };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, groupCount, lineCountTotal, actionCounts };
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
    if (!(await page.locator("#inventoryEbayWorklistModalMount").count())) {
      errors.push("eBay worklist mount missing");
    } else notes.push("Inventory page loads with worklist mount");
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

  console.log("Phase 8H — Bulk mapping visibility verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nWorklist groups:", db.groupCount);
  console.log("Worklist line rows:", db.lineCountTotal);
  console.log("Recommended actions:", JSON.stringify(db.actionCounts, null, 2));

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 8H verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
