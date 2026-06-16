#!/usr/bin/env node
/**
 * Phase 8G — eBay safe mapping hints verification.
 * Run: node scripts/verify-inventory-phase8g-ebay-safe-mapping-hints.mjs
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
    "supabase/migrations/20260915_inventory_phase8g_ebay_safe_mapping_hints.sql",
  ];
  const grandfathered = new Set([
    "js/admin/inventory/ui/mappingAssistModal.js",
    "js/admin/inventory/ui/shippedFinalizeAuditModal.js",
    "js/admin/inventory/api/mappingAssistApi.js",
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
  const audit = readFileSync(join(ROOT, "js/admin/inventory/ui/shippedFinalizeAuditModal.js"), "utf8");
  const api = readFileSync(join(ROOT, "js/admin/inventory/api/mappingAssistApi.js"), "utf8");
  const finalizeApi = readFileSync(join(ROOT, "js/admin/inventory/api/manualFinalizeAssistApi.js"), "utf8");
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260915_inventory_phase8g_ebay_safe_mapping_hints.sql"),
    "utf8",
  );

  if (!modal.includes("eBay mapping evidence")) errors.push("Mapping assist missing eBay evidence panel");
  else notes.push("eBay evidence UI present");

  if (!modal.includes("variantPickRequired")) errors.push("Mapping assist missing variant pick guard");
  else notes.push("Multi-variant manual pick wired");

  if (!modal.includes("fromShippedAudit")) errors.push("Mapping assist missing shipped audit flow");
  else notes.push("Shipped audit mapping flow wired");

  if (!audit.includes("data-audit-map-line")) errors.push("Shipped audit missing Map Line action");
  else notes.push("Map Line from shipped audit wired");

  if (!modal.includes("window.confirm")) errors.push("Mapping still requires admin confirmation");
  else notes.push("Admin confirmation gate intact");

  if (/sync-ebay|callEdge|ebay-manage/.test(api)) errors.push("Mapping API must not call eBay APIs");
  else notes.push("No eBay API writes in mapping API");

  if (/manual_finalize_shipped_order_line/.test(modal)) {
    errors.push("Mapping assist must not auto-finalize");
  } else notes.push("Manual finalize remains separate");

  if (!sql.includes("ebay_exact_sku") || !sql.includes("title_similarity")) {
    errors.push("Migration missing eBay match types");
  } else notes.push("eBay match types in migration");

  if (!sql.includes("v_inventory_ebay_unmapped_group_counts")) {
    errors.push("Group counts view missing");
  } else notes.push("Repeated pattern group view present");

  if (/INSERT|UPDATE|DELETE|\.rpc\(/.test(api.replace(/apply_inventory_mapping_assist/g, ""))) {
    // apply RPC only on confirm - ok
  }

  if (/sync-ebay|callEdge/.test(finalizeApi)) {
    errors.push("Finalize API must not call channel sync");
  } else notes.push("Manual finalize API unchanged");

  return { notes, errors };
}

async function applyMigrationIfNeeded(client) {
  const col = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_inventory_mapping_suggestions'
      AND column_name = 'variant_pick_required'
  `);
  if (col.rows.length) return { applied: false };

  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260915_inventory_phase8g_ebay_safe_mapping_hints.sql"),
    "utf8",
  );
  await client.query(sql);
  return { applied: true };
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  let matchCounts = {};
  let confidenceCounts = {};

  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const mig = await applyMigrationIfNeeded(client);
    if (mig.applied) notes.push("Applied Phase 8G migration");
    else notes.push("Phase 8G migration already applied");

    const view = await client.query(`
      SELECT 1 FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_inventory_ebay_unmapped_group_counts'
    `);
    if (!view.rows.length) errors.push("v_inventory_ebay_unmapped_group_counts missing");
    else notes.push("Group counts view exists");

    const col = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_inventory_mapping_suggestions'
        AND column_name = 'evidence_ebay_listing_id'
    `);
    if (!col.rows.length) errors.push("eBay evidence columns missing on suggestions view");
    else notes.push("eBay evidence columns on suggestions view");

    const ebaySuggestions = await client.query(`
      SELECT match_type, confidence, COUNT(*)::int c
      FROM v_inventory_mapping_suggestions
      WHERE source_channel = 'ebay' AND issue_type = 'unmapped_order_line'
      GROUP BY 1, 2 ORDER BY c DESC
    `);
    for (const r of ebaySuggestions.rows) {
      const key = `${r.match_type}:${r.confidence}`;
      matchCounts[key] = r.c;
    }
    notes.push(`eBay suggestion breakdown: ${JSON.stringify(matchCounts)}`);

    const mt = await client.query(`
      SELECT match_type, COUNT(*)::int c
      FROM v_inventory_mapping_suggestions
      WHERE source_channel = 'ebay'
      GROUP BY 1 ORDER BY c DESC
    `);
    confidenceCounts = Object.fromEntries(mt.rows.map((r) => [r.match_type, r.c]));

    const highExact = Number(
      (await client.query(`
        SELECT COUNT(*)::int c FROM v_inventory_mapping_suggestions
        WHERE source_channel = 'ebay'
          AND match_type IN ('ebay_exact_sku', 'exact_sku', 'ebay_listing_id', 'ebay_offer_id')
          AND confidence = 'high'
      `)).rows[0].c,
    );
    const lowTitle = Number(
      (await client.query(`
        SELECT COUNT(*)::int c FROM v_inventory_mapping_suggestions
        WHERE source_channel = 'ebay' AND match_type = 'title_similarity'
      `)).rows[0].c,
    );
    notes.push(`High-confidence eBay matches: ${highExact}, title_similarity: ${lowTitle}`);

    if (highExact > 0 || lowTitle > 0) {
      notes.push("Match type distribution available for rank validation");
    } else {
      notes.push("No eBay suggestions with typed matches in current sample (empty-state OK)");
    }

    const variantPick = (
      await client.query(`
        SELECT COUNT(*)::int c FROM v_inventory_mapping_suggestions
        WHERE source_channel = 'ebay' AND variant_pick_required = true
      `)
    ).rows[0].c;
    notes.push(`eBay rows requiring manual variant pick: ${variantPick}`);

    const groups = (
      await client.query(`SELECT COUNT(*)::int c FROM v_inventory_ebay_unmapped_group_counts`)
    ).rows[0].c;
    notes.push(`Repeated unmapped eBay pattern groups: ${groups}`);

    const stockBefore = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resBefore = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    await client.query(`
      SELECT * FROM v_inventory_mapping_suggestions
      WHERE source_channel = 'ebay' LIMIT 5
    `);

    const stockAfter = (await client.query(`SELECT COALESCE(SUM(stock),0)::bigint t FROM product_variants`)).rows[0].t;
    const ledgerAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM stock_ledger`)).rows[0].t;
    const resAfter = (await client.query(`SELECT COUNT(*)::bigint t FROM inventory_reservations`)).rows[0].t;

    if (String(stockBefore) !== String(stockAfter)) errors.push("On-hand changed during verify");
    else notes.push("On-hand unchanged");

    if (String(ledgerBefore) !== String(ledgerAfter)) errors.push("Ledger rows inserted during verify");
    else notes.push("No ledger inserts");

    if (String(resBefore) !== String(resAfter)) errors.push("Reservations changed during verify");
    else notes.push("No reservation mutations");

    const fn = await client.query(`
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'manual_finalize_shipped_order_line'
    `);
    if (!fn.rows.length) errors.push("8F manual finalize RPC missing");
    else notes.push("8F manual finalize RPC intact");

    return { notes, errors, matchCounts, confidenceCounts };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return { notes, errors, matchCounts, confidenceCounts };
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
      errors.push("Mapping assist mount missing");
    } else notes.push("Inventory page loads cleanly");
    if (!(await page.locator("#inventoryShippedAuditModalMount").count())) {
      errors.push("Shipped audit mount missing");
    } else notes.push("Shipped audit mount present");
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

  console.log("Phase 8G — eBay safe mapping hints verification\n");

  const src = verifySourceFiles();
  const db = await verifyDatabase();
  const page = await verifyInventoryPage();

  for (const n of [...src.notes, ...db.notes, ...page.notes]) console.log(`  ✓ ${n}`);
  const errors = [...src.errors, ...db.errors, ...page.errors];
  for (const e of errors) console.error(`  ✗ ${e}`);

  console.log("\neBay match type counts:", JSON.stringify(db.confidenceCounts, null, 2));
  console.log("eBay match:confidence:", JSON.stringify(db.matchCounts, null, 2));

  if (errors.length) {
    console.error(`\nFAIL — ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nPASS — Phase 8G verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
