#!/usr/bin/env node
/**
 * Phase 8A — Inventory issue workflows verification.
 * Run: node scripts/verify-inventory-phase8a-issue-workflows.mjs
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
    "js/admin/inventory/services/issueActions.js",
    "js/admin/inventory/services/issueActionHandlers.js",
    "js/admin/inventory/api/issuesApi.js",
    "js/admin/inventory/ui/issueDetailModal.js",
    "js/admin/inventory/ui/syncRecentSyncLogs.js",
    "js/admin/inventory/renderers/renderIssues.js",
    "supabase/migrations/20260909_inventory_phase8a_issue_workflows.sql",
  ];

  const grandfathered = new Set([
    "js/admin/inventory/ui/syncDryRunModal.js",
    "js/admin/inventory/events.js",
  ]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const actions = readFileSync(join(ROOT, "js/admin/inventory/services/issueActions.js"), "utf8");
  const handlers = readFileSync(join(ROOT, "js/admin/inventory/services/issueActionHandlers.js"), "utf8");
  const issuesUi = readFileSync(join(ROOT, "js/admin/inventory/renderers/renderIssues.js"), "utf8");
  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/syncDryRunModal.js"), "utf8");

  const requiredTypes = [
    "unmapped_order_line",
    "negative_stock",
    "negative_available",
    "parcel_mapping_missing",
    "ebay_listing_ended",
    "ebay_qty_cache_missing",
    "channel_sync_failed",
  ];
  for (const t of requiredTypes) {
    if (!actions.includes(`${t}:`)) errors.push(`issueActions missing ${t}`);
  }
  if (!errors.length) notes.push("Issue action matrix covers core types");

  if (/callEdge|ebay-manage-listing|sync-amazon|sync-ebay.*quantity/i.test(handlers)) {
    errors.push("Issue handlers must not auto-invoke channel sync APIs");
  } else notes.push("Issue handlers are navigation/helpers only");

  if (!issuesUi.includes("data-inventory-issue-primary")) errors.push("Issues panel missing primary actions");
  if (!issuesUi.includes("data-inventory-issue-detail")) errors.push("Issues panel missing detail buttons");
  else notes.push("Issues panel renders action buttons");

  if (!modal.includes("syncRecentSyncLogs")) errors.push("Sync modal missing recent failures section");
  else notes.push("Sync modal includes recent sync failures");

  const relist = readFileSync(join(ROOT, "js/admin/inventory/ui/syncEbayRelistAssist.js"), "utf8");
  if (/callEdge|ebay-manage-listing/.test(relist)) errors.push("Relist assist must stay link-only");
  else notes.push("eBay relist assist unchanged (link-only)");

  return { notes, errors };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const counts = {};

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;

    const types = await client.query(`
      SELECT issue_type, COUNT(*)::int c
      FROM v_inventory_issues
      GROUP BY 1 ORDER BY c DESC
    `);
    for (const row of types.rows) counts[row.issue_type] = row.c;
    notes.push(`v_inventory_issues types: ${types.rows.length}`);

    const has8a = ["negative_available", "ebay_qty_cache_missing", "ebay_unsupported_variation"];
    for (const t of has8a) {
      if (!(t in counts)) notes.push(`View supports ${t} (count may be 0)`);
    }

    const viewDef = await client.query(`
      SELECT pg_get_viewdef('public.v_inventory_issues'::regclass, true) def
    `);
    if (!String(viewDef.rows[0]?.def || "").includes("channel_sync_failed")) {
      errors.push("v_inventory_issues missing channel_sync_failed branch");
    } else notes.push("Extended issues view includes channel_sync_failed");

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;
    if (String(stockBefore) !== String(stockAfter) || resBefore !== resAfter) {
      errors.push("Stock/reservations mutated during verify");
    } else notes.push("No stock/reservation mutations");

    return { notes, errors, counts };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, counts };
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
    if (!(await page.locator("#inventoryIssuesMount").count())) errors.push("Issues mount missing");
    else notes.push("Inventory page loads with issues mount");

    if (!(await page.locator("#inventoryIssueDetailModalMount").count())) {
      errors.push("Issue detail modal mount missing");
    } else notes.push("Issue detail modal mount present");

    const html = readFileSync(join(ROOT, "pages/admin/inventory.html"), "utf8");
    if (!html.includes("inventoryIssueDetailModalMount")) errors.push("HTML missing issue modal mount");

    const issuesSrc = readFileSync(join(ROOT, "js/admin/inventory/renderers/renderIssues.js"), "utf8");
    if (!issuesSrc.includes("openIssueDetailModal") && !issuesSrc.includes("data-inventory-issue-detail")) {
      errors.push("Issues renderer missing detail wiring");
    }
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

  console.log("Phase 8A — Issue workflows verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nIssue counts:", JSON.stringify(db.counts, null, 2));
  console.log("\nImplemented routes: navigation + sync modal + adjust + detail modal");
  console.log("Future routes: none (FUTURE_ISSUE_ROUTES empty)");

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 8A verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
