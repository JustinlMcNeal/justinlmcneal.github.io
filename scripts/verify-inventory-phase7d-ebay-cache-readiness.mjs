#!/usr/bin/env node
/**
 * Phase 7D — eBay quantity cache + sync readiness verification.
 * Run: node scripts/verify-inventory-phase7d-ebay-cache-readiness.mjs
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
const PORT = 9899;
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
    "supabase/migrations/20260906_inventory_phase7d_ebay_cache.sql",
    "supabase/functions/sync-ebay-listing-inventory-cache/index.ts",
    "supabase/functions/_shared/inventoryEbayCacheUtils.ts",
    "js/admin/inventory/api/ebayCacheRefreshApi.js",
    "js/admin/inventory/ui/syncEbayReadiness.js",
    "js/admin/inventory/api/channelSyncPreviewApi.js",
  ];

  const grandfathered = new Set([
    "js/admin/inventory/ui/syncDryRunModal.js",
  ]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const edge = readFileSync(join(ROOT, "supabase/functions/sync-ebay-listing-inventory-cache/index.ts"), "utf8");
  const ebayManage = readFileSync(join(ROOT, "supabase/functions/ebay-manage-listing/index.ts"), "utf8");

  if (!edge.includes("requireAdminJson")) errors.push("eBay cache edge missing admin guard");
  if (edge.includes("bulk_update")) errors.push("eBay cache edge must not call bulk_update");
  if (/relist|publish|withdraw/i.test(edge)) errors.push("eBay cache edge must not relist/publish/withdraw");
  else notes.push("eBay cache edge is read-only (no qty push/relist)");

  if (ebayManage.includes("bulk_update")) notes.push("ebay-manage-listing bulk_update unchanged (not invoked by 7D)");

  const ebayUi = readFileSync(join(ROOT, "js/admin/inventory/ui/syncEbayReadiness.js"), "utf8");
  if (!ebayUi.includes("Refresh eBay Cache")) errors.push("eBay UI missing Refresh eBay Cache");
  if (!readFileSync(join(ROOT, "js/admin/inventory/ui/syncEbayQuantityPush.js"), "utf8").includes("Sync eBay Qty")) {
    errors.push("eBay push UI missing (Phase 7F)");
  } else notes.push("eBay readiness + push UI present");

  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/syncDryRunModal.js"), "utf8");
  if (!modal.includes("syncEbayReadiness")) errors.push("Modal missing eBay readiness import");
  else notes.push("Sync modal wires eBay readiness");

  const amazonUtils = readFileSync(join(ROOT, "supabase/functions/_shared/inventoryAmazonSyncUtils.ts"), "utf8");
  if (!amazonUtils.includes("v_inventory_channel_sync_candidates")) {
    errors.push("Amazon sync utils broken");
  } else notes.push("Phase 7C Amazon sync utils intact");

  return { notes, errors };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const counts = {};

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;

    const cacheExists = (await client.query(`
      SELECT COUNT(*)::int c FROM information_schema.tables
      WHERE table_schema='public' AND table_name='ebay_listing_inventory_cache'
    `)).rows[0].c;
    if (cacheExists !== 1) errors.push("ebay_listing_inventory_cache missing");
    else notes.push("ebay_listing_inventory_cache table exists");

    counts.cacheRows = (await client.query(`SELECT COUNT(*)::int c FROM ebay_listing_inventory_cache`)).rows[0].c;
    notes.push(`Cache rows: ${counts.cacheRows}`);

    const actions = await client.query(`
      SELECT ebay_sync_action, COUNT(*)::int c
      FROM v_inventory_channel_sync_candidates
      GROUP BY 1 ORDER BY c DESC
    `);
    for (const row of actions.rows) {
      counts[row.ebay_sync_action] = row.c;
    }
    notes.push(`eBay sync actions: ${JSON.stringify(counts)}`);

    const hasQtyCacheMissing = actions.rows.some((r) => r.ebay_sync_action === "qty_cache_missing");
    const hasOldQtyUnknown = actions.rows.some((r) => r.ebay_sync_action === "qty_unknown");
    if (hasOldQtyUnknown) errors.push("View still emits qty_unknown (expected qty_cache_missing)");
    if (!hasQtyCacheMissing && Number(counts.cacheRows) === 0) {
      notes.push("qty_cache_missing may be 0 until cache refresh (expected pre-refresh)");
    } else if (hasQtyCacheMissing) notes.push("View distinguishes qty_cache_missing");

    const modeCheck = await client.query(`
      SELECT pg_get_constraintdef(oid) def
      FROM pg_constraint
      WHERE conname = 'inventory_channel_sync_runs_mode_check'
    `);
    if (!String(modeCheck.rows[0]?.def || "").includes("cache_refresh")) {
      errors.push("sync run mode missing cache_refresh");
    } else notes.push("inventory_channel_sync_runs supports cache_refresh mode");

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;
    if (String(stockBefore) !== String(stockAfter) || resBefore !== resAfter) {
      errors.push("Stock/reservations mutated during verify");
    } else notes.push("No stock/reservation mutations");

    return { notes, errors, counts };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, counts };
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
    if (!(await page.locator('[data-inventory-header-action="sync-channels"]').count())) {
      errors.push("Sync Channels button missing");
    } else notes.push("Inventory page loads with Sync Channels");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  const fileEnv = loadEnv();
  for (const [k, v] of Object.entries(fileEnv)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  console.log("\n=== Phase 7D eBay cache readiness verification ===\n");
  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);

  const allErrors = [...src.errors, ...db.errors, ...page.errors];
  if (allErrors.length) {
    console.error("\nFAIL:");
    for (const e of allErrors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\nPASS\n");
  console.log("Sync candidate snapshot:", JSON.stringify(db.counts, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
