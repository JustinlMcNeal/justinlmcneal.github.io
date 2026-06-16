/**
 * Phase 4 — Inventory manual adjustment verification.
 * Run: node scripts/verify-inventory-phase4-manual-adjust.mjs
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
const PORT = 9894;
const PAGE = "/pages/admin/inventory.html";
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

  let testVariantId = null;
  let stockBefore = null;

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
        workspaceLive: mod.state.workspaceLive,
        rowCount: mod.state.inventoryRows?.length ?? 0,
      };
    });

    if (!panelState.workspaceLive) errors.push("Workspace not live");
    else notes.push(`Workspace live with ${panelState.rowCount} rows`);

    const adjustBtn = page.locator('[data-inventory-action="adjust-stock"]').first();
    if ((await adjustBtn.count()) < 1) errors.push("No Adjust Stock buttons found");
    else {
      notes.push("Adjust Stock button present on table row");

      testVariantId = await adjustBtn.getAttribute("data-row-id");
      const stockBeforeFromState = await page.evaluate(async (variantId) => {
        const mod = await import("/js/admin/inventory/state.js");
        const row = mod.state.inventoryRows?.find((r) => r.id === variantId);
        return row ? { onHand: row.onHand, sku: row.internalSku } : null;
      }, testVariantId);

      if (!testVariantId || !stockBeforeFromState) {
        errors.push("Could not resolve test variant from adjust button row id");
      } else {
        stockBefore = stockBeforeFromState.onHand;
        notes.push(`Test variant ${stockBeforeFromState.sku}: stock before ${stockBefore}`);
      }

      await adjustBtn.click();
      await page.waitForTimeout(400);

      const modalTitle = await page.locator("#inventoryAdjustTitle").count();
      if (modalTitle < 1) errors.push("Adjust modal did not open");
      else notes.push("Adjust modal opens from row action");

      if (testVariantId && stockBefore != null) {
        await page.locator("#inventoryAdjustQty").fill("1");
        await page.locator("#inventoryAdjustReason").selectOption("count_correction");
        await page.locator("#inventoryAdjustNote").fill("Phase 4 verify script add +1");
        await page.locator("[data-adjust-submit]").click();
        await page.waitForTimeout(5000);

        const toastText = await page.locator("#inventoryStatusToast").textContent();
        if (!toastText?.includes("Stock updated")) errors.push(`Success toast missing: ${toastText}`);
        else notes.push("Success toast after adjustment");

        const modalStillOpen = await page.locator("#inventoryAdjustTitle").count();
        if (modalStillOpen > 0) errors.push("Modal still open after success");
        else notes.push("Modal closed after success");
      }
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

  if (testVariantId && stockBefore != null) {
    process.env.SUPABASE_DB_PASSWORD =
      env.SUPABASE_DB_PASSWORD || env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD;
    const client = new pg.Client({
      connectionString: getPoolerConnectionString(),
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      const { rows: stockRows } = await client.query(
        `SELECT stock FROM product_variants WHERE id = $1`,
        [testVariantId],
      );
      const stockAfter = Number(stockRows?.[0]?.stock ?? NaN);
      if (stockAfter !== stockBefore + 1) {
        errors.push(`Stock mismatch: expected ${stockBefore + 1}, got ${stockAfter}`);
      } else notes.push(`product_variants.stock updated ${stockBefore} → ${stockAfter}`);

      const { rows: ledgerRows } = await client.query(
        `SELECT id, change, reason, source, note
         FROM stock_ledger
         WHERE variant_id = $1 AND reason = 'manual_adjustment' AND note LIKE 'Phase 4 verify%'
         ORDER BY created_at DESC LIMIT 1`,
        [testVariantId],
      );
      if (!ledgerRows?.length) errors.push("No matching stock_ledger row found");
      else {
        notes.push(`stock_ledger row ${ledgerRows[0].id} change=${ledgerRows[0].change} source=${ledgerRows[0].source}`);

        await client.query(`UPDATE product_variants SET stock = $1 WHERE id = $2`, [
          stockBefore,
          testVariantId,
        ]);
        notes.push("Reverted test variant stock to pre-verify value");
      }
    } catch (dbErr) {
      errors.push(`DB verify failed: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
    } finally {
      await client.end().catch(() => {});
    }
  }

  console.log("\n=== Phase 4 inventory manual adjustment verification ===\n");
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
