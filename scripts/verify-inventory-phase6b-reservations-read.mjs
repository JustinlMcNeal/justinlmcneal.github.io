/**
 * Phase 6B — Reservation schema + read views verification.
 * Run: node scripts/verify-inventory-phase6b-reservations-read.mjs
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
const PORT = 9896;
const PAGE = "/pages/admin/inventory.html";
const ALLOWED_RPC_FILE = "js/admin/inventory/api/adjustInventoryApi.js";
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20260828_inventory_phase6b_reservations_read.sql",
);

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

function grepInventoryWriteSafety() {
  const invDir = join(ROOT, "js/admin/inventory");
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js")) files.push(p);
    }
  };
  walk(invDir);
  const writePatterns = [/\.(insert|update|upsert|delete)\(/i, /\.rpc\s*\(/i];
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const text = readFileSync(file, "utf8");
    if (writePatterns.some((re) => re.test(text)) && rel !== ALLOWED_RPC_FILE) {
      hits.push(rel);
    }
  }
  return hits;
}

function countLinesInInventoryJs() {
  const invDir = join(ROOT, "js/admin/inventory");
  const over = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js")) {
        const lines = readFileSync(p, "utf8").split("\n").length;
        if (lines > 500) over.push(`${relative(ROOT, p).replace(/\\/g, "/")}: ${lines}`);
      }
    }
  };
  walk(invDir);
  return over;
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

    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'inventory_reservations'
      ) AS exists
    `);
    if (!tableCheck.rows[0]?.exists) {
      errors.push("inventory_reservations table missing — apply migration first");
      return { notes, errors };
    }
    notes.push("inventory_reservations table exists");

    const rowCount = await client.query(
      "SELECT COUNT(*)::int AS cnt FROM public.inventory_reservations",
    );
    const cnt = rowCount.rows[0]?.cnt ?? -1;
    if (cnt !== 0) errors.push(`Expected 0 reservation rows, got ${cnt}`);
    else notes.push("inventory_reservations is empty");

    const kpi = await client.query(`
      SELECT total_skus, on_hand_units, reserved_units, available_units, inventory_issues
      FROM public.v_inventory_kpis
    `);
    if (!kpi.rows[0]) errors.push("v_inventory_kpis returned no row");
    else {
      const r = kpi.rows[0];
      notes.push(
        `KPIs: on_hand=${r.on_hand_units}, reserved=${r.reserved_units}, available=${r.available_units}`,
      );
      if (Number(r.reserved_units) !== 0) {
        errors.push(`reserved_units should be 0, got ${r.reserved_units}`);
      }
      if (Number(r.available_units) !== Number(r.on_hand_units)) {
        errors.push(
          `available (${r.available_units}) should equal on_hand (${r.on_hand_units}) while reservations empty`,
        );
      }
    }

    const wsMismatch = await client.query(`
      SELECT COUNT(*)::int AS cnt
      FROM public.v_inventory_workspace
      WHERE reserved <> 0 OR available <> on_hand
    `);
    const wsBad = wsMismatch.rows[0]?.cnt ?? -1;
    if (wsBad > 0) {
      errors.push(`${wsBad} workspace rows have reserved≠0 or available≠on_hand`);
    } else {
      notes.push("All workspace rows: reserved=0, available=on_hand");
    }

    const unmapped = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE reason = 'afn_skip')::int AS afn,
             COUNT(*) FILTER (WHERE reason <> 'afn_skip')::int AS actionable
      FROM public.v_inventory_unmapped_order_lines
    `);
    const u = unmapped.rows[0];
    notes.push(
      `Unmapped order lines: ${u.total} total (${u.actionable} actionable, ${u.afn} afn_skip)`,
    );

    const issues = await client.query(`
      SELECT issue_type, affected_count
      FROM public.v_inventory_issues
      ORDER BY affected_count DESC
    `);
    notes.push(`v_inventory_issues rows: ${issues.rows.length}`);
    const unmappedIssue = issues.rows.find((r) => r.issue_type === "unmapped_order_line");
    if (unmappedIssue) {
      notes.push(`unmapped_order_line issue count: ${unmappedIssue.affected_count}`);
    }

    const stockSum = await client.query(`
      SELECT COALESCE(SUM(stock), 0)::bigint AS total
      FROM public.product_variants
      WHERE COALESCE(is_active, true) = true
    `);
    notes.push(`Active variant stock sum: ${stockSum.rows[0]?.total}`);
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

  const safetyHits = grepInventoryWriteSafety();
  if (safetyHits.length) errors.push(`Unexpected write/RPC patterns: ${safetyHits.join(", ")}`);
  else notes.push("Only adjustInventoryApi.js uses RPC writes");

  const overLines = countLinesInInventoryJs();
  if (overLines.length) errors.push(`Files over 500 lines: ${overLines.join(", ")}`);
  else notes.push("All inventory JS files under 500 lines");

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
        workspaceLive: mod.state.workspaceLive,
        issuesLive: mod.state.issuesLive,
        reservedUnits: mod.state.kpis?.reservedUnits,
        availableUnits: mod.state.kpis?.availableUnits,
        onHandUnits: mod.state.kpis?.onHandUnits,
        issueTypes: (mod.state.issueRows ?? []).map((r) => r.type),
      };
    });

    notes.push(`Page KPI live=${panelState.kpiLive}, reserved=${panelState.reservedUnits}`);
    if (
      panelState.kpiLive &&
      panelState.reservedUnits != null &&
      panelState.reservedUnits !== 0
    ) {
      errors.push(`UI reserved units should be 0, got ${panelState.reservedUnits}`);
    }
    if (
      panelState.kpiLive &&
      panelState.availableUnits != null &&
      panelState.onHandUnits != null &&
      panelState.availableUnits !== panelState.onHandUnits
    ) {
      errors.push("UI available should equal on_hand while reservations empty");
    }

    const hasUnmappedAlert = await page.locator('[data-alert-id="unmapped-order-lines"]').count();
    if (panelState.issueTypes.includes("unmapped_order_line")) {
      notes.push("unmapped_order_line issue visible in UI state");
      if (hasUnmappedAlert > 0) notes.push("Unmapped order lines alert pill rendered");
    } else {
      notes.push("No unmapped_order_line issue in current data (ok if count is 0)");
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

  console.log("\n=== Phase 6B inventory reservation schema + read views ===\n");
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
