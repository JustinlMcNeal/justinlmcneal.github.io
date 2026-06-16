#!/usr/bin/env node
/**
 * Phase 7E — eBay ended-listing relist assist verification.
 * Run: node scripts/verify-inventory-phase7e-ebay-relist-assist.mjs
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
    "supabase/migrations/20260907_inventory_phase7e_ebay_relist_assist.sql",
    "js/admin/inventory/api/ebayRelistAssistApi.js",
    "js/admin/inventory/ui/syncEbayRelistAssist.js",
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

  const relistApi = readFileSync(join(ROOT, "js/admin/inventory/api/ebayRelistAssistApi.js"), "utf8");
  const relistUi = readFileSync(join(ROOT, "js/admin/inventory/ui/syncEbayRelistAssist.js"), "utf8");
  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/syncDryRunModal.js"), "utf8");
  const ebayCache = readFileSync(join(ROOT, "supabase/functions/sync-ebay-listing-inventory-cache/index.ts"), "utf8");
  const amazonPush = readFileSync(join(ROOT, "js/admin/inventory/api/amazonSyncPushApi.js"), "utf8");

  if (!relistApi.includes("v_inventory_ebay_relist_candidates")) {
    errors.push("Relist API missing view query");
  }
  if (/callEdge\s*\(|ebay-manage-listing/.test(relistApi)) {
    errors.push("Relist API must not call eBay edge functions");
  } else notes.push("Relist API is read-only + audit log insert only");

  if (/callEdge\s*\(|ebay-manage-listing/.test(relistUi)) {
    errors.push("Relist UI must not invoke eBay edge functions");
  } else notes.push("Relist UI uses links + audit log only");

  if (!modal.includes("syncEbayRelistAssist")) errors.push("Modal missing relist assist import");
  if (!modal.includes("fetchEbayRelistCandidates")) errors.push("Modal missing relist candidate fetch");
  else notes.push("Sync modal wires relist assist section");

  if (/\bwithdraw\b|\bpublish\b/.test(ebayCache)) {
    errors.push("eBay cache edge must remain read-only");
  } else notes.push("eBay cache edge unchanged (read-only)");

  if (!amazonPush.includes("sync-amazon-inventory-quantity")) {
    errors.push("Amazon push API missing");
  } else notes.push("Amazon FBM push path intact");

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

    const tableExists = (await client.query(`
      SELECT COUNT(*)::int c FROM information_schema.tables
      WHERE table_schema='public' AND table_name='ebay_relist_assist_actions'
    `)).rows[0].c;
    if (tableExists !== 1) errors.push("ebay_relist_assist_actions table missing");
    else notes.push("ebay_relist_assist_actions table exists");

    const viewExists = (await client.query(`
      SELECT COUNT(*)::int c FROM information_schema.views
      WHERE table_schema='public' AND table_name='v_inventory_ebay_relist_candidates'
    `)).rows[0].c;
    if (viewExists !== 1) errors.push("v_inventory_ebay_relist_candidates view missing");
    else notes.push("v_inventory_ebay_relist_candidates view exists");

    const actions = await client.query(`
      SELECT relist_action, COUNT(*)::int c
      FROM v_inventory_ebay_relist_candidates
      GROUP BY 1 ORDER BY c DESC
    `);
    for (const row of actions.rows) {
      counts[row.relist_action] = row.c;
    }
    counts.total = actions.rows.reduce((s, r) => s + r.c, 0);
    notes.push(`Relist actions: ${JSON.stringify(counts)}`);

    const readyWithZero = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_ebay_relist_candidates
      WHERE relist_action = 'ready_to_relist' AND available_qty <= 0
    `)).rows[0].c;
    if (readyWithZero > 0) {
      errors.push(`ready_to_relist includes ${readyWithZero} row(s) with available <= 0`);
    } else notes.push("ready_to_relist excludes available <= 0");

    const endedSync = (await client.query(`
      SELECT COUNT(*)::int c FROM v_inventory_channel_sync_candidates
      WHERE ebay_sync_action = 'ended_needs_relist'
    `)).rows[0].c;
    counts.ended_needs_relist = endedSync;
    notes.push(`ended_needs_relist in sync view: ${endedSync}`);

    if (Number(counts.total) !== Number(endedSync)) {
      errors.push(`Relist candidate total (${counts.total}) != ended_needs_relist (${endedSync})`);
    }

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

    const modalSrc = readFileSync(join(ROOT, "js/admin/inventory/ui/syncDryRunModal.js"), "utf8");
    if (!modalSrc.includes("renderEbayRelistAssistSection")) {
      errors.push("Modal source missing relist assist wiring");
    } else notes.push("Relist assist section present in modal source");
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

  console.log("Phase 7E — eBay relist assist verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nCandidate counts:", JSON.stringify(db.counts, null, 2));
  console.log("\nLive relist/publish from Inventory:", "NO (assist links + audit log only)");

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 7E verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
