/**
 * Phase 6D-Validation — shadow checkout validation readiness (read-only).
 * Run: node scripts/verify-inventory-phase6d-validation-readiness.mjs
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
const PORT = 9899;
const PAGE = "/pages/admin/inventory.html";
const WEBHOOK = join(ROOT, "supabase/functions/stripe-webhook/index.ts");

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
  process.env.SUPABASE_DB_PASSWORD =
    env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
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

async function verifyDatabase() {
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  const notes = [];
  const errors = [];
  const warnings = [];

  try {
    await client.connect();

    const stockBefore = (
      await client.query(
        `SELECT COALESCE(SUM(stock),0)::bigint AS t FROM product_variants WHERE COALESCE(is_active,true)`,
      )
    ).rows[0].t;

    const resBefore = (
      await client.query(`SELECT COUNT(*)::int AS c FROM inventory_reservations`)
    ).rows[0].c;

    const settings = await client.query(`
      SELECT kk_reservation_mode, shadow_mode_started_at
      FROM inventory_cutover_settings WHERE id = 1
    `);
    const mode = settings.rows[0]?.kk_reservation_mode;
    if (mode !== "shadow") errors.push(`Expected mode shadow, got ${mode}`);
    else notes.push(`kk_reservation_mode=${mode}`);

    if (settings.rows[0]?.shadow_mode_started_at) {
      notes.push(`shadow_mode_started_at=${settings.rows[0].shadow_mode_started_at}`);
    } else {
      warnings.push("shadow_mode_started_at not set");
    }

    const summary = await client.query(`SELECT * FROM v_inventory_cutover_readiness_summary`);
    const s = summary.rows[0];
    if (!s) errors.push("readiness summary empty");
    else {
      notes.push(`post_6c_matched_lines=${s.post_6c_matched_lines}`);
      notes.push(`requires_post_6c_checkout_validation=${s.requires_post_6c_checkout_validation}`);
      notes.push(`active_cutover_blocker_count=${s.active_cutover_blocker_count}`);
      notes.push(`historical_warning_count=${s.historical_warning_count}`);
      notes.push(`safe_to_proceed_hint=${s.safe_to_proceed_hint}`);
      notes.push(
        `paid/unshipped: ${s.paid_unshipped_line_count} lines, ${s.paid_unshipped_unit_total} units, backfill +${s.total_stock_increase_units}`,
      );

      if (Number(s.active_cutover_blocker_count) > 0) {
        const blockers = await client.query(
          `SELECT blocker_type, COUNT(*)::int AS c FROM v_inventory_cutover_active_blockers GROUP BY 1`,
        );
        for (const b of blockers.rows) {
          warnings.push(`blocker ${b.blocker_type}: ${b.c}`);
        }
      }

      if (s.requires_post_6c_checkout_validation) {
        warnings.push("Post-6C checkout validation still required before 6D execute");
      }
    }

    const officialKpi = await client.query(
      `SELECT reserved_units, available_units, on_hand_units FROM v_inventory_kpis`,
    );
    const k = officialKpi.rows[0];
    notes.push(`official KPI reserved=${k.reserved_units}, available=${k.available_units}`);

    const shadowKpi = await client.query(
      `SELECT shadow_reserved_units, shadow_reservation_rows FROM v_inventory_shadow_kpis`,
    );
    const sk = shadowKpi.rows[0];
    notes.push(`shadow KPI reserved=${sk.shadow_reserved_units}, rows=${sk.shadow_reservation_rows}`);

    if (Number(k.reserved_units) > 0 && Number(sk.shadow_reserved_units) > 0) {
      warnings.push("Both official and shadow reserved > 0 — verify is_shadow exclusion");
    }

    const activeRes = await client.query(`
      SELECT COUNT(*)::int AS c FROM inventory_reservations
      WHERE COALESCE(is_shadow,false)=false AND status='reserved'
    `);
    if (Number(activeRes.rows[0].c) > 0) {
      warnings.push(`Unexpected active reserved reservations: ${activeRes.rows[0].c}`);
    } else {
      notes.push("No active (non-shadow) reserved reservations");
    }

    const matched = await client.query(`
      SELECT COUNT(*)::int AS c FROM v_inventory_shadow_reservation_reconciliation WHERE is_match
    `);
    notes.push(`reconciliation matched rows=${matched.rows[0].c}`);

    const webhookText = readFileSync(WEBHOOK, "utf8");
    if (webhookText.includes("inventory_cutover_settings")) {
      errors.push("Webhook reads cutover settings — not allowed in validation phase");
    } else {
      notes.push("Webhook unchanged (no cutover settings read)");
    }

    const stockAfter = (
      await client.query(
        `SELECT COALESCE(SUM(stock),0)::bigint AS t FROM product_variants WHERE COALESCE(is_active,true)`,
      )
    ).rows[0].t;
    const resAfter = (
      await client.query(`SELECT COUNT(*)::int AS c FROM inventory_reservations`)
    ).rows[0].c;

    if (stockBefore !== stockAfter) errors.push("Stock changed during script run");
    else notes.push("Stock unchanged by script");

    if (resBefore !== resAfter) errors.push("Reservations changed during script run");
    else notes.push("Reservations unchanged by script");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await client.end().catch(() => {});
  }

  return { notes, errors, warnings };
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const errors = [];
  const notes = [];
  const warnings = [];

  const db = await verifyDatabase();
  notes.push(...db.notes);
  warnings.push(...db.warnings);
  errors.push(...db.errors);

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    await signInAdmin(page, env);
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    const filtered = consoleErrors.filter(
      (e) =>
        !e.includes("cdn.tailwindcss.com") &&
        !e.includes("favicon") &&
        !e.includes("manifest") &&
        !e.includes("Failed to load resource") &&
        !e.includes("404"),
    );
    if (filtered.length) errors.push(`Console errors: ${filtered.join(" | ")}`);
    else notes.push("Inventory page loads cleanly");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n=== Phase 6D-Validation readiness ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  if (warnings.length) {
    console.log("\nWARNINGS:");
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }
  if (errors.length) {
    console.error("\nFAILURES:");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\nPASS\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
