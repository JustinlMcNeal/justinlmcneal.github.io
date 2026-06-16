/**
 * Phase 3B — Inventory workspace + issues read-only verification.
 * Run: node scripts/verify-inventory-phase3b-workspace-issues.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9892;
const PAGE = "/pages/admin/inventory.html";

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
  const writePatterns = [/\.(insert|update|upsert|delete)\(/i, /\.rpc\s*\(/i];
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = file.replace(ROOT + "\\", "").replace(ROOT + "/", "");
    for (const re of writePatterns) {
      if (re.test(text)) hits.push(rel);
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
  if (safetyHits.length) errors.push(`Write/RPC patterns: ${safetyHits.join(", ")}`);
  else notes.push("No insert/update/upsert/delete/rpc in js/admin/inventory");

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
        rowCount: mod.state.inventoryRows?.length ?? 0,
        issueCount: mod.state.issueRows?.length ?? 0,
        workspaceError: mod.state.workspaceError,
        issuesError: mod.state.issuesError,
      };
    });

    notes.push(`KPI live: ${panelState.kpiLive}, Ledger live: ${panelState.ledgerLive}`);
    notes.push(
      `Workspace live: ${panelState.workspaceLive} (${panelState.rowCount} rows), Issues live: ${panelState.issuesLive} (${panelState.issueCount} types)`,
    );
    if (!panelState.workspaceLive && panelState.workspaceError) {
      notes.push(`Workspace fallback: ${panelState.workspaceError}`);
    }

    const kpiCards = await page.locator("[data-kpi]").count();
    if (kpiCards !== 8) errors.push(`Expected 8 KPI cards, got ${kpiCards}`);

    const tableRows = await page.locator("[data-inventory-id]").count();
    if (panelState.workspaceLive && tableRows < 2) {
      errors.push(`Expected live table rows, got ${tableRows} nodes`);
    } else {
      notes.push(`Table row nodes: ${tableRows}`);
    }

    const issueRows = await page.locator("[data-issue-type]").count();
    if (issueRows < 1 && panelState.issuesLive) {
      notes.push("Issues panel empty (no detected issues — ok)");
    } else {
      notes.push(`Issue panel rows: ${issueRows}`);
    }

    // Tab: Low Stock
    await page.locator('[data-inventory-tab="lowStock"]').click();
    await page.waitForTimeout(500);
    const lowStockRows = await page.locator("[data-inventory-id]").count();
    notes.push(`Low Stock tab rows: ${lowStockRows}`);

    // Tab: Issues
    await page.locator('[data-inventory-tab="issues"]').click();
    await page.waitForTimeout(500);
    const issuesTabRows = await page.locator("[data-inventory-id]").count();
    notes.push(`Issues tab rows: ${issuesTabRows}`);

    // Search
    await page.locator('[data-inventory-tab="all"]').click();
    await page.fill("#inventorySearchInput", "beanie");
    await page.waitForTimeout(400);
    const searchRows = await page.locator("[data-inventory-id]").count();
    notes.push(`Search "beanie" rows: ${searchRows}`);

    const mobileCards = await page.locator(".inv-mobile-card").count();
    notes.push(`Mobile cards visible: ${mobileCards}`);

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

  console.log("\n=== Phase 3B inventory workspace + issues verification ===\n");
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
