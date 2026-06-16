/**
 * Phase 6D-Prep — KK cutover readiness read-only verification.
 * Run: node scripts/verify-inventory-phase6d-prep-cutover-readiness.mjs
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
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20260830_inventory_phase6d_prep_cutover_readiness.sql",
);
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

  try {
    await client.connect();

    const views = [
      "v_inventory_kk_order_lines_resolved",
      "v_inventory_shadow_reservation_reconciliation",
      "v_inventory_kk_paid_unshipped_reservation_candidates",
      "v_inventory_kk_cutover_backfill_dry_run",
      "v_inventory_cutover_readiness_summary",
    ];
    for (const v of views) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM public.${v}`);
      notes.push(`${v} loads (${rows[0]?.cnt ?? 0} rows)`);
    }

    const stockBefore = await client.query(`
      SELECT COALESCE(SUM(stock), 0)::bigint AS total
      FROM public.product_variants WHERE COALESCE(is_active, true) = true
    `);
    const stockTotal = stockBefore.rows[0]?.total;

    const settings = await client.query(`
      SELECT kk_reservation_mode FROM public.inventory_cutover_settings WHERE id = 1
    `);
    const mode = settings.rows[0]?.kk_reservation_mode;
    if (mode !== "shadow") errors.push(`Expected mode shadow, got ${mode}`);
    else notes.push(`inventory_cutover_settings mode=${mode}`);

    const webhookText = readFileSync(WEBHOOK, "utf8");
    if (webhookText.includes("inventory_cutover_settings")) {
      errors.push("Webhook references cutover settings (behavior change not allowed in 6D-Prep)");
    } else {
      notes.push("stripe-webhook does not read cutover settings yet");
    }

    const summary = await client.query(`SELECT * FROM public.v_inventory_cutover_readiness_summary`);
    const s = summary.rows[0];
    if (s) {
      notes.push(
        `Readiness: ${s.paid_unshipped_line_count} paid/unshipped lines, ${s.paid_unshipped_unit_total} units, backfill +${s.total_stock_increase_units}`,
      );
      notes.push(
        `Reconciliation: ${s.matched_lines} matched / ${s.total_kk_lines} KK lines; safe_to_proceed_hint=${s.safe_to_proceed_hint}`,
      );
    }

    const stockAfter = await client.query(`
      SELECT COALESCE(SUM(stock), 0)::bigint AS total
      FROM public.product_variants WHERE COALESCE(is_active, true) = true
    `);
    if (stockAfter.rows[0]?.total !== stockTotal) {
      errors.push("product_variants.stock changed during verification");
    } else {
      notes.push("Stock totals unchanged during verification");
    }

    const resCount = await client.query(`SELECT COUNT(*)::int AS cnt FROM public.inventory_reservations`);
    notes.push(`inventory_reservations row count snapshot: ${resCount.rows[0]?.cnt}`);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await client.end().catch(() => {});
  }

  return { notes, errors };
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const errors = [];
  const notes = [];

  if (!existsSync(MIGRATION)) errors.push("Migration file missing");
  else notes.push("Migration file present");

  const db = await verifyDatabase();
  notes.push(...db.notes);
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
    await page.waitForTimeout(4000);

    const filtered = consoleErrors.filter(
      (e) =>
        !e.includes("cdn.tailwindcss.com") &&
        !e.includes("favicon") &&
        !e.includes("manifest") &&
        !e.includes("Failed to load resource") &&
        !e.includes("404"),
    );
    if (filtered.length) errors.push(`Console errors: ${filtered.join(" | ")}`);
    else notes.push("Inventory page loads with zero relevant console errors");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n=== Phase 6D-Prep KK cutover readiness verification ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
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
