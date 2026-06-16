#!/usr/bin/env node
/**
 * Phase 7B — KK storefront available-stock alignment verification.
 * Run: node scripts/verify-inventory-phase7b-kk-available-stock.mjs
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

  const changed = [
    "js/shared/kkAvailableStock.js",
    "js/product/api.js",
    "js/home/api.js",
    "js/checkout/renderItems.js",
    "js/checkout/index.js",
    "js/product/render.js",
    "js/product/cart.js",
    "supabase/migrations/20260904_inventory_phase7b_kk_available_stock.sql",
  ];

  const grandfathered = new Set([
    "js/product/index.js",
    "supabase/functions/create-checkout-session/index.ts",
  ]);

  for (const rel of [...changed, ...grandfathered]) {
    const full = join(ROOT, rel);
    if (!existsSync(full)) errors.push(`Missing expected file: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) {
        errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
      } else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const kkStock = readFileSync(join(ROOT, "js/shared/kkAvailableStock.js"), "utf8");
  if (!kkStock.includes("v_kk_variant_available_stock")) {
    errors.push("kkAvailableStock.js missing view reference");
  } else notes.push("Shared helper uses v_kk_variant_available_stock");

  const productApi = readFileSync(join(ROOT, "js/product/api.js"), "utf8");
  if (!productApi.includes("enrichVariantsWithAvailableStock")) {
    errors.push("product/api.js not enriched with available stock");
  } else notes.push("Product API enriches variants with available stock");

  const homeApi = readFileSync(join(ROOT, "js/home/api.js"), "utf8");
  if (!homeApi.includes("enrichVariantsWithAvailableStock")) {
    errors.push("home/api.js not enriched with available stock");
  } else notes.push("Home/catalog variant fetch uses available stock");

  const checkout = readFileSync(join(ROOT, "js/checkout/index.js"), "utf8");
  if (!checkout.includes("validateCartAvailability")) {
    errors.push("checkout/index.js missing cart availability validation");
  } else notes.push("Checkout validates cart against available stock");

  const edge = readFileSync(join(ROOT, "supabase/functions/create-checkout-session/index.ts"), "utf8");
  if (!edge.includes("v_kk_variant_available_stock")) {
    errors.push("create-checkout-session missing available stock view");
  }
  if (!edge.includes("only ${available} available")) {
    errors.push("create-checkout-session missing insufficient-stock error");
  } else notes.push("create-checkout-session validates against available stock");

  const forbidden = [
    "supabase/functions/stripe-webhook/index.ts",
    "supabase/functions/shippo-webhook/index.ts",
  ];
  for (const rel of forbidden) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    if (src.includes("patchListingsItem")) errors.push(`Unexpected channel push in ${rel}`);
  }
  notes.push("No channel qty push in webhook functions");

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
    const resCountBefore = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;

    const viewExists = (await client.query(`
      SELECT COUNT(*)::int c FROM information_schema.views
      WHERE table_schema='public' AND table_name='v_kk_variant_available_stock'
    `)).rows[0].c;
    if (viewExists !== 1) errors.push("v_kk_variant_available_stock missing");
    else notes.push("KK available stock view exists");

    const { rows: sample } = await client.query(`
      SELECT variant_id, on_hand, reserved, available, available_display, is_available
      FROM v_kk_variant_available_stock
      WHERE reserved > 0
      ORDER BY reserved DESC
      LIMIT 3
    `);
    if (sample.length) {
      notes.push(`Reserved sample: ${JSON.stringify(sample)}`);
      for (const r of sample) {
        if (Number(r.available) !== Number(r.on_hand) - Number(r.reserved)) {
          errors.push(`available math wrong for variant ${r.variant_id}`);
        }
        if (Number(r.available_display) !== Math.max(Number(r.available), 0)) {
          errors.push(`available_display clamp wrong for variant ${r.variant_id}`);
        }
      }
    } else notes.push("No reserved variants in sample (may be OK)");

    const syncView = (await client.query(`
      SELECT COUNT(*)::int c FROM information_schema.views
      WHERE table_schema='public' AND table_name='v_inventory_channel_sync_candidates'
    `)).rows[0].c;
    if (syncView !== 1) errors.push("Phase 7A sync view missing");
    else notes.push("Phase 7A sync candidates view still present");

    const mode = (await client.query(`SELECT kk_reservation_mode FROM inventory_cutover_settings WHERE id=1`)).rows[0];
    if (mode?.kk_reservation_mode !== "reserve_only") {
      errors.push(`Expected reserve_only, got ${mode?.kk_reservation_mode}`);
    } else notes.push("kk_reservation_mode=reserve_only unchanged");

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resCountAfter = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;
    if (String(stockBefore) !== String(stockAfter) || resCountBefore !== resCountAfter) {
      errors.push("Stock or reservations changed during read-only verify");
    } else notes.push("No stock/reservation mutations during verify");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await client.end().catch(() => {});
  }

  return { notes, errors };
}

async function verifyInventoryPage() {
  const errors = [];
  const notes = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    const title = await page.title();
    if (!title.toLowerCase().includes("inventory")) notes.push(`Inventory page loaded (${title})`);

    const syncBtn = page.locator('[data-inventory-header-action="sync-channels"]');
    if (await syncBtn.count()) notes.push("Phase 7A Sync Channels control present");
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
  const allNotes = [];
  const allErrors = [];

  for (const [label, fn] of [
    ["Source files", () => verifySourceFiles()],
    ["Database", verifyDatabase],
    ["Inventory page", verifyInventoryPage],
  ]) {
    const { notes, errors } = await fn();
    allNotes.push(`--- ${label} ---`, ...notes);
    allErrors.push(...errors);
  }

  console.log("Phase 7B — KK Available Stock Alignment\n");
  for (const n of allNotes) console.log(`  ✓ ${n}`);
  if (allErrors.length) {
    console.error("\nFAILURES:");
    for (const e of allErrors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\nAll Phase 7B checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
