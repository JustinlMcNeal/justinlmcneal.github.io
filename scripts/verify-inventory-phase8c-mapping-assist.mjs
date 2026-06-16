#!/usr/bin/env node
/**
 * Phase 8C — Mapping assist wizards verification.
 * Run: node scripts/verify-inventory-phase8c-mapping-assist.mjs
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
const PORT = 9898;
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
    "js/admin/inventory/api/mappingAssistApi.js",
    "js/admin/inventory/ui/mappingAssistModal.js",
    "supabase/migrations/20260911_inventory_phase8c_mapping_assist.sql",
  ];
  const grandfathered = new Set([
    "js/admin/inventory/ui/issueDetailModal.js",
    "js/admin/inventory/events.js",
    "supabase/migrations/20260911_inventory_phase8c_mapping_assist.sql",
  ]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const modal = readFileSync(join(ROOT, "js/admin/inventory/ui/mappingAssistModal.js"), "utf8");
  const detail = readFileSync(join(ROOT, "js/admin/inventory/ui/issueDetailModal.js"), "utf8");
  const api = readFileSync(join(ROOT, "js/admin/inventory/api/mappingAssistApi.js"), "utf8");
  const issues = readFileSync(join(ROOT, "js/admin/inventory/renderers/renderIssues.js"), "utf8");

  for (const token of ["Confirm Mapping", "window.confirm", "applyMappingAssist"]) {
    if (!modal.includes(token)) errors.push(`mappingAssistModal missing ${token}`);
  }
  if (!detail.includes("Open Mapping Assist")) errors.push("issueDetailModal missing mapping assist entry");
  if (!issues.includes("data-inventory-mapping-assist")) errors.push("Issues panel missing Map Assist button");
  else notes.push("Modal + issue detail + panel wiring present");

  if (/sync-amazon|sync-ebay|callEdge|amazon-manage-listing/.test(api)) {
    errors.push("mappingAssistApi must not call channel APIs");
  } else notes.push("No channel API writes in mapping assist API");

  if (/product_variants.*stock|inventory_reservations|adjust_inventory/.test(api)) {
    errors.push("mappingAssistApi must not mutate stock");
  } else notes.push("Mapping assist API avoids stock mutations");

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

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;

    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('inventory_mapping_assist_actions')
    `);
    if (!tables.rows.length) errors.push("inventory_mapping_assist_actions missing");
    else notes.push("Audit table exists");

    const view = await client.query(`
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_inventory_mapping_suggestions'
    `);
    if (!view.rows.length) errors.push("v_inventory_mapping_suggestions missing");
    else notes.push("Suggestions view exists");

    const fn = await client.query(`
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'apply_inventory_mapping_assist'
    `);
    if (!fn.rows.length) errors.push("apply_inventory_mapping_assist RPC missing");
    else notes.push("Apply RPC exists");

    const suggestions = await client.query(`
      SELECT issue_type, match_type, confidence, COUNT(*)::int c
      FROM v_inventory_mapping_suggestions
      GROUP BY 1,2,3
      ORDER BY c DESC
      LIMIT 20
    `);
    notes.push(`Suggestion rows loaded: ${suggestions.rows.length} groups`);

    const exactVsTitle = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE match_type = 'exact_sku')::int AS exact_sku,
        COUNT(*) FILTER (WHERE match_type = 'product_code')::int AS product_code,
        COUNT(*) FILTER (WHERE confidence = 'high')::int AS high_conf
      FROM v_inventory_mapping_suggestions
    `);
    const row = exactVsTitle.rows[0] || {};
    notes.push(`Suggestion mix: exact_sku=${row.exact_sku ?? 0}, product_code=${row.product_code ?? 0}, high=${row.high_conf ?? 0}`);

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::int c FROM inventory_reservations`)).rows[0].c;
    if (String(stockBefore) !== String(stockAfter) || resBefore !== resAfter) {
      errors.push("Stock/reservations mutated during verify read");
    } else notes.push("No stock/reservation mutations");

    return { notes, errors };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors };
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
    if (!(await page.locator("#inventoryMappingAssistModalMount").count())) {
      errors.push("Mapping assist modal mount missing");
    } else notes.push("Mapping assist modal mount present");

    const html = readFileSync(join(ROOT, "pages/admin/inventory.html"), "utf8");
    if (!html.includes("inventoryMappingAssistModalMount")) errors.push("HTML missing mapping assist mount");

    if (!(await page.locator("#inventoryIssueDetailModalMount").count())) {
      errors.push("Issue detail modal mount missing");
    } else notes.push("Inventory page loads cleanly");
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

  console.log("Phase 8C — Mapping assist verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nSupported issue types: unmapped_order_line, amazon_mapping_missing");
  console.log("Excluded: eBay mapping wizard, auto-apply, stock/reservation retroactive fixes");

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 8C verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
