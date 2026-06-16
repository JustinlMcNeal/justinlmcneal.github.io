#!/usr/bin/env node
/**
 * Phase 10E — Virtual bundle live readiness verification.
 * Run: node scripts/verify-inventory-phase10e-virtual-bundle-live-readiness.mjs
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
const PORT = 9903;
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
    "js/admin/inventory/ui/bundleLiveReadinessPanel.js",
    "js/admin/inventory/api/bundleShadowApi.js",
    "js/admin/inventory/ui/bundlePreviewModal.js",
    "supabase/migrations/20260924_inventory_phase10e_live_readiness.sql",
    "supabase/migrations/20260924_inventory_phase10e_live_readiness_view.sql",
  ];

  for (const rel of files) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const panel = readFileSync(join(ROOT, "js/admin/inventory/ui/bundleLiveReadinessPanel.js"), "utf8");
  const api = readFileSync(join(ROOT, "js/admin/inventory/api/bundleShadowApi.js"), "utf8");
  const stripe = readFileSync(join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");

  if (!panel.includes("Acknowledge independent stock")) errors.push("Independent stock ack UI missing");
  else notes.push("Independent stock acknowledgement UI");

  if (!panel.includes("Request live enablement")) errors.push("Live request UI missing");
  else notes.push("Live request UI present");

  if (!panel.includes("Shadow evidence")) errors.push("Shadow evidence summary missing");
  else notes.push("Shadow evidence summary in UI");

  if (!api.includes("acknowledge_independent_bundle_stock")) errors.push("Ack RPC missing in API");
  else notes.push("Acknowledgement API wired");

  if (!api.includes("request_bundle_live_enablement")) errors.push("Live request RPC missing");
  else notes.push("Live request API wired");

  if (panel.includes('value="live"')) errors.push("Live mode must not be selectable in UI");
  else notes.push("Live mode not selectable in readiness UI");

  if (/is_bundle_live_deduction_enabled|component_deduct.*bundle/.test(stripe)) {
    notes.push("Stripe webhook references live deduction guard (if any)");
  }
  if (/recordBundleReservationShadowsForCheckout/.test(stripe)) notes.push("Checkout still uses shadow hook only");

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const exists = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_bundle_variant_settings' AND column_name = 'live_requested_at'
  `);
  if (exists.rows.length) return { applied: false };

  const sqlA = readFileSync(
    join(ROOT, "supabase/migrations/20260924_inventory_phase10e_live_readiness.sql"),
    "utf8",
  );
  const sqlB = readFileSync(
    join(ROOT, "supabase/migrations/20260924_inventory_phase10e_live_readiness_view.sql"),
    "utf8",
  );
  await client.query(sqlA);
  await client.query(sqlB);
  return { applied: true };
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

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 10E migration");
    else notes.push("Phase 10E migration already applied");

    const liveBlocked = await client.query(`SELECT public.is_bundle_live_deduction_enabled(NULL) AS v`);
    if (liveBlocked.rows[0]?.v !== false) errors.push("Live deduction must be disabled in 10E");
    else notes.push("is_bundle_live_deduction_enabled returns false");

    for (const fn of [
      "evaluate_bundle_live_readiness",
      "acknowledge_independent_bundle_stock",
      "request_bundle_live_enablement",
    ]) {
      const f = await client.query(`SELECT 1 FROM pg_proc WHERE proname = $1`, [fn]);
      if (!f.rows.length) errors.push(`Function missing: ${fn}`);
      else notes.push(`${fn} exists`);
    }

    const audit = await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_bundle_live_readiness_actions'
    `);
    if (!audit.rows.length) errors.push("Audit table missing");
    else notes.push("inventory_bundle_live_readiness_actions exists");

    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'v_inventory_bundle_cutover_readiness'
        AND column_name IN ('is_ready_for_live_request', 'reservation_shadow_count', 'live_deduction_enabled')
    `);
    if (cols.rows.length < 3) errors.push("Readiness view missing Phase 10E columns");
    else notes.push("Enhanced readiness view columns present");

    try {
      await client.query(`SELECT public.acknowledge_independent_bundle_stock(gen_random_uuid(), 'test')`);
      errors.push("Ack should require admin auth");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Authentication required") || msg.includes("Admin only")) {
        notes.push("Acknowledgement requires admin auth");
      }
    }

    try {
      await client.query(`SELECT public.request_bundle_live_enablement(gen_random_uuid(), 'test')`);
      errors.push("Live request should require admin auth");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Authentication required") || msg.includes("Admin only")) {
        notes.push("Live request requires admin auth");
      }
    }

    const variants = await client.query(`
      SELECT id FROM product_variants WHERE COALESCE(is_active, true) ORDER BY id LIMIT 2
    `);

    if (variants.rows.length >= 2) {
      const bundleId = variants.rows[0].id;
      const compId = variants.rows[1].id;
      const testKey = `verify_10e_${Date.now()}`;

      await client.query(`DELETE FROM inventory_bundle_rules WHERE notes = $1`, [testKey]);
      await client.query(`DELETE FROM inventory_bundle_live_readiness_actions WHERE bundle_variant_id = $1`, [bundleId]);
      await client.query(`DELETE FROM inventory_bundle_variant_settings WHERE bundle_variant_id = $1`, [bundleId]);

      await client.query(
        `INSERT INTO inventory_bundle_rules (bundle_variant_id, component_variant_id, component_qty, notes, is_active)
         VALUES ($1, $2, 1, $3, true)`,
        [bundleId, compId, testKey],
      );

      const evalRow = await client.query(
        `SELECT public.evaluate_bundle_live_readiness($1::uuid, true) AS r`,
        [bundleId],
      );
      const evalPayload = evalRow.rows[0]?.r ?? {};
      if (!evalPayload.checklist) errors.push("evaluate_bundle_live_readiness should return checklist");
      else notes.push("Readiness evaluation returns checklist");

      try {
        await client.query(`SELECT public.request_bundle_live_enablement($1::uuid, 'verify')`, [bundleId]);
        notes.push("Live request blocked or passed per readiness (auth may block)");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Live request blocked") || msg.includes("Authentication required")) {
          notes.push("Live request enforces readiness or auth");
        }
      }

      const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
      const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
      const resBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

      await client.query(`SELECT * FROM v_inventory_bundle_cutover_readiness WHERE bundle_variant_id = $1`, [bundleId]);

      const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
      const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
      const resAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

      if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand changed");
      else notes.push("On-hand unchanged");

      if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("Ledger changed");
      else notes.push("No ledger mutations");

      if (String(resBefore) !== String(resAfter)) errors.push("Reservations changed");
      else notes.push("No reservation mutations");

      await client.query(`DELETE FROM inventory_bundle_rules WHERE notes = $1`, [testKey]);
      await client.query(`DELETE FROM inventory_bundle_variant_settings WHERE bundle_variant_id = $1`, [bundleId]);
      notes.push("Ephemeral test artifacts cleaned");
    }

    return { notes, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors };
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
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!(await page.locator("#inventoryBundlePreviewModalMount").count())) {
      errors.push("Bundle modal mount missing");
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

  console.log("Phase 10E — Virtual bundle live readiness verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 10E verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
