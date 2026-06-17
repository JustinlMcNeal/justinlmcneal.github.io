/**
 * Phase 059A.3 — Adjust channel orchestrator verification.
 * Run: node scripts/verify-inventory-phase059a3-adjust-orchestrator.mjs
 */
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 9896;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const ORCH_FILES = [
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
  "js/admin/inventory/services/adjustChannelNextSteps.js",
  "js/admin/inventory/services/adjustOrchestratorSummary.js",
  "js/admin/inventory/ui/adjustModal.js",
];

const ADJUST_FLOW_FILES = [
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/services/adjustChannelOrchestrator.js",
];

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
      const urlPath = req.url?.split("?")[0] || "/";
      const filePath = join(ROOT, decodeURIComponent(urlPath.replace(/^\//, "")));
      if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function lineCount(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8").split("\n").length;
}

function verifyStatic() {
  const notes = [];
  const errors = [];

  for (const rel of ORCH_FILES) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing file: ${rel}`);
    else if (lineCount(rel) > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
    else notes.push(`${rel}: ${lineCount(rel)} lines`);
  }

  const orchPath = join(ROOT, "js/admin/inventory/services/adjustChannelOrchestrator.js");
  const orch = readFileSync(orchPath, "utf8");

  if (!orch.includes("runAdjustChannelOrchestration")) {
    errors.push("Orchestrator missing runAdjustChannelOrchestration");
  }

  const fnStart = orch.indexOf("export async function runAdjustChannelOrchestration");
  const body = fnStart >= 0 ? orch.slice(fnStart) : orch;
  const adjustIdx = body.indexOf("await adjustInventory(");
  const channelIdx = body.indexOf("await resolveAmazonBranch(");

  if (adjustIdx < 0) errors.push("Orchestrator must await adjustInventory");
  if (channelIdx < 0) errors.push("Orchestrator must await channel branches after adjust");
  if (adjustIdx >= 0 && channelIdx >= 0 && channelIdx < adjustIdx) {
    errors.push("Channel branches must run after adjustInventory");
  }
  const ebayBranch = readFileSync(
    join(ROOT, "js/admin/inventory/services/adjustChannelEbayBranch.js"),
    "utf8",
  );
  if (!orch.includes("await pushAmazonFbmInventory(") || !ebayBranch.includes("pushEbayInventoryQuantity")) {
    errors.push("Orchestrator must include channel push API calls for update_qty");
  }
  notes.push("Orchestrator calls adjust before channel push APIs");

  if (!orch.includes('action === "update_qty"') && !ebayBranch.includes('action === "update_qty"')) {
    errors.push("Orchestrator must gate on update_qty action");
  }
  if (orch.includes("inactive_can_update") && orch.includes('mode: "inactive_restock"')) {
    notes.push("Amazon inactive_can_update wired via inactive_restock mode (059B.3+)");
  } else if (orch.includes("inactive_can_update") && orch.includes("pushAmazonFbmInventory")) {
    errors.push("inactive_can_update must use mode inactive_restock, not bare update_qty push");
  }
  notes.push("Amazon update_qty + inactive_restock branches present");

  if (ebayBranch.includes("available <= 0")) notes.push("eBay skips when available <= 0");
  else errors.push("eBay branch must skip when available <= 0");

  const nextSteps = readFileSync(
    join(ROOT, "js/admin/inventory/services/adjustChannelNextSteps.js"),
    "utf8",
  );
  const preview = readFileSync(
    join(ROOT, "js/admin/inventory/services/adjustChannelPreview.js"),
    "utf8",
  );
  if (!preview.includes("Amazon inactive offer can be restored")) {
    errors.push("Amazon inactive preview missing post-059B copy");
  }
  if (
    !preview.includes("eBay ended listing can be relisted") &&
    !ebayBranch.includes("runEbayEndedRelist") &&
    !nextSteps.includes("059D")
  ) {
    errors.push("eBay ended relist copy or wiring missing (059D.3+)");
  }
  if (
    !preview.includes("will refresh before sync") &&
    !ebayBranch.includes("runAdjustEbayCacheRefreshChain")
  ) {
    errors.push("eBay cache missing must be orchestrated (059C) — preview or branch");
  }
  notes.push("Preview + next-step messages for inactive/ended/cache cases");

  for (const rel of ADJUST_FLOW_FILES) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    if (text.includes("fetchChannelSyncPreview")) {
      errors.push(`${rel} must not call fetchChannelSyncPreview`);
    }
    if (/snapshot/i.test(text) && text.includes("refresh")) {
      errors.push(`${rel} must not reference snapshot refresh`);
    }
  }
  notes.push("Adjust flow avoids full preview and snapshot refresh");

  const adjustModal = readFileSync(join(ROOT, "js/admin/inventory/ui/adjustModal.js"), "utf8");
  if (!adjustModal.includes("runAdjustChannelOrchestration")) {
    errors.push("adjustModal must use orchestrator");
  }
  if (adjustModal.includes("adjustInventory(")) {
    errors.push("adjustModal must not call adjustInventory directly (use orchestrator)");
  }
  notes.push("adjustModal wired through orchestrator");

  return { notes, errors };
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

async function verifyBrowser(env) {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  try {
    await signInAdmin(page, env);
    await page.goto(`http://127.0.0.1:${PORT}${PAGE}`, { waitUntil: "networkidle", timeout: 60000 });

    const adjustBtn = page.locator('[data-inventory-action="adjust-stock"]').first();
    await adjustBtn.waitFor({ state: "visible", timeout: 60000 });
    notes.push("Inventory page loaded");

    await adjustBtn.click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15000 });
    notes.push("Adjust modal opened");

    await page.waitForFunction(
      () => {
        const body = document.querySelector("[data-adjust-channel-body]");
        return body && !body.querySelector("[data-adjust-channel-loading]");
      },
      { timeout: 20000 },
    );
    notes.push("Channel preview loaded");

    const benign = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("Failed to load resource"),
    );
    if (benign.length) errors.push(`Console errors: ${benign.slice(0, 3).join(" | ")}`);
    else notes.push("No significant console errors");
  } finally {
    await browser.close();
    server.close();
  }

  return { notes, errors };
}

async function main() {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }

  const staticResult = verifyStatic();
  let browserResult = { notes: [], errors: [] };
  try {
    browserResult = await verifyBrowser(env);
  } catch (err) {
    browserResult.errors.push(`Browser verification failed: ${err.message}`);
  }

  const errors = [...staticResult.errors, ...browserResult.errors];
  const notes = [...staticResult.notes, ...browserResult.notes];

  console.log("\n=== Phase 059A.3 — Adjust Channel Orchestrator ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059A.3 adjust channel orchestrator\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
