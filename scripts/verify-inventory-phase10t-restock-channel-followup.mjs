#!/usr/bin/env node
/**
 * Phase 10T — Restock channel follow-up verification.
 * Run: node scripts/verify-inventory-phase10t-restock-channel-followup.mjs
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
const PORT = 9918;
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
    "js/admin/inventory/ui/restockFollowupChecklist.js",
    "js/admin/inventory/api/restockFollowupApi.js",
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
    "js/admin/inventory/ui/marketplaceRestockAssistQueueModal.js",
  ];
  const required = [
    ...lineLimitFiles,
    "supabase/migrations/20261014_inventory_phase10t_restock_channel_followup.sql",
    "docs/pages/admin/inventory/implementation/051_phase_10t_restock_channel_followup.md",
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

  const mig = read("supabase/migrations/20261014_inventory_phase10t_restock_channel_followup.sql");
  for (const obj of [
    "v_inventory_restock_followup_candidates",
    "inventory_restock_followup_states",
    "upsert_inventory_restock_followup_state",
    "restock_channel_followup_needed",
  ]) {
    if (!mig.includes(obj)) errors.push(`Migration missing: ${obj}`);
    else notes.push(`Migration includes ${obj}`);
  }

  for (const status of [
    "needs_channel_review",
    "needs_amazon_review",
    "needs_ebay_review",
    "no_channel_mapping",
    "kk_updated",
    "completed",
  ]) {
    if (!mig.includes(status)) errors.push(`followup_status ${status} missing`);
    else notes.push(`followup_status: ${status}`);
  }

  const followup = read("js/admin/inventory/api/restockFollowupApi.js");
  if (followup.includes("restock_bundle_component_line") || followup.includes("restockBundleComponentLine")) {
    errors.push("Follow-up API must not call restock RPC");
  } else notes.push("Follow-up API does not restock");
  if (followup.includes("pushAmazon") || followup.includes("channel sync push")) {
    errors.push("Follow-up API must not auto-sync");
  } else notes.push("No auto-sync in follow-up API");

  const checklist = read("js/admin/inventory/ui/restockFollowupChecklist.js");
  if (!checklist.includes("openSyncDryRunModal")) errors.push("Checklist must link Sync Channels modal");
  else notes.push("Sync Channels link in checklist");
  if (!checklist.includes("upsertRestockFollowupState")) errors.push("Checklist must update follow-up state");
  else notes.push("Follow-up state updates in checklist");
  if (checklist.includes("restockBundleComponentLine")) errors.push("Checklist must not restock");
  else notes.push("Checklist does not restock");

  const syncModal = read("js/admin/inventory/ui/syncDryRunModal.js");
  if (!syncModal.includes("contextNote")) errors.push("Sync modal must accept post-restock context");
  else notes.push("Sync modal post-restock context");

  const panel = read("js/admin/inventory/ui/bundleReturnRestockPanel.js");
  if (!panel.includes("restockActionId") && !panel.includes("ledgerId")) {
    errors.push("Panel must pass restock ids to checklist");
  } else notes.push("Panel passes restock ids to checklist");

  const queueActions = read("js/admin/inventory/ui/marketplaceRestockAssistQueueActions.js");
  if (!queueActions.includes("restockBundleComponentLine")) errors.push("Queue restock must use RPC");
  else notes.push("Queue restock via restockBundleComponentLine");
  if (!queueActions.includes("openRestockFollowupChecklistModal")) {
    errors.push("Queue must open follow-up after restock");
  } else notes.push("Queue opens follow-up after restock");

  const audit = read("js/admin/inventory/ui/marketplaceRestockAssistAuditPanel.js");
  if (!audit.includes("data-audit-followup")) errors.push("Audit panel follow-up link missing");
  else notes.push("Audit follow-up link");

  const issues = read("js/admin/inventory/services/issueActions.js");
  if (!issues.includes("restock_channel_followup_needed")) errors.push("Issue action missing");
  else notes.push("restock_channel_followup_needed issue");

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
    const view = await client.query(
      `SELECT 1 FROM information_schema.views WHERE table_name = 'v_inventory_restock_followup_candidates'`,
    );
    if (!view.rows.length) {
      notes.push("Skipped DB checks (apply 10T migration first)");
      return { notes, errors };
    }
    notes.push("Follow-up view exists");

    const tbl = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_restock_followup_states'`,
    );
    if (!tbl.rows.length) errors.push("Follow-up states table missing");
    else notes.push("Follow-up states table exists");

    notes.push("DB checks OK");
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

    if (!(await page.locator("[data-inventory-restock-queue]").count())) {
      errors.push("Restock queue button missing");
    } else notes.push("Marketplace Restock Assist Queue entry");

    if (!(await page.locator("[data-inventory-bundle-preview]").count())) {
      errors.push("Bundle preview entry missing");
    } else notes.push("Bundle Return/Restock panel entry");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10T — Restock channel follow-up verification\n");

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
