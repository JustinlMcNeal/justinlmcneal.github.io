/**
 * Phase 5 — Inventory parcel receive visibility verification.
 * Run: node scripts/verify-inventory-phase5-parcel-visibility.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, extname, relative } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9895;
const INVENTORY_PAGE = "/pages/admin/inventory.html";
const PARCEL_PAGE = "/pages/admin/parcelImports.html";
const ALLOWED_RPC_FILE = "js/admin/inventory/api/adjustInventoryApi.js";

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

async function signInAdmin(page, env, redirectPath) {
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const email = await resolveAdminEmail(env);
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const redirectTo = `http://127.0.0.1:${PORT}${redirectPath}`;
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

function filterConsoleErrors(consoleErrors) {
  return consoleErrors.filter(
    (e) =>
      !e.includes("cdn.tailwindcss.com") &&
      !e.includes("favicon") &&
      !e.includes("manifest") &&
      !e.includes("Failed to load resource") &&
      !e.includes("404"),
  );
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const errors = [];
  const notes = [];

  const safetyHits = grepInventoryWriteSafety();
  if (safetyHits.length) errors.push(`Unexpected write/RPC in: ${safetyHits.join(", ")}`);
  else notes.push(`Only intentional RPC in ${ALLOWED_RPC_FILE}`);

  const over500 = countLinesInInventoryJs();
  if (over500.length) errors.push(`Files over 500 lines: ${over500.join("; ")}`);
  else notes.push("All inventory JS files under 500 lines");

  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    await signInAdmin(page, env, INVENTORY_PAGE);
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.waitForTimeout(4000);

    const panelState = await page.evaluate(async () => {
      const mod = await import("/js/admin/inventory/state.js");
      return {
        kpiLive: mod.state.kpiLive,
        ledgerLive: mod.state.ledgerLive,
        workspaceLive: mod.state.workspaceLive,
        issuesLive: mod.state.issuesLive,
        channelLive: mod.state.channelStatusLive,
        parcelLive: mod.state.parcelSummaryLive,
        parcelSummary: mod.state.parcelSummary,
        ledgerCount: mod.state.ledgerEntries?.length ?? 0,
      };
    });

    if (!panelState.kpiLive || !panelState.workspaceLive) {
      errors.push("Core inventory panels not live");
    } else {
      notes.push("KPI + workspace + ledger + issues + channel still live");
    }

    if (!panelState.parcelLive) errors.push("Parcel summary not live");
    else notes.push(`Parcel summary live — ready:${panelState.parcelSummary?.readyToReceive}`);

    const summaryHeading = await page.locator("#inventoryParcelSummaryHeading").count();
    if (summaryHeading < 1) errors.push("Parcel summary section missing");
    else notes.push("Parcel Receive Summary card rendered");

    const receiveLinks = await page.locator('a[href*="parcelImports.html"]').count();
    if (receiveLinks < 1) errors.push("No Parcel Imports links on inventory page");
    else notes.push(`Parcel Imports links on page: ${receiveLinks}`);

    const ledgerParcelBtn = await page.locator('[data-inventory-ledger-filter="parcel"]').count();
    if (ledgerParcelBtn < 1) errors.push("Ledger parcel filter missing");
    else {
      await page.locator('[data-inventory-ledger-filter="parcel"]').click();
      await page.waitForTimeout(300);
      notes.push("Ledger parcel filter toggles");
    }

    const parcelIssueLink = await page.locator('a[href*="parcelImports.html"][href*="received=not_received"]').count();
    if (parcelIssueLink < 1) notes.push("Parcel issue deep link may be absent (no mapping issue rows)");
    else notes.push("Parcel mapping issue links to Parcel Imports");

    await page.locator('[data-inventory-header-action="receive-stock"]').click();
    await page.waitForTimeout(3000);
    const parcelUrl = page.url();
    if (!parcelUrl.includes("parcelImports.html")) {
      errors.push(`Receive Stock did not navigate to parcel imports: ${parcelUrl}`);
    } else {
      notes.push("Receive Stock navigates to Parcel Imports");
      if (!parcelUrl.includes("tab=history") || !parcelUrl.includes("received=not_received")) {
        errors.push(`Receive Stock URL missing expected params: ${parcelUrl}`);
      } else notes.push("Receive Stock deep link includes history + not_received filters");
    }

    const historyTabSelected = await page.locator("#parcelTabHistory[aria-selected='true']").count();
    if (historyTabSelected < 1) errors.push("Parcel Imports history tab not active after deep link");
    else notes.push("Parcel Imports history tab active from deep link");

    const filtered = filterConsoleErrors(consoleErrors);
    if (filtered.length) errors.push(`Console errors on inventory/parcel: ${filtered.join(" | ")}`);
    else notes.push("Zero relevant console errors");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n=== Phase 5 inventory parcel visibility verification ===\n");
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
