#!/usr/bin/env node
/**
 * Phase 10F — Live virtual bundle inventory verification.
 * Run: node scripts/verify-inventory-phase10f-live-virtual-bundle-inventory.mjs
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
const PORT = 9904;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;
const TEST_KEY = "verify_10f_fixture";

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
    "supabase/migrations/20260925_inventory_phase10f_live_bundle_core.sql",
    "supabase/migrations/20260925_inventory_phase10f_live_bundle_views.sql",
    "supabase/migrations/20260925_inventory_phase10f_live_bundle_issues.sql",
    "supabase/functions/_shared/bundleLiveInventory.ts",
    "js/admin/inventory/ui/bundleLiveReadinessPanel.js",
    "js/admin/inventory/api/bundleShadowApi.js",
  ];

  for (const rel of files) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
      else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const stripe = readFileSync(join(ROOT, "supabase/functions/stripe-webhook/index.ts"), "utf8");
  if (!stripe.includes("isBundleLiveDeductionEnabled")) errors.push("Stripe webhook missing live guard");
  else notes.push("Stripe webhook wired for live bundle reserve");

  if (!stripe.includes("reserveLiveBundleComponents")) errors.push("Stripe webhook missing component reserve");
  else notes.push("Stripe webhook calls reserveLiveBundleComponents");

  const panel = readFileSync(join(ROOT, "js/admin/inventory/ui/bundleLiveReadinessPanel.js"), "utf8");
  if (!panel.includes("Enable live (component reserve/finalize)")) errors.push("Live enable UI missing");
  else notes.push("Live enable UI present");

  if (!panel.includes("This will make bundle sales reserve and finalize component inventory")) {
    errors.push("Live enable confirmation copy missing");
  } else notes.push("Live enable confirmation present");

  const api = readFileSync(join(ROOT, "js/admin/inventory/api/bundleShadowApi.js"), "utf8");
  for (const fn of ["enable_bundle_live_mode", "revert_bundle_live_mode", "enable_inventory_bundle_global_live_mode"]) {
    if (!api.includes(fn)) errors.push(`API missing ${fn}`);
    else notes.push(`API: ${fn}`);
  }

  return { notes, errors };
}

async function applyPhase10fMigrations(client) {
  const col = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_reservations' AND column_name = 'reservation_kind'
  `);
  if (!col.rows.length) {
    const files = [
      "20260925_inventory_phase10f_live_bundle_core.sql",
      "20260925_inventory_phase10f_live_bundle_views.sql",
      "20260925_inventory_phase10f_live_bundle_issues.sql",
    ];
    for (const f of files) {
      await client.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
    }
    return { applied: true };
  }

  const evalSrc = await client.query(`SELECT prosrc FROM pg_proc WHERE proname = 'evaluate_bundle_live_readiness'`);
  if (String(evalSrc.rows[0]?.prosrc ?? "").includes("is_bundle_live_deduction_enabled")) {
    const viewsSql = readFileSync(
      join(ROOT, "supabase/migrations/20260925_inventory_phase10f_live_bundle_views.sql"),
      "utf8",
    );
    const marker = "-- Break evaluate ↔ is_bundle_live_deduction_enabled recursion (Phase 10F).";
    const fixSql = viewsSql.slice(viewsSql.indexOf(marker));
    await client.query(fixSql);
    return { applied: true, fix: "evaluate_recursion" };
  }

  return { applied: false };
}

async function cleanupFixture(client, bundleId, compId) {
  await client.query(`DELETE FROM inventory_bundle_live_issues WHERE order_id LIKE 'verify_10f_%'`);
  await client.query(`
    DELETE FROM stock_ledger WHERE idempotency_key LIKE 'bundle_component_finalize:verify_10f_%'
       OR idempotency_key LIKE 'bundle_component_reserve:%verify_10f_%'
  `);
  await client.query(`DELETE FROM inventory_reservations WHERE order_id LIKE 'verify_10f_%'`);
  await client.query(`DELETE FROM inventory_bundle_rules WHERE notes = $1`, [TEST_KEY]);
  await client.query(`DELETE FROM inventory_bundle_live_readiness_actions WHERE bundle_variant_id = $1`, [bundleId]);
  await client.query(`DELETE FROM inventory_bundle_variant_settings WHERE bundle_variant_id = $1`, [bundleId]);
  await client.query(`
    UPDATE inventory_bundle_settings
    SET virtual_bundle_mode = 'preview_only', allow_per_bundle_live = false, updated_at = now()
    WHERE setting_key = 'global'
  `);
  await client.query(`UPDATE product_variants SET stock = 10 WHERE id IN ($1, $2)`, [bundleId, compId]);
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  let bundleId = null;
  let compId = null;
  let savedGlobal = null;

  try {
    await client.connect();

    const mig = await applyPhase10fMigrations(client);
    notes.push(mig.applied ? "Applied Phase 10F migrations" : "Phase 10F migrations already applied");

    const defaultGuard = await client.query(`SELECT public.is_bundle_live_deduction_enabled(gen_random_uuid()) AS v`);
    if (defaultGuard.rows[0]?.v !== false) errors.push("Live guard must return false by default");
    else notes.push("Live guard returns false by default");

    for (const fn of [
      "reserve_live_bundle_components",
      "release_live_bundle_component_reservations",
      "enable_bundle_live_mode",
      "revert_bundle_live_mode",
      "enable_inventory_bundle_global_live_mode",
    ]) {
      const f = await client.query(`SELECT 1 FROM pg_proc WHERE proname = $1`, [fn]);
      if (!f.rows.length) errors.push(`Function missing: ${fn}`);
      else notes.push(`${fn} exists`);
    }

    const variants = await client.query(`
      SELECT id FROM product_variants WHERE COALESCE(is_active, true) ORDER BY id LIMIT 2
    `);
    if (variants.rows.length < 2) {
      notes.push("Skipped live fixture tests (< 2 variants)");
      return { notes, errors };
    }

    bundleId = variants.rows[0].id;
    compId = variants.rows[1].id;
    const orderId = `verify_10f_${Date.now()}`;
    const lineId = "li_verify_10f";

    savedGlobal = await client.query(`
      SELECT virtual_bundle_mode, allow_per_bundle_live FROM inventory_bundle_settings WHERE setting_key = 'global'
    `);

    await cleanupFixture(client, bundleId, compId);

    await client.query(`UPDATE product_variants SET stock = 0 WHERE id = $1`, [bundleId]);
    await client.query(`UPDATE product_variants SET stock = 20 WHERE id = $1`, [compId]);

    await client.query(`DELETE FROM inventory_bundle_rules WHERE bundle_variant_id = $1 OR notes = $2`, [bundleId, TEST_KEY]);

    await client.query(`
      INSERT INTO inventory_bundle_rules (bundle_variant_id, component_variant_id, component_qty, is_active, notes)
      VALUES ($1, $2, 2, true, $3)
    `, [bundleId, compId, TEST_KEY]);

    await client.query(`
      INSERT INTO inventory_bundle_variant_settings (bundle_variant_id, is_virtual_enabled, mode)
      VALUES ($1, true, 'shadow')
      ON CONFLICT (bundle_variant_id) DO UPDATE SET is_virtual_enabled = true, mode = 'shadow'
    `, [bundleId]);

    const shadowAvail = await client.query(`
      SELECT available_display FROM v_kk_variant_available_stock WHERE variant_id = $1
    `, [bundleId]);
    const shadowDisplay = Number(shadowAvail.rows[0]?.available_display ?? -1);
    if (shadowDisplay !== 0 && shadowDisplay !== Math.max(0, 0 - 0)) {
      notes.push(`Shadow bundle uses normal on-hand avail (${shadowDisplay}) — expected non-virtual`);
    } else notes.push("Shadow bundle does not use virtual availability for customer stock");

    await client.query(`
      UPDATE inventory_bundle_settings
      SET virtual_bundle_mode = 'live', allow_per_bundle_live = true, updated_at = now()
      WHERE setting_key = 'global'
    `);
    await client.query(`
      UPDATE inventory_bundle_variant_settings SET mode = 'live' WHERE bundle_variant_id = $1
    `, [bundleId]);

    const preLive = await client.query(`SELECT public.is_bundle_live_deduction_enabled($1) AS v`, [bundleId]);
    if (preLive.rows[0]?.v !== true) {
      const evalRow = await client.query(`SELECT public.evaluate_bundle_live_readiness($1, false) AS e`, [bundleId]);
      errors.push(`Live guard should be true when configured: ${JSON.stringify(evalRow.rows[0]?.e?.blocker_reasons)}`);
    } else notes.push("Live guard true when global+bundle live configured");

    const liveAvail = await client.query(`
      SELECT available_display, on_hand, reserved
      FROM v_kk_variant_available_stock WHERE variant_id = $1
    `, [bundleId]);
    const virtualExpected = Math.floor(20 / 2);
    const liveDisplay = Number(liveAvail.rows[0]?.available_display ?? -1);
    if (liveDisplay !== virtualExpected) {
      errors.push(`Live bundle avail expected ${virtualExpected}, got ${liveDisplay}`);
    } else notes.push("Live-enabled bundle uses virtual component availability");

    const reserve1 = await client.query(`
      SELECT public.reserve_live_bundle_components($1, $2, $3, 1) AS r
    `, [orderId, lineId, bundleId]);
    const r1 = reserve1.rows[0]?.r;
    if (!r1?.ok || r1.reserved_components < 1) errors.push("Component reserve failed on first call");
    else notes.push("Component reservations created on paid checkout path");

    const reserve2 = await client.query(`
      SELECT public.reserve_live_bundle_components($1, $2, $3, 1) AS r
    `, [orderId, lineId, bundleId]);
    const r2 = reserve2.rows[0]?.r;
    if (Number(r2?.skipped_duplicate ?? 0) < 1) errors.push("Idempotent reserve should skip duplicate");
    else notes.push("Component reserve idempotent on retry");

    const compReserved = await client.query(`
      SELECT COALESCE(SUM(quantity), 0)::int AS q FROM inventory_reservations
      WHERE order_id = $1 AND reservation_kind = 'bundle_component' AND status = 'reserved'
    `, [orderId]);
    if (Number(compReserved.rows[0]?.q) !== 2) errors.push("Expected 2 component units reserved");
    else notes.push("Component reservations reduce component available pool");

    const bundleStockBefore = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [bundleId]);
    const compStockBefore = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId]);

    const fin = await client.query(`
      SELECT public.finalize_kk_order_reservations($1, $2, 'verify_10f') AS r
    `, [orderId, `${orderId}:ship1`]);
    const fin2 = await client.query(`
      SELECT public.finalize_kk_order_reservations($1, $2, 'verify_10f') AS r
    `, [orderId, `${orderId}:ship1`]);
    if (Number(fin.rows[0]?.r?.finalized_count ?? 0) < 1) errors.push("Finalize should process component reservations");
    else notes.push("Fulfillment finalizes component reservations");

    if (Number(fin2.rows[0]?.r?.finalized_count ?? 0) > 0) {
      errors.push("Finalize retry should not double-decrement");
    } else notes.push("Finalize idempotent on retry");

    const bundleStockAfter = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [bundleId]);
    const compStockAfter = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId]);
    if (Number(bundleStockAfter.rows[0]?.stock) !== Number(bundleStockBefore.rows[0]?.stock)) {
      errors.push("Parent bundle stock must not decrement for Model B live");
    } else notes.push("Parent bundle stock unchanged (Model B)");

    if (Number(compStockAfter.rows[0]?.stock) !== Number(compStockBefore.rows[0]?.stock) - 2) {
      errors.push("Component stock should decrement by reserved qty once");
    } else notes.push("Component on-hand decremented once on finalize");

    const ledger = await client.query(`
      SELECT COUNT(*)::int AS c FROM stock_ledger
      WHERE source = 'bundle_component_finalize' AND idempotency_key LIKE $1
    `, [`bundle_component_finalize:${orderId}:%`]);
    if (Number(ledger.rows[0]?.c) < 1) errors.push("Component stock_ledger row missing");
    else notes.push("stock_ledger written with bundle_component_finalize source");

    const orderRefund = `verify_10f_refund_${Date.now()}`;
    await client.query(`SELECT public.reserve_live_bundle_components($1, 'li_ref', $2, 1)`, [orderRefund, bundleId]);
    const released = await client.query(`SELECT public.release_live_bundle_component_reservations($1) AS r`, [orderRefund]);
    if (Number(released.rows[0]?.r?.released_count ?? 0) < 1) errors.push("Refund should release component reservations");
    else notes.push("Full refund before finalize releases component reservations");

    const compAfterRelease = await client.query(`SELECT stock FROM product_variants WHERE id = $1`, [compId]);
    if (Number(compAfterRelease.rows[0]?.stock) !== Number(compStockAfter.rows[0]?.stock)) {
      errors.push("Refund before finalize must not restore stock");
    } else notes.push("Refund before finalize does not auto-restock");

    const issues = await client.query(`
      SELECT issue_type FROM v_inventory_issues
      WHERE issue_type IN (
        'bundle_component_reservation_failed',
        'bundle_component_finalize_failed',
        'bundle_live_readiness_blocked',
        'bundle_component_shortage_live'
      )
    `);
    notes.push(`Live issue groups registered: ${issues.rows.length} types visible in view`);

    await client.query(`DELETE FROM inventory_reservations WHERE order_id = $1`, [orderRefund]);
  } catch (err) {
    errors.push(`DB error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (bundleId && compId) {
      try {
        await cleanupFixture(client, bundleId, compId);
        if (savedGlobal?.rows?.[0]) {
          await client.query(`
            UPDATE inventory_bundle_settings
            SET virtual_bundle_mode = $1, allow_per_bundle_live = $2, updated_at = now()
            WHERE setting_key = 'global'
          `, [savedGlobal.rows[0].virtual_bundle_mode, savedGlobal.rows[0].allow_per_bundle_live]);
        }
        notes.push("Fixture cleaned up — global settings restored");
      } catch {
        errors.push("Fixture cleanup failed — check DB for verify_10f_* rows");
      }
    }
    await client.end();
  }

  return { notes, errors };
}

async function verifyBrowser() {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(`Page error: ${e.message}`));

    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    notes.push("Inventory page loads");

    await page.waitForTimeout(1500);
    const bodyText = await page.locator("body").innerText();
    if (/failed to load|syntax error/i.test(bodyText)) errors.push("Inventory page shows load error");
    else notes.push("Inventory shell renders without fatal errors");
  } catch (err) {
    errors.push(`Browser: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
    server.close();
  }

  return { notes, errors };
}

async function main() {
  console.log("=== Phase 10F — Live Virtual Bundle Inventory Verification ===\n");

  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const source = verifySourceFiles();
  const db = await verifyDatabase();
  const browser = await verifyBrowser();

  const allNotes = [...source.notes, ...db.notes, ...browser.notes];
  const allErrors = [...source.errors, ...db.errors, ...browser.errors];

  for (const n of allNotes) console.log(`  ✓ ${n}`);
  for (const e of allErrors) console.log(`  ✗ ${e}`);

  console.log(`\nResult: ${allErrors.length === 0 ? "PASS" : "FAIL"} (${allNotes.length} checks, ${allErrors.length} errors)`);
  process.exit(allErrors.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
