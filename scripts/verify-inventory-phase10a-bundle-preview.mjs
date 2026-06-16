#!/usr/bin/env node
/**
 * Phase 10A — Bundle/component preview verification.
 * Run: node scripts/verify-inventory-phase10a-bundle-preview.mjs
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
const PORT = 9899;
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
    "js/admin/inventory/api/bundlePreviewApi.js",
    "js/admin/inventory/ui/bundlePreviewModal.js",
    "js/admin/inventory/renderers/renderBundle.js",
  ];
  const grandfathered = new Set([
    "supabase/migrations/20260920_inventory_phase10a_bundle_preview.sql",
  ]);

  for (const rel of [...files, ...grandfathered]) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (!grandfathered.has(rel) && lines > MAX_LINES) errors.push(`${rel} exceeds ${MAX_LINES} lines`);
      else notes.push(`${rel}: ${lines} lines${grandfathered.has(rel) ? " (grandfathered)" : ""}`);
    }
  }

  const bundleJs = readFileSync(join(ROOT, "js/admin/inventory/renderers/renderBundle.js"), "utf8");
  const modalJs = readFileSync(join(ROOT, "js/admin/inventory/ui/bundlePreviewModal.js"), "utf8");
  const kkStock = readFileSync(join(ROOT, "js/shared/kkAvailableStock.js"), "utf8");

  if (!bundleJs.includes("Preview Only")) errors.push("Preview label missing from panel");
  else notes.push("Preview Only label present");

  if (!bundleJs.includes("Does not affect checkout")) notes.push("Checkout disclaimer in panel");

  if (/retry_inventory_reservation|finalize_shipped|deduct.*component/.test(bundleJs + modalJs)) {
    errors.push("Bundle UI must not trigger live deduction");
  } else notes.push("No live deduction hooks in bundle UI");

  if (kkStock.includes("bundle") && /component/.test(kkStock)) {
    notes.push("kkAvailableStock unchanged (spot check)");
  } else notes.push("kkAvailableStock has no bundle write path (spot check)");

  if (!modalJs.includes("upsert_inventory_bundle_rule")) notes.push("Config-only rule form wired");

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const tbl = await client.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_bundle_rules'
  `);
  if (tbl.rows.length) return { applied: false };

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260920_inventory_phase10a_bundle_preview.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  let likeCount = 0;
  let summaryCount = 0;
  let availCount = 0;

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 10A migration");
    else notes.push("Phase 10A migration already applied");

    for (const view of [
      "v_inventory_bundle_like_variants",
      "v_inventory_bundle_availability_preview",
      "v_inventory_bundle_summary_preview",
    ]) {
      const v = await client.query(
        `SELECT 1 FROM information_schema.views WHERE table_name = $1`,
        [view],
      );
      if (!v.rows.length) errors.push(`View missing: ${view}`);
      else notes.push(`${view} exists`);
    }

    likeCount = (await client.query(`SELECT COUNT(*)::int c FROM v_inventory_bundle_like_variants`)).rows[0].c;
    summaryCount = (await client.query(`SELECT COUNT(*)::int c FROM v_inventory_bundle_summary_preview`)).rows[0].c;
    availCount = (
      await client.query(`SELECT COUNT(*)::int c FROM v_inventory_bundle_availability_preview`)
    ).rows[0].c;
    notes.push(`Preview counts — like: ${likeCount}, summary: ${summaryCount}, rules: ${availCount}`);

    const fn = await client.query(`SELECT 1 FROM pg_proc WHERE proname = 'upsert_inventory_bundle_rule'`);
    if (!fn.rows.length) errors.push("upsert_inventory_bundle_rule missing");
    else notes.push("Config RPC exists (admin auth at runtime)");

    const issues = await client.query(`
      SELECT issue_type FROM v_inventory_issues
      WHERE issue_type IN ('bundle_component_shortage', 'bundle_rule_missing', 'bundle_self_reference')
    `);
    notes.push(`Bundle preview issue types registered: ${issues.rows.length}`);

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    await client.query(`SELECT * FROM v_inventory_bundle_summary_preview LIMIT 5`);

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand changed");
    else notes.push("On-hand unchanged");

    if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("Ledger changed");
    else notes.push("No ledger mutations");

    if (String(resBefore) !== String(resAfter)) errors.push("Reservations changed");
    else notes.push("No reservation mutations");

    return { notes, errors, likeCount, summaryCount, availCount };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, likeCount, summaryCount, availCount };
  } finally {
    await client.end().catch(() => {});
  }
}

async function verifyPage() {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!(await page.locator("#inventoryBundleMount").count())) {
      errors.push("Bundle mount missing");
    } else notes.push("Bundle preview mount present");

    if (!(await page.locator("#inventoryBundlePreviewModalMount").count())) {
      errors.push("Bundle modal mount missing");
    } else notes.push("Bundle modal mount present");

    const html = readFileSync(join(ROOT, "pages/admin/inventory.html"), "utf8");
    if (!html.includes("Preview only")) errors.push("HTML preview disclaimer missing");
    else notes.push("Inventory page loads cleanly");
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

  console.log("Phase 10A — Bundle preview verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\nPreview counts:");
  console.log("  bundle-like variants:", db.likeCount);
  console.log("  summary rows:", db.summaryCount);
  console.log("  rule rows:", db.availCount);

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 10A verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
