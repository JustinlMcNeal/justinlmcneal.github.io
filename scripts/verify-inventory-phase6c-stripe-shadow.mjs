/**
 * Phase 6C — Stripe idempotency + KK shadow reservations verification.
 * Run: node scripts/verify-inventory-phase6c-stripe-shadow.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9897;
const PAGE = "/pages/admin/inventory.html";
const ALLOWED_RPC_FILE = "js/admin/inventory/api/adjustInventoryApi.js";
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20260829_inventory_phase6c_stripe_idempotency_shadow.sql",
);
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
      res.writeHead(200, {
        "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function extname(p) {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i) : "";
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
  await page.goto(data.properties.action_link, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
}

function grepWebhookPatterns() {
  const text = readFileSync(WEBHOOK, "utf8");
  const required = [
    "claimStripeInventoryDedup",
    "DEDUP_CHECKOUT_STOCK_DEDUCT",
    "DEDUP_REFUND_STOCK_RESTORE",
    "upsertShadowReservation",
    "releaseKkShadowReservations",
  ];
  const missing = required.filter((s) => !text.includes(s));
  return missing;
}

function countFileLines(path) {
  return readFileSync(path, "utf8").split("\n").length;
}

async function verifyDatabase(env) {
  process.env.SUPABASE_DB_PASSWORD =
    env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  const notes = [];
  const errors = [];

  try {
    await client.connect();

    const dedupExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'inventory_event_dedup'
      ) AS exists
    `);
    if (!dedupExists.rows[0]?.exists) {
      errors.push("inventory_event_dedup table missing");
    } else {
      notes.push("inventory_event_dedup table exists");
    }

    const shadowCol = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inventory_reservations'
          AND column_name = 'is_shadow'
      ) AS exists
    `);
    if (!shadowCol.rows[0]?.exists) {
      errors.push("inventory_reservations.is_shadow column missing");
    } else {
      notes.push("inventory_reservations.is_shadow column exists");
    }

    const kpiBefore = await client.query(`
      SELECT on_hand_units, reserved_units, available_units
      FROM public.v_inventory_kpis
    `);
    const kb = kpiBefore.rows[0];
    notes.push(`Official KPIs before test: reserved=${kb.reserved_units}, available=${kb.available_units}`);

    const variant = await client.query(`
      SELECT pv.id AS variant_id, pv.product_id, pv.stock
      FROM public.product_variants pv
      WHERE COALESCE(pv.is_active, true) = true
      LIMIT 1
    `);
    if (!variant.rows[0]) {
      errors.push("No active variant for shadow exclusion test");
      return { notes, errors };
    }
    const { variant_id, product_id } = variant.rows[0];

    const testOrderId = `test-shadow-${Date.now()}`;
    const testLineId = "li_test_shadow";
    const testQty = 3;

    await client.query(
      `INSERT INTO public.inventory_reservations (
        channel, order_id, order_item_id, variant_id, product_id,
        quantity, status, is_shadow, idempotency_key, notes
      ) VALUES (
        'kk', $1, $2, $3, $4, $5, 'reserved', true,
        $6, 'Phase 6C verify — shadow row'
      )`,
      [
        testOrderId,
        testLineId,
        variant_id,
        product_id,
        testQty,
        `kk:${testOrderId}:${testLineId}:reserve`,
      ],
    );
    notes.push("Inserted test shadow reservation (qty=3)");

    const kpiAfterShadow = await client.query(`
      SELECT reserved_units, available_units, on_hand_units
      FROM public.v_inventory_kpis
    `);
    const kas = kpiAfterShadow.rows[0];
    if (Number(kas.reserved_units) !== Number(kb.reserved_units)) {
      errors.push(
        `Shadow row changed official reserved_units: ${kb.reserved_units} → ${kas.reserved_units}`,
      );
    } else {
      notes.push("Official reserved_units unchanged with shadow row present");
    }
    if (Number(kas.available_units) !== Number(kb.available_units)) {
      errors.push(
        `Shadow row changed official available_units: ${kb.available_units} → ${kas.available_units}`,
      );
    } else {
      notes.push("Official available_units unchanged with shadow row present");
    }

    const shadowKpi = await client.query(`
      SELECT shadow_reserved_units, shadow_reservation_rows
      FROM public.v_inventory_shadow_kpis
    `);
    const sk = shadowKpi.rows[0];
    if (Number(sk.shadow_reserved_units) < testQty) {
      errors.push(`v_inventory_shadow_kpis should count shadow row (got ${sk.shadow_reserved_units})`);
    } else {
      notes.push(`Shadow KPIs: ${sk.shadow_reservation_rows} rows, ${sk.shadow_reserved_units} reserved units`);
    }

    const dedupEvent = `evt_test_${Date.now()}`;
    await client.query(
      `INSERT INTO public.inventory_event_dedup (stripe_event_id, action_type, reference_id)
       VALUES ($1, 'checkout_stock_deduct', 'cs_test')`,
      [dedupEvent],
    );
    let dupBlocked = false;
    try {
      await client.query(
        `INSERT INTO public.inventory_event_dedup (stripe_event_id, action_type, reference_id)
         VALUES ($1, 'checkout_stock_deduct', 'cs_test')`,
        [dedupEvent],
      );
    } catch (e) {
      if (e.code === "23505") dupBlocked = true;
      else throw e;
    }
    if (!dupBlocked) errors.push("Dedup unique constraint did not block duplicate insert");
    else notes.push("Dedup unique (stripe_event_id, action_type) blocks replay");

    const reserveDup = `kk:${testOrderId}:${testLineId}:reserve`;
    let reserveDupBlocked = false;
    try {
      await client.query(
        `INSERT INTO public.inventory_reservations (
          channel, order_id, order_item_id, variant_id, product_id,
          quantity, status, is_shadow, idempotency_key
        ) VALUES ('kk', $1, $2, $3, $4, 1, 'reserved', true, $5)`,
        [testOrderId, testLineId, variant_id, product_id, reserveDup],
      );
    } catch (e) {
      if (e.code === "23505") reserveDupBlocked = true;
      else throw e;
    }
    if (!reserveDupBlocked) errors.push("Reservation idempotency_key did not block duplicate");
    else notes.push("Shadow reservation idempotency_key blocks duplicate insert");

    await client.query(
      `DELETE FROM public.inventory_reservations WHERE idempotency_key = $1`,
      [reserveDup],
    );
    await client.query(
      `DELETE FROM public.inventory_event_dedup WHERE stripe_event_id = $1`,
      [dedupEvent],
    );
    notes.push("Test rows cleaned up");

    const audit = await client.query(`
      SELECT COUNT(*)::int AS cnt FROM public.v_inventory_shadow_reservation_audit
    `);
    notes.push(`v_inventory_shadow_reservation_audit loads (${audit.rows[0]?.cnt ?? 0} rows)`);
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

  if (!existsSync(SHARED)) errors.push("stripeWebhookInventory.ts missing");
  else notes.push(`Shared module: ${countFileLines(SHARED)} lines`);

  const webhookLines = countFileLines(WEBHOOK);
  notes.push(`stripe-webhook/index.ts: ${webhookLines} lines`);
  if (webhookLines > 950) errors.push(`Webhook file very large: ${webhookLines} lines`);

  const missingPatterns = grepWebhookPatterns();
  if (missingPatterns.length) {
    errors.push(`Webhook missing patterns: ${missingPatterns.join(", ")}`);
  } else {
    notes.push("Webhook imports idempotency + shadow helpers");
  }

  const db = await verifyDatabase(env);
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

    const panelState = await page.evaluate(async () => {
      const mod = await import("/js/admin/inventory/state.js");
      return {
        kpiLive: mod.state.kpiLive,
        reservedUnits: mod.state.kpis?.reservedUnits,
        availableUnits: mod.state.kpis?.availableUnits,
        onHandUnits: mod.state.kpis?.onHandUnits,
      };
    });

    notes.push(`Page KPI live=${panelState.kpiLive}, reserved=${panelState.reservedUnits}`);
    if (
      panelState.kpiLive &&
      panelState.availableUnits != null &&
      panelState.onHandUnits != null &&
      panelState.availableUnits !== panelState.onHandUnits &&
      panelState.reservedUnits === 0
    ) {
      notes.push("available=on_hand with zero official reserved (shadow excluded)");
    }

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

  console.log("\n=== Phase 6C Stripe idempotency + shadow reservations ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  if (errors.length) {
    console.error("\nFAILURES:");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\nPASS\n");
  console.log("Note: Live Stripe replay tests require Stripe CLI or manual webhook replay.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
