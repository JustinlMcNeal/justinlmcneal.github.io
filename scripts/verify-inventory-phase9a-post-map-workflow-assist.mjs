#!/usr/bin/env node
/**
 * Phase 9A — Post-map workflow assist verification.
 * Run: node scripts/verify-inventory-phase9a-post-map-workflow-assist.mjs
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
const PORT = 9896;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;

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
      const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : "";
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(readFileSync(filePath));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function lineCount(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8").split("\n").length;
}

function verifySourceFiles() {
  const notes = [];
  const errors = [];
  const files = [
    "js/admin/inventory/api/postMappingWorkflowApi.js",
    "js/admin/inventory/ui/postMappingChecklistModal.js",
    "supabase/migrations/20260917_inventory_phase9a_post_map_workflow_assist.sql",
  ];
  const grandfathered = new Set([
    "js/admin/inventory/ui/mappingAssistModal.js",
    "js/admin/inventory/ui/ebayMappingWorklistModal.js",
    "js/admin/lineItemsOrders/index.js",
  ]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const checklist = readFileSync(join(ROOT, "js/admin/inventory/ui/postMappingChecklistModal.js"), "utf8");
  const assist = readFileSync(join(ROOT, "js/admin/inventory/ui/mappingAssistModal.js"), "utf8");
  const worklist = readFileSync(join(ROOT, "js/admin/inventory/ui/ebayMappingWorklistModal.js"), "utf8");
  const links = readFileSync(join(ROOT, "js/admin/inventory/constants/orderLinks.js"), "utf8");
  const orders = readFileSync(join(ROOT, "js/admin/lineItemsOrders/index.js"), "utf8");

  if (!checklist.includes("Mapped Lines — Next Steps")) errors.push("Checklist modal missing title");
  else notes.push("Post-map checklist UI present");

  if (/retry_inventory_reservation|manual_finalize_shipped|apply_inventory_mapping_assist\(/.test(checklist)) {
    errors.push("Checklist must not auto-execute retry/finalize/apply");
  } else notes.push("Checklist is navigation-only (no auto RPC)");

  if (!checklist.includes("promptReservationRetry") || !checklist.includes("promptManualFinalize")) {
    notes.push("Checklist links to existing confirm flows");
  }

  if (!assist.includes("showPostMappingChecklist")) errors.push("Mapping assist missing post-map checklist");
  else notes.push("Single-line mapping integrates checklist");

  if (!worklist.includes("showPostMappingChecklist")) errors.push("eBay worklist missing post-map checklist");
  else notes.push("Batch mapping integrates checklist");

  if (!links.includes("buildLineItemsOrdersUrl")) errors.push("Deep link helper missing");
  else notes.push("Line Items Orders URL helper");

  if (!orders.includes("applyLineItemsDeepLink")) errors.push("Line Items deep-link handler missing");
  else notes.push("Line Items deep-link handler");

  if (assist.includes("showPostMappingReservationRetry")) {
    errors.push("Old reservation-only post-map flow should be replaced");
  }

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const view = await client.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'v_inventory_post_mapping_workflow_candidates'
  `);
  if (view.rows.length) return { applied: false };

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260917_inventory_phase9a_post_map_workflow_assist.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  let totalCandidates = 0;
  let stepCounts = {};

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 9A migration");
    else notes.push("Phase 9A migration already applied");

    const wl = await client.query(`
      SELECT 1 FROM information_schema.views
      WHERE table_name = 'v_inventory_post_mapping_workflow_candidates'
    `);
    if (!wl.rows.length) errors.push("Post-map view missing");
    else notes.push("v_inventory_post_mapping_workflow_candidates exists");

    totalCandidates = (
      await client.query(`SELECT COUNT(*)::int c FROM v_inventory_post_mapping_workflow_candidates`)
    ).rows[0].c;
    notes.push(`Post-map candidate rows: ${totalCandidates}`);

    const steps = await client.query(`
      SELECT next_step, COUNT(*)::int c
      FROM v_inventory_post_mapping_workflow_candidates
      GROUP BY 1 ORDER BY c DESC
    `);
    stepCounts = Object.fromEntries(steps.rows.map((r) => [r.next_step, r.c]));

    const sample = await client.query(`
      SELECT mapping_action_id, next_step, action_target
      FROM v_inventory_post_mapping_workflow_candidates
      ORDER BY mapped_at DESC LIMIT 3
    `);
    if (sample.rows.length) notes.push(`Recent samples: ${JSON.stringify(sample.rows)}`);

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    await client.query(`SELECT * FROM v_inventory_post_mapping_workflow_candidates LIMIT 5`);

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand changed during verify");
    else notes.push("On-hand unchanged");

    if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("Ledger changed during verify");
    else notes.push("No ledger mutations");

    if (String(resBefore) !== String(resAfter)) errors.push("Reservations changed during verify");
    else notes.push("No reservation mutations");

    return { notes, errors, totalCandidates, stepCounts };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, totalCandidates, stepCounts };
  } finally {
    await client.end().catch(() => {});
  }
}

async function verifyInventoryPage() {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!(await page.locator("#inventoryPostMapChecklistMount").count())) {
      errors.push("Post-map checklist mount missing");
    } else notes.push("Inventory page loads with checklist mount");
    if (!(await page.locator("#inventoryMappingAssistModalMount").count())) {
      errors.push("Mapping assist mount missing");
    } else notes.push("Mapping assist mount present");
    if (!(await page.locator("#inventoryEbayWorklistModalMount").count())) {
      errors.push("eBay worklist mount missing");
    } else notes.push("eBay worklist mount present");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  return { notes, errors };
}

async function main() {
  const fileEnv = loadEnv();
  for (const [k, v] of Object.entries(fileEnv)) {
    if (!process.env[k]) process.env[k] = v;
  }

  console.log("Phase 9A — Post-map workflow assist verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nPost-map candidate rows:", db.totalCandidates);
  console.log("Next-step counts:", JSON.stringify(db.stepCounts, null, 2));

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 9A verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
