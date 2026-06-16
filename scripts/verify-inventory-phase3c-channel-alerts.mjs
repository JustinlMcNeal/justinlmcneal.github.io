/**
 * Phase 3C — Inventory channel strip + alert pills verification.
 * Run: node scripts/verify-inventory-phase3c-channel-alerts.mjs
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
const PORT = 9893;
const PAGE = "/pages/admin/inventory.html";
const ALLOWED_RPC_FILES = new Set(["js/admin/inventory/api/adjustInventoryApi.js"]);

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

function grepInventorySafety() {
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
  walk(invDir);
  const writePatterns = [/\.(insert|update|upsert|delete)\(/i, /\.rpc\s*\(/i];
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const text = readFileSync(file, "utf8");
    if (writePatterns.some((re) => re.test(text)) && !ALLOWED_RPC_FILES.has(rel)) {
      hits.push(rel);
    }
  }
  return hits;
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const errors = [];
  const notes = [];

  const safetyHits = grepInventorySafety();
  if (safetyHits.length) errors.push(`Unexpected write/RPC in: ${safetyHits.join(", ")}`);
  else notes.push("No unexpected insert/update/upsert/delete/rpc in js/admin/inventory");

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
        ledgerLive: mod.state.ledgerLive,
        workspaceLive: mod.state.workspaceLive,
        issuesLive: mod.state.issuesLive,
        channelLive: mod.state.channelStatusLive,
        alertCount: mod.state.alerts?.length ?? 0,
        ebayStatus: mod.state.channelStatus?.ebay?.statusLabel,
        amazonConnected: mod.state.channelStatus?.amazon?.connected,
      };
    });

    notes.push(
      `Panels live — KPI:${panelState.kpiLive} Ledger:${panelState.ledgerLive} Table:${panelState.workspaceLive} Issues:${panelState.issuesLive} Channel:${panelState.channelLive}`,
    );
    notes.push(`Live alerts: ${panelState.alertCount}`);
    notes.push(`eBay strip: ${panelState.ebayStatus}`);
    notes.push(`Amazon connected: ${panelState.amazonConnected}`);

    const channels = await page.locator("[data-channel]").count();
    if (channels < 3) errors.push(`Expected 3 channel blocks, got ${channels}`);
    else notes.push(`Channel strip blocks: ${channels}`);

    const alertButtons = await page.locator("[data-inventory-alert]").count();
    notes.push(`Alert pill buttons: ${alertButtons}`);

    const ebayHeaderTitle = await page.locator('th[title*="eBay channel quantity"]').count();
    if (ebayHeaderTitle < 1) errors.push("eBay qty limitation tooltip missing on column header");
    else notes.push("eBay qty tooltip on column header");

    if (alertButtons > 0) {
      const before = await page.locator("[data-inventory-id]").count();
      await page.locator("[data-inventory-alert]").first().click();
      await page.waitForTimeout(600);
      const after = await page.locator("[data-inventory-id]").count();
      notes.push(`Alert filter click: ${before} → ${after} row nodes`);
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
    else notes.push("Zero relevant console errors");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n=== Phase 3C inventory channel + alerts verification ===\n");
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
