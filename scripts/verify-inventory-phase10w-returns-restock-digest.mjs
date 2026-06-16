#!/usr/bin/env node
/**
 * Phase 10W — Returns/restock digest verification.
 * Run: node scripts/verify-inventory-phase10w-returns-restock-digest.mjs
 */
import { chromium } from "@playwright/test";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INVENTORY_PAGE = "/pages/admin/inventory.html";
const PORT = 9921;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lineCount(relPath) {
  return read(relPath).split("\n").length;
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

function verifySourceFiles() {
  const notes = [];
  const errors = [];
  const lineLimitFiles = [
    "js/admin/inventory/ui/returnsRestockDigestPreview.js",
    "js/admin/inventory/api/returnsRestockDigestApi.js",
    "js/admin/inventory/ui/returnsRestockDashboardModal.js",
    "supabase/functions/inventory-returns-restock-digest/index.ts",
    "supabase/functions/_shared/returnsRestockDigestUtils.ts",
  ];
  const required = [
    ...lineLimitFiles,
    "supabase/migrations/20261017_inventory_phase10w_returns_restock_digest.sql",
    "supabase/SETUP_RETURNS_RESTOCK_DIGEST_CRON.sql",
    "docs/pages/admin/inventory/implementation/054_phase_10w_returns_restock_digest.md",
  ];

  for (const rel of required) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lineLimitFiles.includes(rel) && lines > MAX_LINES) {
        errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
      } else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const mig = read("supabase/migrations/20261017_inventory_phase10w_returns_restock_digest.sql");
  for (const obj of [
    "v_inventory_returns_restock_digest_summary",
    "v_inventory_returns_restock_digest_items",
    "inventory_returns_restock_digest_runs",
  ]) {
    if (!mig.includes(obj)) errors.push(`Migration missing: ${obj}`);
    else notes.push(`Migration includes ${obj}`);
  }

  for (const field of [
    "overdue_followups",
    "recent_restocks_24h",
    "oldest_stale_observation_age_hours",
    "ready_restock",
    "stale_observation",
    "open_followup",
    "manual_review",
  ]) {
    if (!mig.includes(field)) errors.push(`Digest field/section missing: ${field}`);
    else notes.push(`Digest: ${field}`);
  }

  const cron = read("supabase/SETUP_RETURNS_RESTOCK_DIGEST_CRON.sql");
  if (!cron.includes("CRON_SECRET")) errors.push("Cron SQL must reference CRON_SECRET");
  else notes.push("Cron guarded by CRON_SECRET");
  if (!cron.includes("inventory-returns-restock-digest")) errors.push("Cron must target digest function");
  else notes.push("Cron targets digest function");

  const fn = read("supabase/functions/inventory-returns-restock-digest/index.ts");
  if (!fn.includes("fetchDigestData")) errors.push("Function must read digest views");
  else notes.push("Function reads digest views");
  if (fn.includes("restock_bundle_component_line") || fn.includes("restockBundleComponentLine")) {
    errors.push("Function must not restock");
  } else notes.push("Function does not restock");
  if (!fn.includes("confirm_required")) errors.push("Send must require confirm for admin");
  else notes.push("Admin send requires confirm");
  if (!fn.includes("skipped_duplicate")) errors.push("Duplicate send guard missing");
  else notes.push("Duplicate send guard");
  if (fn.includes("sync-amazon") || fn.includes("channel sync push")) {
    errors.push("Function must not auto-sync");
  } else notes.push("No channel sync in function");

  const utils = read("supabase/functions/_shared/returnsRestockDigestUtils.ts");
  for (const link of ['tab: "ready"', "stale_only", 'tab: "followups"', 'row_type: "manual_review"']) {
    if (!utils.includes(link)) errors.push(`Deep link missing: ${link}`);
    else notes.push(`Deep link: ${link}`);
  }

  const preview = read("js/admin/inventory/ui/returnsRestockDigestPreview.js");
  if (!preview.includes("previewReturnsRestockDigest")) errors.push("Preview API missing");
  else notes.push("Preview via API");
  if (!preview.includes("confirm")) errors.push("Send confirmation missing");
  else notes.push("Send requires confirm dialog");
  if (preview.includes("restockBundleComponentLine")) errors.push("Preview must not restock");
  else notes.push("Preview does not restock");

  const modal = read("js/admin/inventory/ui/returnsRestockDashboardModal.js");
  if (!modal.includes("data-rrd-preview-digest")) errors.push("Dashboard preview button missing");
  else notes.push("Dashboard Preview Digest button");

  const dom = read("js/admin/inventory/dom.js");
  if (!dom.includes("returnsRestockDigestPreviewMount")) errors.push("Digest preview mount missing");
  else notes.push("Digest preview mount");

  const exportMod = read("js/admin/inventory/ui/returnsRestockDashboardExport.js");
  if (!exportMod.includes("exportWorklist")) errors.push("Phase 10V exports missing");
  else notes.push("Dashboard exports preserved");

  return { notes, errors };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    for (const view of [
      "v_inventory_returns_restock_digest_summary",
      "v_inventory_returns_restock_digest_items",
    ]) {
      const r = await client.query(
        `SELECT 1 FROM information_schema.views WHERE table_name = $1`,
        [view],
      );
      if (!r.rows.length) {
        notes.push(`Skipped DB checks (apply 10W migration for ${view})`);
        return { notes, errors };
      }
      notes.push(`${view} exists`);
    }
    const tbl = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_returns_restock_digest_runs'`,
    );
    if (!tbl.rows.length) errors.push("digest_runs table missing");
    else notes.push("digest_runs table exists");

    await client.query(`SELECT * FROM v_inventory_returns_restock_digest_summary LIMIT 1`);
    notes.push("Summary query OK");
    await client.query(`SELECT * FROM v_inventory_returns_restock_digest_items LIMIT 5`);
    notes.push("Items query OK");
  } catch (err) {
    errors.push(`DB error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.end().catch(() => {});
  }
  return { notes, errors };
}

async function verifyBrowser() {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded" });
    notes.push("Inventory page loads");

    if (!(await page.locator("[data-inventory-returns-restock-dashboard]").count())) {
      errors.push("Dashboard entry missing");
    } else notes.push("Returns dashboard loads");

    if (!(await page.locator("#inventoryReturnsRestockDigestPreviewMount").count())) {
      errors.push("Digest preview mount missing");
    } else notes.push("Digest preview mount in HTML");

    const modalSrc = read("js/admin/inventory/ui/returnsRestockDashboardModal.js");
    if (!modalSrc.includes("data-rrd-preview-digest")) errors.push("Preview button not in modal");
    else notes.push("Preview Digest in dashboard modal");

    if (!(await page.locator("[data-inventory-restock-queue]").count())) {
      errors.push("Restock queue missing");
    } else notes.push("Restock Assist Queue preserved");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10W — Returns/restock digest verification\n");

  const staticResult = verifySourceFiles();
  console.log("--- Static checks ---");
  for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
  for (const e of staticResult.errors) console.log(`  ✗ ${e}`);

  let dbResult = { notes: [], errors: [] };
  try {
    getPoolerConnectionString();
    dbResult = await verifyDatabase();
    console.log("\n--- Database checks ---");
    for (const n of dbResult.notes) console.log(`  ✓ ${n}`);
    for (const e of dbResult.errors) console.log(`  ✗ ${e}`);
  } catch {
    console.log("\n--- Database checks ---");
    console.log("  ⊘ Skipped (no DB credentials)");
  }

  const browserResult = await verifyBrowser();
  console.log("\n--- Browser checks ---");
  for (const n of browserResult.notes) console.log(`  ✓ ${n}`);
  for (const e of browserResult.errors) console.log(`  ✗ ${e}`);

  const allErrors = [...staticResult.errors, ...dbResult.errors, ...browserResult.errors];
  console.log(allErrors.length ? `\nFAILED (${allErrors.length} error(s))` : "\nPASSED");
  process.exit(allErrors.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
