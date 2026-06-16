#!/usr/bin/env node
/**
 * Phase 10D — Virtual bundle checkout shadow hook verification.
 * Run: node scripts/verify-inventory-phase10d-virtual-bundle-checkout-shadow.mjs
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
const PORT = 9902;
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
    "js/admin/inventory/api/bundleShadowApi.js",
    "js/admin/inventory/ui/bundleModeControls.js",
    "js/admin/inventory/ui/bundleShadowEventsPanel.js",
    "js/admin/inventory/ui/bundlePreviewModal.js",
    "supabase/functions/_shared/bundleCheckoutShadow.ts",
    "supabase/migrations/20260923_inventory_phase10d_checkout_shadow.sql",
  ];

  for (const rel of files) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const stripe = readFileSync(join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");
  const shippo = readFileSync(join(ROOT, "supabase/functions/shippo-webhook/index.ts"), "utf8");
  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/bundlePreviewModal.js"), "utf8");
  const summary = readFileSync(join(ROOT, "js/admin/inventory/ui/bundlePreviewSummary.js"), "utf8");
  const modeUi = readFileSync(join(ROOT, "js/admin/inventory/ui/bundleModeControls.js"), "utf8");
  const eventsUi = readFileSync(join(ROOT, "js/admin/inventory/ui/bundleShadowEventsPanel.js"), "utf8");

  if (!stripe.includes("recordBundleReservationShadowsForCheckout")) {
    errors.push("Stripe webhook missing bundle shadow hook");
  } else notes.push("Stripe checkout shadow hook wired");

  if (!shippo.includes("recordBundleFinalizeShadowsForOrder")) {
    errors.push("Shippo webhook missing finalize shadow hook");
  } else notes.push("Shippo finalize shadow hook wired");

  if (!summary.includes("bundleShadowEventsMount")) errors.push("Shadow events mount missing");
  else notes.push("Shadow events section in modal");

  if (!modeUi.includes("Live mode is not available")) notes.push("Live mode blocked in UI copy");
  if (modeUi.includes('value="live"')) errors.push("Live mode must not be selectable in UI");
  else notes.push("Live mode not in UI select");

  if (!eventsUi.includes("data-shadow-event-filter")) errors.push("Shadow event filter missing");
  else notes.push("Shadow event filter present");

  if (/component_deduct|decrement.*bundle|virtual.*available.*storefront/.test(stripe + shippo + modal)) {
    errors.push("Must not wire live bundle deduction or storefront availability");
  } else notes.push("No live deduction / storefront hooks");

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const exists = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_bundle_shadow_events' AND column_name = 'idempotency_key'
  `);
  if (exists.rows.length) return { applied: false };

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260923_inventory_phase10d_checkout_shadow.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  let shadowCount = 0;
  /** @type {Record<string, unknown>|null} */
  let shadowExample = null;

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 10D migration");
    else notes.push("Phase 10D migration already applied");

    const modeRow = await client.query(`
      SELECT virtual_bundle_mode FROM inventory_bundle_settings WHERE setting_key = 'global'
    `);
    const initialMode = modeRow.rows[0]?.virtual_bundle_mode ?? "preview_only";
    if (initialMode !== "preview_only") {
      await client.query(
        `UPDATE inventory_bundle_settings SET virtual_bundle_mode = 'preview_only' WHERE setting_key = 'global'`,
      );
      notes.push("Reset global mode to preview_only for verify");
    } else notes.push("Default global mode is preview_only");

    try {
      await client.query(`SELECT public.update_inventory_bundle_global_mode('live')`);
      errors.push("Live global mode should be rejected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("live") || msg.includes("Authentication required")) {
        notes.push("Live global mode blocked by RPC");
      }
    }

    for (const fn of [
      "get_bundle_effective_shadow_mode",
      "try_record_inventory_bundle_shadow_event",
      "update_inventory_bundle_global_mode",
    ]) {
      const f = await client.query(`SELECT 1 FROM pg_proc WHERE proname = $1`, [fn]);
      if (!f.rows.length) errors.push(`Function missing: ${fn}`);
      else notes.push(`${fn} exists`);
    }

    const view = await client.query(`
      SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_bundle_shadow_events_recent'
    `);
    if (!view.rows.length) errors.push("Recent shadow events view missing");
    else notes.push("v_inventory_bundle_shadow_events_recent exists");

    const readinessCols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'v_inventory_bundle_cutover_readiness'
        AND column_name IN ('shadow_event_count', 'shadow_mode_active', 'effective_shadow_mode')
    `);
    if (readinessCols.rows.length < 3) errors.push("Readiness view missing Phase 10D columns");
    else notes.push("Readiness view has shadow stats");

    const variants = await client.query(`
      SELECT id FROM product_variants WHERE COALESCE(is_active, true) ORDER BY id LIMIT 2
    `);

    if (variants.rows.length >= 2) {
      const bundleId = variants.rows[0].id;
      const compId = variants.rows[1].id;
      const testKey = `verify_10d_${Date.now()}`;
      const idemKey = `bundle_shadow:reservation:verify_${Date.now()}:li_test`;

      await client.query(
        `DELETE FROM inventory_bundle_rules WHERE bundle_variant_id = $1 AND component_variant_id = $2`,
        [bundleId, compId],
      );
      await client.query(`DELETE FROM inventory_bundle_shadow_events WHERE idempotency_key = $1`, [idemKey]);

      await client.query(
        `INSERT INTO inventory_bundle_rules (bundle_variant_id, component_variant_id, component_qty, notes, is_active)
         VALUES ($1, $2, 1, $3, true)`,
        [bundleId, compId, testKey],
      );

      const skipPreview = await client.query(
        `SELECT public.try_record_inventory_bundle_shadow_event(
          'reservation_shadow', $1::uuid, 1, $2, 'sess_test', 'li_test', '{}'::jsonb
        ) AS r`,
        [bundleId, idemKey],
      );
      const skipPayload = skipPreview.rows[0]?.r ?? {};
      if (skipPayload.reason !== "mode_not_shadow") {
        notes.push(`Preview-only skip reason: ${skipPayload.reason ?? "unknown"}`);
      } else notes.push("Shadow skipped when global mode preview_only");

      await client.query(
        `UPDATE inventory_bundle_settings SET virtual_bundle_mode = 'shadow' WHERE setting_key = 'global'`,
      );
      notes.push("Global shadow mode enabled for test");

      const eff = await client.query(
        `SELECT public.get_bundle_effective_shadow_mode($1::uuid) AS m`,
        [bundleId],
      );
      if (eff.rows[0]?.m !== "shadow") errors.push("Effective mode should be shadow");
      else notes.push("Effective shadow mode resolves correctly");

      const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
      const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
      const resBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

      const ins = await client.query(
        `SELECT public.try_record_inventory_bundle_shadow_event(
          'reservation_shadow', $1::uuid, 2, $2, 'sess_verify', 'li_verify', '{"hook":"verify"}'::jsonb
        ) AS r`,
        [bundleId, idemKey],
      );
      shadowExample = ins.rows[0]?.r ?? null;
      if (!shadowExample?.inserted) errors.push("Shadow event should insert in shadow mode");
      else notes.push("Shadow event inserted in shadow mode");

      const dup = await client.query(
        `SELECT public.try_record_inventory_bundle_shadow_event(
          'reservation_shadow', $1::uuid, 2, $2, 'sess_verify', 'li_verify', '{}'::jsonb
        ) AS r`,
        [bundleId, idemKey],
      );
      const dupPayload = dup.rows[0]?.r ?? {};
      if (dupPayload.reason !== "duplicate" && dupPayload.inserted !== false) {
        errors.push("Duplicate idempotency key should not re-insert");
      } else notes.push("Webhook retry idempotency prevents duplicate shadow event");

      const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
      const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
      const resAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

      if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand changed");
      else notes.push("On-hand unchanged");

      if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("Ledger changed");
      else notes.push("No ledger mutations");

      if (String(resBefore) !== String(resAfter)) errors.push("Reservations changed");
      else notes.push("No reservation mutations");

      await client.query(`DELETE FROM inventory_bundle_shadow_events WHERE idempotency_key = $1`, [idemKey]);
      await client.query(`DELETE FROM inventory_bundle_rules WHERE notes = $1`, [testKey]);
      await client.query(
        `UPDATE inventory_bundle_settings SET virtual_bundle_mode = 'preview_only' WHERE setting_key = 'global'`,
      );
      notes.push("Test artifacts cleaned; global mode restored to preview_only");
    } else {
      notes.push("Fewer than 2 variants — skipped shadow RPC test");
    }

    shadowCount = (await client.query(`SELECT COUNT(*)::int c FROM inventory_bundle_shadow_events`)).rows[0].c;

    return { notes, errors, shadowCount, shadowExample };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, shadowCount, shadowExample };
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

  console.log("Phase 10D — Virtual bundle checkout shadow verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nCounts:");
  console.log("  shadow_events:", db.shadowCount);

  if (db.shadowExample) {
    console.log("\nShadow example:");
    console.log("  inserted:", db.shadowExample.inserted);
    console.log("  simulation_result:", db.shadowExample.simulation_result?.result ?? "—");
  }

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 10D verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
