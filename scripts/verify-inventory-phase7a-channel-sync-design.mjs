#!/usr/bin/env node
/**
 * Phase 7A — channel sync design dry-run verification (read-only).
 * Run: node scripts/verify-inventory-phase7a-channel-sync-design.mjs
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
const PORT = 9896;
const PAGE = "/pages/admin/inventory.html";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

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

async function verifyDatabase() {
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  const notes = [];
  const errors = [];

  try {
    await client.connect();

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resCountBefore = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;

    const viewExists = (await client.query(`
      SELECT COUNT(*)::int c FROM information_schema.views
      WHERE table_schema='public' AND table_name='v_inventory_channel_sync_candidates'
    `)).rows[0].c;
    if (viewExists !== 1) errors.push("v_inventory_channel_sync_candidates missing");
    else notes.push("Sync candidates view exists");

    const { rows } = await client.query(`SELECT COUNT(*)::int total FROM v_inventory_channel_sync_candidates`);
    notes.push(`Sync candidate rows: ${rows[0].total}`);

    const sample = await client.query(`
      SELECT kk_sync_action, amazon_sync_action, ebay_sync_action, COUNT(*)::int c
      FROM v_inventory_channel_sync_candidates
      GROUP BY 1,2,3 ORDER BY c DESC LIMIT 5
    `);
    notes.push(`Top action combos: ${JSON.stringify(sample.rows)}`);

    const mode = (await client.query(`SELECT kk_reservation_mode FROM inventory_cutover_settings WHERE id=1`)).rows[0];
    if (mode?.kk_reservation_mode !== "reserve_only") {
      errors.push(`Expected reserve_only, got ${mode?.kk_reservation_mode}`);
    } else notes.push("kk_reservation_mode=reserve_only unchanged");

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resCountAfter = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;
    if (String(stockBefore) !== String(stockAfter) || resCountBefore !== resCountAfter) {
      errors.push("Stock or reservations changed during read-only verify");
    } else notes.push("No stock/reservation mutations");

    const webhook = readFileSync(join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");
    const shippo = readFileSync(join(ROOT, "supabase/functions/shippo-webhook/index.ts"), "utf8");
    if (webhook.includes("patchListingsItem") || shippo.includes("patchListingsItem")) {
      errors.push("Unexpected channel API push in webhooks");
    } else notes.push("No channel qty push in webhook functions");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await client.end().catch(() => {});
  }

  return { notes, errors };
}

async function verifyPage() {
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const title = await page.locator("h1").first().textContent();
    if (!title?.includes("Inventory")) errors.push("Page title unexpected");
    const syncBtn = page.locator('[data-inventory-header-action="sync-channels"]');
    if (!(await syncBtn.count())) errors.push("Sync Channels button missing");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
    server.close();
  }
  return errors;
}

async function main() {
  const fileEnv = loadEnv();
  for (const [k, v] of Object.entries(fileEnv)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const db = await verifyDatabase();
  const pageErrors = await verifyPage();

  console.log("\n=== Phase 7A channel sync design verification ===\n");
  for (const n of db.notes) console.log(`  ✓ ${n}`);
  const allErrors = [...db.errors, ...pageErrors];
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
