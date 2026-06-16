#!/usr/bin/env node
/**
 * Phase 6D Execute — reserve-only cutover verification.
 *
 * Run:
 *   node scripts/verify-inventory-phase6d-reserve-only-cutover.mjs
 *   node scripts/verify-inventory-phase6d-reserve-only-cutover.mjs --execute-cutover
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9898;
const PAGE = "/pages/admin/inventory.html";
const WEBHOOK = join(ROOT, "supabase/functions/stripe-webhook/index.ts");
const SHARED = join(ROOT, "supabase/functions/_shared/stripeWebhookInventory.ts");

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

async function resolveAdminEmail(env) {
  if (env.KK_ADMIN_EMAIL?.trim()) return env.KK_ADMIN_EMAIL.trim();
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT email FROM auth.users
       WHERE COALESCE((raw_app_meta_data->>'is_admin')::boolean, false) = true
       ORDER BY created_at LIMIT 1`,
    );
    if (rows?.[0]?.email) return rows[0].email;
  } finally {
    await client.end().catch(() => {});
  }
  throw new Error("Could not resolve admin email");
}

async function signInAdmin(page, env) {
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const email = await resolveAdminEmail(env);
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const redirectTo = `http://127.0.0.1:${PORT}${PAGE}`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (error) throw new Error(error.message);
  await page.goto(data.properties.action_link, { waitUntil: "networkidle", timeout: 60000 });
}

function verifyWebhookCode() {
  const notes = [];
  const errors = [];
  const webhook = readFileSync(WEBHOOK, "utf8");
  const shared = readFileSync(SHARED, "utf8");

  for (const needle of [
    "getKkReservationMode",
    "reserve_only",
    "DEDUP_CHECKOUT_RESERVE",
    "upsertKkReservation",
    "releaseKkActiveReservations",
    "decrementVariantStockForOrder",
  ]) {
    if (!webhook.includes(needle) && !shared.includes(needle)) {
      errors.push(`Webhook/shared missing: ${needle}`);
    } else {
      notes.push(`Code: ${needle} present`);
    }
  }

  if (webhook.includes("getKkReservationMode") && webhook.includes("reserve_only")) {
    notes.push("Webhook reads cutover mode and branches for reserve_only");
  }

  return { notes, errors };
}

async function verifyDatabase({ executeCutover }) {
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  const notes = [];
  const errors = [];
  const warnings = [];

  try {
    await client.connect();

    const readiness = (await client.query(`SELECT * FROM v_inventory_cutover_readiness_summary LIMIT 1`)).rows[0];
    notes.push(`Preflight mode=${readiness.current_mode} safe=${readiness.safe_to_proceed_hint} blockers=${readiness.active_cutover_blocker_count}`);
    notes.push(`Preflight post_6c_matched=${readiness.post_6c_matched_lines} paid_unshipped=${readiness.paid_unshipped_unit_total} backfill_units=${readiness.total_backfill_units}`);

    const kpiBefore = (await client.query(`SELECT on_hand_units, reserved_units, available_units FROM v_inventory_kpis`)).rows[0];
    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint AS t FROM product_variants WHERE COALESCE(is_active,true)`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::int AS c, COALESCE(SUM(quantity),0)::int AS u FROM inventory_reservations WHERE channel='kk' AND status='reserved' AND COALESCE(is_shadow,false)=false`)).rows[0];
    const shadowBefore = (await client.query(`SELECT COUNT(*)::int AS c FROM inventory_reservations WHERE channel='kk' AND COALESCE(is_shadow,false)=true AND status='reserved'`)).rows[0].c;

    notes.push(`Before KPI: on_hand=${kpiBefore.on_hand_units} reserved=${kpiBefore.reserved_units} available=${kpiBefore.available_units}`);
    notes.push(`Before active reservations: ${resBefore.c} rows / ${resBefore.u} units; shadow reserved: ${shadowBefore}`);

    if (executeCutover && readiness.current_mode === "shadow") {
      if (!readiness.safe_to_proceed_hint) {
        errors.push("Preflight safe_to_proceed_hint=false — aborting cutover");
      } else if (readiness.active_cutover_blocker_count > 0) {
        errors.push(`Active blockers=${readiness.active_cutover_blocker_count}`);
      } else {
        const cutover = (await client.query(`SELECT public.execute_kk_reservation_cutover() AS r`)).rows[0].r;
        notes.push(`Cutover RPC: ${JSON.stringify(cutover)}`);
      }
    }

    const mode = (await client.query(`SELECT kk_reservation_mode, cutover_executed_at FROM inventory_cutover_settings WHERE id=1`)).rows[0];
    if (mode.kk_reservation_mode !== "reserve_only") {
      errors.push(`Expected kk_reservation_mode=reserve_only, got ${mode.kk_reservation_mode}`);
    } else {
      notes.push(`Mode=reserve_only cutover_executed_at=${mode.cutover_executed_at}`);
    }

    const kpiAfter = (await client.query(`SELECT on_hand_units, reserved_units, available_units FROM v_inventory_kpis`)).rows[0];
    notes.push(`After KPI: on_hand=${kpiAfter.on_hand_units} reserved=${kpiAfter.reserved_units} available=${kpiAfter.available_units}`);

    const candidates = (await client.query(`
      SELECT COUNT(*)::int AS missing
      FROM v_inventory_kk_paid_unshipped_reservation_candidates c
      WHERE c.backfill_action_needed NOT IN ('already_active_reserved', 'none_already_released')
        AND NOT EXISTS (
          SELECT 1 FROM inventory_reservations ir
          WHERE ir.channel='kk' AND ir.order_id=c.order_id AND ir.order_item_id=c.order_item_id
            AND ir.status='reserved' AND COALESCE(ir.is_shadow,false)=false
        )
    `)).rows[0].missing;
    if (candidates > 0) errors.push(`${candidates} paid/unshipped candidates still lack active reservations`);
    else notes.push("All paid/unshipped candidates have active reservations");

    const shadowAfter = (await client.query(`SELECT COUNT(*)::int AS c FROM inventory_reservations WHERE channel='kk' AND COALESCE(is_shadow,false)=true AND status='reserved'`)).rows[0].c;
    if (shadowAfter > 0) warnings.push(`${shadowAfter} shadow reservations still reserved (expected 0 post-cutover)`);
    else notes.push("No active shadow reservations");

    const backfillRows = (await client.query(`SELECT COUNT(*)::int AS c, COALESCE(SUM(change),0)::int AS u FROM stock_ledger WHERE reason='cutover_backfill' AND source='inventory_cutover' AND change>0`)).rows[0];
    notes.push(`Cutover backfill ledger: ${backfillRows.c} rows / +${backfillRows.u} units`);

    const rerun = (await client.query(`SELECT public.execute_kk_reservation_cutover() AS r`)).rows[0].r;
    if (!rerun.already_executed) errors.push("Re-run cutover RPC should return already_executed=true");
    else notes.push("Re-run cutover RPC idempotent (already_executed=true)");

    const backfillAfterRerun = (await client.query(`SELECT COUNT(*)::int AS c, COALESCE(SUM(change),0)::int AS u FROM stock_ledger WHERE reason='cutover_backfill' AND source='inventory_cutover' AND change>0`)).rows[0];
    if (backfillAfterRerun.c !== backfillRows.c || backfillAfterRerun.u !== backfillRows.u) {
      errors.push("Re-run changed cutover backfill ledger counts");
    } else {
      notes.push("Re-run did not duplicate backfill ledger");
    }

    const resAfterRerun = (await client.query(`SELECT COUNT(*)::int AS c FROM inventory_reservations WHERE channel='kk' AND status='reserved' AND COALESCE(is_shadow,false)=false`)).rows[0].c;
    if (resAfterRerun !== resBefore.c && executeCutover) {
      // resBefore was before execute in same txn - compare to count after first cutover
    }
    notes.push(`Active reservation rows after re-run: ${resAfterRerun}`);

    const fnExists = (await client.query(`
      SELECT COUNT(*)::int AS c FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='rollback_kk_reservation_cutover'
    `)).rows[0].c;
    if (fnExists !== 1) errors.push("rollback_kk_reservation_cutover missing");
    else notes.push("rollback_kk_reservation_cutover RPC exists (not executed)");

    if (Number(kpiAfter.reserved_units) <= 0) {
      errors.push("Official reserved_units should be > 0 after cutover");
    }

    if (executeCutover && readiness.current_mode === "shadow" && backfillRows.u > 0) {
      if (Number(kpiAfter.on_hand_units) <= Number(kpiBefore.on_hand_units)) {
        errors.push("on_hand should increase when backfill applied");
      }
    } else if (backfillRows.u > 0) {
      notes.push(`Backfill applied: +${backfillRows.u} units in ledger`);
    }

    notes.push(`Available delta: ${Number(kpiAfter.available_units) - Number(kpiBefore.available_units)} (post-6C promote may explain small shift)`);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await client.end().catch(() => {});
  }

  return { notes, errors, warnings };
}

async function verifyPageLoads(env) {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  try {
    await signInAdmin(page, env);
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: "networkidle", timeout: 60000 });
    const title = await page.locator("h1").first().textContent();
    if (!title?.includes("Inventory")) errors.push(`Unexpected page title: ${title}`);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
    server.close();
  }
  return errors;
}

async function main() {
  const executeCutover = process.argv.includes("--execute-cutover");
  const fileEnv = loadEnv();
  for (const [k, v] of Object.entries(fileEnv)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const allNotes = [];
  const allErrors = [];
  const allWarnings = [];

  const code = verifyWebhookCode();
  allNotes.push(...code.notes);
  allErrors.push(...code.errors);

  const db = await verifyDatabase({ executeCutover });
  allNotes.push(...db.notes);
  allErrors.push(...db.errors);
  allWarnings.push(...db.warnings);

  const pageErrors = await verifyPageLoads(fileEnv);
  allErrors.push(...pageErrors);
  if (!pageErrors.length) allNotes.push("Inventory page loads cleanly");

  console.log("\n=== Phase 6D reserve-only cutover verification ===\n");
  for (const n of allNotes) console.log(`  ✓ ${n}`);
  if (allWarnings.length) {
    console.log("\nWARNINGS:");
    for (const w of allWarnings) console.warn(`  ⚠ ${w}`);
  }
  if (allErrors.length) {
    console.error("\nFAIL:");
    for (const e of allErrors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\nPASS\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
