#!/usr/bin/env node
/**
 * Phase 7C — Amazon FBM quantity sync verification.
 * Run: node scripts/verify-inventory-phase7c-amazon-fbm-sync.mjs
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
    "supabase/migrations/20260905_inventory_phase7c_channel_sync_logs.sql",
    "supabase/functions/sync-amazon-inventory-quantity/index.ts",
    "supabase/functions/_shared/inventoryAmazonSyncUtils.ts",
    "js/admin/inventory/api/amazonSyncPushApi.js",
    "js/admin/inventory/api/channelSyncPreviewApi.js",
  ];

  const grandfathered = new Set([
    "supabase/functions/_shared/amazonBulkPatchUtils.ts",
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

  const edge = readFileSync(join(ROOT, "supabase/functions/sync-amazon-inventory-quantity/index.ts"), "utf8");
  const utils = readFileSync(join(ROOT, "supabase/functions/_shared/inventoryAmazonSyncUtils.ts"), "utf8");
  if (!edge.includes("requireAdminJson")) errors.push("Edge function missing admin guard");
  if (!utils.includes("v_inventory_channel_sync_candidates")) errors.push("Sync utils missing candidates view");
  if (!edge.includes('eq("amazon_sync_action", "update_qty")')) {
    const utils = readFileSync(join(ROOT, "supabase/functions/_shared/inventoryAmazonSyncUtils.ts"), "utf8");
    if (!utils.includes('eq("amazon_sync_action", "update_qty")')) {
      errors.push("Sync utils must filter update_qty only");
    }
  }
  if (/ebay/i.test(edge)) errors.push("Edge function must not call eBay");
  else notes.push("Edge function is Amazon-only, admin-guarded");

  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/syncDryRunModal.js"), "utf8");
  if (!modal.includes("Sync Amazon FBM")) errors.push("Modal missing Amazon push button");
  if (!modal.includes("data-amazon-sync-push")) errors.push("Modal missing push handler");
  else notes.push("Inventory modal has Amazon FBM push UI");

  const bulk = readFileSync(join(ROOT, "supabase/functions/_shared/amazonBulkPatchUtils.ts"), "utf8");
  if (!bulk.includes("processPerListingQuantityPatches")) {
    errors.push("Missing per-listing quantity patch helper");
  } else notes.push("Per-listing quantity patch helper present");

  return { notes, errors };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;

    for (const tbl of ["inventory_channel_sync_runs", "inventory_channel_sync_results"]) {
      const exists = (await client.query(`
        SELECT COUNT(*)::int c FROM information_schema.tables
        WHERE table_schema='public' AND table_name=$1
      `, [tbl])).rows[0].c;
      if (exists !== 1) errors.push(`${tbl} missing`);
      else notes.push(`${tbl} exists`);
    }

    const eligible = await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_channel_sync_candidates
      WHERE amazon_sync_action = 'update_qty'
        AND amazon_listing_id IS NOT NULL
        AND NULLIF(BTRIM(amazon_seller_sku), '') IS NOT NULL
    `);
    notes.push(`Amazon FBM update_qty candidates: ${eligible.rows[0].c}`);

    const afn = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_channel_sync_candidates WHERE amazon_sync_action = 'afn_skip'
    `)).rows[0].c;
    notes.push(`Amazon AFN skip rows: ${afn}`);

    const missing = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_channel_sync_candidates WHERE amazon_sync_action = 'missing_mapping'
    `)).rows[0].c;
    notes.push(`Amazon missing mapping rows: ${missing}`);

    const negClamp = await client.query(`
      SELECT variant_id, available_qty, available_qty_nonneg
      FROM v_inventory_channel_sync_candidates
      WHERE amazon_sync_action = 'update_qty' AND available_qty < 0
      LIMIT 3
    `);
    if (negClamp.rows.length) {
      for (const r of negClamp.rows) {
        if (Number(r.available_qty_nonneg) !== Math.max(Number(r.available_qty), 0)) {
          errors.push("available_qty_nonneg clamp incorrect");
        }
      }
      notes.push(`Negative-available push candidates clamp to 0: ${negClamp.rows.length} sample(s)`);
    }

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;
    if (String(stockBefore) !== String(stockAfter) || resBefore !== resAfter) {
      errors.push("Stock/reservations mutated during verify");
    } else notes.push("No stock/reservation mutations");

    return { notes, errors, eligibleCount: eligible.rows[0].c };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, eligibleCount: null };
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
    const syncBtn = page.locator('[data-inventory-header-action="sync-channels"]');
    if (!(await syncBtn.count())) errors.push("Sync Channels button missing");
    else notes.push("Inventory page loads with Sync Channels control");
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

  const allNotes = [...src.notes, ...db.notes, ...page.notes];
  const allErrors = [...src.errors, ...db.errors, ...page.errors];

  console.log("\n=== Phase 7C Amazon FBM sync verification ===\n");
  for (const n of allNotes) console.log(`  ✓ ${n}`);
  if (db.eligibleCount != null) console.log(`\n  Eligible FBM candidates: ${db.eligibleCount}`);

  if (allErrors.length) {
    console.error("\nFAIL:");
    for (const e of allErrors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\nPASS\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
