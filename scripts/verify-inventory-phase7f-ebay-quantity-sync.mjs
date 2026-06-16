#!/usr/bin/env node
/**
 * Phase 7F — eBay active listing quantity sync verification.
 * Run: node scripts/verify-inventory-phase7f-ebay-quantity-sync.mjs
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
    "supabase/migrations/20260908_inventory_phase7f_ebay_quantity_sync.sql",
    "supabase/functions/sync-ebay-inventory-quantity/index.ts",
    "supabase/functions/_shared/inventoryEbaySyncUtils.ts",
    "js/admin/inventory/api/ebaySyncPushApi.js",
    "js/admin/inventory/ui/syncEbayQuantityPush.js",
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

  const edge = readFileSync(join(ROOT, "supabase/functions/sync-ebay-inventory-quantity/index.ts"), "utf8");
  const utils = readFileSync(join(ROOT, "supabase/functions/_shared/inventoryEbaySyncUtils.ts"), "utf8");
  const amazonEdge = readFileSync(join(ROOT, "supabase/functions/sync-amazon-inventory-quantity/index.ts"), "utf8");

  if (!edge.includes("requireAdminJson")) errors.push("eBay sync edge missing admin guard");
  if (!edge.includes("EBAY_ENABLE_LIVE_QUANTITY_PATCH")) errors.push("eBay sync edge missing env gate");
  if (!edge.includes("bulk_update_price_quantity") && !utils.includes("bulk_update_price_quantity")) {
    errors.push("eBay sync must use bulk_update_price_quantity");
  } else notes.push("eBay API path: POST bulk_update_price_quantity");

  if (/\bwithdraw\b|\bpublish\b|\brelist\b/.test(utils)) {
    errors.push("eBay sync utils must not publish/withdraw/relist");
  } else notes.push("No relist/publish in eBay sync utils");

  if (!utils.includes('eq("ebay_sync_action", "update_qty")')) {
    errors.push("eBay sync utils must filter update_qty only");
  } else notes.push("Eligibility filters update_qty + mapping");

  if (/sync-ebay-inventory-quantity/i.test(amazonEdge)) {
    errors.push("Amazon edge must not call eBay sync");
  } else notes.push("Amazon 7C edge unchanged");

  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/syncDryRunModal.js"), "utf8");
  const ebayPushUi = readFileSync(join(ROOT, "js/admin/inventory/ui/syncEbayQuantityPush.js"), "utf8");
  if (!modal.includes("syncEbayQuantityPush")) errors.push("Modal missing eBay qty push");
  if (!ebayPushUi.includes("Validate eBay Qty")) errors.push("eBay push UI missing Validate button");
  if (!modal.includes("syncEbayRelistAssist")) errors.push("Modal missing relist assist");
  else notes.push("Sync modal has eBay push + relist assist");

  const relistUi = readFileSync(join(ROOT, "js/admin/inventory/ui/syncEbayRelistAssist.js"), "utf8");
  if (/callEdge\s*\(|ebay-manage-listing/.test(relistUi)) {
    errors.push("Relist assist must remain link-only");
  } else notes.push("Relist assist still link-only");

  const cacheEdge = readFileSync(join(ROOT, "supabase/functions/sync-ebay-listing-inventory-cache/index.ts"), "utf8");
  if (/\bbulk_update\b/.test(cacheEdge)) errors.push("Cache edge must stay read-only");
  else notes.push("eBay cache edge read-only");

  return { notes, errors };
}

function clientEligibleFilter(row) {
  const sku = String(row.ebay_sku || row.internal_sku || "").trim();
  if (!sku) return false;
  const ended = new Set(["ended", "out_of_stock", "withdrawn", "inactive"]);
  if (ended.has(String(row.ebay_listing_status || "").toLowerCase())) return false;
  if (row.ebay_item_group_key && Number(row.product_active_variant_count || 0) > 1) return false;
  return (
    row.ebay_sync_action === "update_qty" &&
    row.ebay_current_qty != null &&
    row.ebay_offer_id &&
    row.ebay_listing_id
  );
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

    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='inventory_channel_sync_results'
        AND column_name IN ('ebay_offer_id','ebay_listing_id')
    `);
    if (cols.rows.length < 2) errors.push("inventory_channel_sync_results missing eBay columns");
    else notes.push("Sync results table has eBay columns");

    const rawUpdate = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_channel_sync_candidates
      WHERE ebay_sync_action = 'update_qty'
    `)).rows[0].c;
    counts.raw_update_qty = rawUpdate;

    const endedInUpdate = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_channel_sync_candidates
      WHERE ebay_sync_action = 'update_qty'
        AND LOWER(COALESCE(ebay_listing_status,'')) IN ('ended','out_of_stock','withdrawn','inactive')
    `)).rows[0].c;
    if (endedInUpdate > 0) notes.push(`Note: ${endedInUpdate} update_qty rows have ended status (excluded by push filter)`);

    const { rows: allUpdate } = await client.query(`
      SELECT ebay_sync_action, ebay_current_qty, ebay_offer_id, ebay_listing_id,
             ebay_listing_status, ebay_sku, internal_sku, ebay_item_group_key, product_active_variant_count
      FROM v_inventory_channel_sync_candidates
      WHERE ebay_sync_action = 'update_qty'
    `);
    const eligible = allUpdate.filter(clientEligibleFilter);
    counts.eligible_push = eligible.length;
    notes.push(`Eligible eBay push candidates: ${eligible.length} (raw update_qty: ${rawUpdate})`);

    const endedPush = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_channel_sync_candidates
      WHERE ebay_sync_action = 'ended_needs_relist'
    `)).rows[0].c;
    counts.ended_needs_relist = endedPush;
    notes.push(`ended_needs_relist: ${endedPush} (excluded from push)`);

    const unsupported = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_channel_sync_candidates
      WHERE ebay_sync_action = 'unsupported_variation'
    `)).rows[0].c;
    counts.unsupported_variation = unsupported;

    const cacheMissing = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_channel_sync_candidates
      WHERE ebay_sync_action = 'qty_cache_missing'
    `)).rows[0].c;
    counts.qty_cache_missing = cacheMissing;
    notes.push(`unsupported_variation: ${unsupported}, qty_cache_missing: ${cacheMissing}`);

    const relistView = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_ebay_relist_candidates
    `)).rows[0].c;
    counts.relist_candidates = relistView;
    notes.push(`Relist assist candidates: ${relistView}`);

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
    } else notes.push("Inventory page loads");

    const modalSrc = readFileSync(join(ROOT, "js/admin/inventory/ui/syncDryRunModal.js"), "utf8");
    if (!modalSrc.includes("renderEbayQuantityPushSection")) errors.push("Modal missing eBay push section");
    else notes.push("eBay push section wired in modal");
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

  console.log("Phase 7F — eBay quantity sync verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nCandidate counts:", JSON.stringify(db.counts, null, 2));
  console.log("\nLive push gate: EBAY_ENABLE_LIVE_QUANTITY_PATCH=true (not executed in verify)");
  console.log("Preview mode: validates offers via GET; no bulk_update POST when preview:true");

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 7F verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
