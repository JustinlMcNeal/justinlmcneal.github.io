/**
 * Phase 059A.2 — Adjust modal channel preview verification.
 * Run: node scripts/verify-inventory-phase059a2-adjust-channel-preview.mjs
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
const PORT = 9895;
const PAGE = "/pages/admin/inventory.html";
const MAX_LINES = 500;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const PREVIEW_FILES = [
  "js/admin/inventory/api/channelSyncCandidateApi.js",
  "js/admin/inventory/services/adjustChannelPreview.js",
  "js/admin/inventory/renderers/renderAdjustChannelPreview.js",
  "js/admin/inventory/ui/adjustModalChannelPreview.js",
  "js/admin/inventory/ui/adjustModal.js",
  "js/admin/inventory/renderers/renderAdjustModal.js",
];

const FORBIDDEN_IN_PREVIEW = [
  "fetchChannelSyncPreview",
  "pushAmazonFbmInventory",
  "pushEbayInventoryQuantity",
  "refreshEbayListingCache",
  "snapshot",
  "refresh_issues",
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

  for (const rel of PREVIEW_FILES) {
    const full = join(ROOT, rel);
    if (!existsSync(full)) {
      errors.push(`Missing file: ${rel}`);
      continue;
    }
    const lines = lineCount(rel);
    if (lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
    else notes.push(`${rel}: ${lines} lines`);
  }

  const adjustModal = readFileSync(join(ROOT, "js/admin/inventory/ui/adjustModal.js"), "utf8");
  if (!adjustModal.includes("loadAdjustChannelPreview")) {
    errors.push("adjustModal.js missing loadAdjustChannelPreview");
  } else notes.push("adjustModal wires channel preview loader");

  if (adjustModal.includes("fetchChannelSyncPreview")) {
    errors.push("adjustModal.js must not import fetchChannelSyncPreview");
  } else notes.push("adjustModal does not use full fetchChannelSyncPreview");

  const previewController = readFileSync(
    join(ROOT, "js/admin/inventory/ui/adjustModalChannelPreview.js"),
    "utf8",
  );
  for (const token of FORBIDDEN_IN_PREVIEW) {
    if (previewController.includes(token)) {
      errors.push(`adjustModalChannelPreview.js must not reference ${token}`);
    }
  }
  notes.push("Preview controller has no channel push / snapshot calls");

  const candidateApi = readFileSync(
    join(ROOT, "js/admin/inventory/api/channelSyncCandidateApi.js"),
    "utf8",
  );
  if (!candidateApi.includes("fetchChannelSyncCandidateForVariant")) {
    errors.push("channelSyncCandidateApi.js missing fetchChannelSyncCandidateForVariant");
  }
  if (!candidateApi.includes('.eq("variant_id"')) {
    errors.push("channelSyncCandidateApi must filter by variant_id");
  }
  if (!candidateApi.includes(".maybeSingle()")) {
    errors.push("channelSyncCandidateApi must use maybeSingle()");
  }
  notes.push("Lightweight single-variant candidate API present");

  const mapper = readFileSync(join(ROOT, "js/admin/inventory/services/adjustChannelPreview.js"), "utf8");
  const requiredLabels = [
    "Amazon quantity will update",
    "Amazon inactive offer can be restored",
    "eBay quantity will update",
    "eBay ended listing can be relisted",
    "eBay variation requires manual handling",
  ];
  for (const label of requiredLabels) {
    if (!mapper.includes(label)) errors.push(`adjustChannelPreview.js missing label: ${label}`);
  }
  notes.push("Status label mappers include required copy");

  const renderer = readFileSync(
    join(ROOT, "js/admin/inventory/renderers/renderAdjustChannelPreview.js"),
    "utf8",
  );
  if (!renderer.includes("Sync marketplaces after stock adjustment")) {
    errors.push("renderAdjustChannelPreview missing sync toggle text");
  }
  if (!renderer.includes("KK stock updates first")) {
    errors.push("renderAdjustChannelPreview missing preview note");
  }
  notes.push("Toggle text and preview-only copy present");

  const over = [];
  for (const rel of PREVIEW_FILES) {
    const lines = lineCount(rel);
    if (lines > MAX_LINES) over.push(`${rel}: ${lines}`);
  }
  if (over.length) errors.push(`059A.2 files over ${MAX_LINES} lines: ${over.join("; ")}`);
  else notes.push("All 059A.2 preview files under 500 lines");

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
    notes.push("Inventory page loaded with adjust action");

    await adjustBtn.click();
    await page.waitForSelector("#inventoryAdjustForm", { timeout: 15000 });
    notes.push("Adjust modal opened");

    const channelSection = page.locator("[data-adjust-channel-section]");
    if (!(await channelSection.count())) {
      errors.push("Channel preview section missing");
    } else notes.push("Channel preview section rendered");

    await page.waitForFunction(
      () => {
        const body = document.querySelector("[data-adjust-channel-body]");
        if (!body) return false;
        const loading = body.querySelector("[data-adjust-channel-loading]");
        return !loading;
      },
      { timeout: 20000 },
    );
    notes.push("Channel preview finished loading");

    const toggle = page.locator("[data-adjust-sync-toggle]");
    if (!(await toggle.count())) errors.push("Sync toggle missing");
    else notes.push("Sync channels toggle present");

    const kkCard = page.locator('[data-adjust-channel-card="kk"]');
    if (!(await kkCard.count())) errors.push("KK preview card missing");
    else notes.push("KK preview card present");

    const benign = consoleErrors.filter(
      (e) =>
        !e.includes("favicon") &&
        !e.includes("404") &&
        !e.includes("Failed to load resource"),
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
    browserResult.errors.push(`Browser verification skipped/failed: ${err.message}`);
  }

  const errors = [...staticResult.errors, ...browserResult.errors];
  const notes = [...staticResult.notes, ...browserResult.notes];

  console.log("\n=== Phase 059A.2 — Adjust Channel Preview ===\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 059A.2 adjust channel preview\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
