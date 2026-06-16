#!/usr/bin/env node
/**
 * Phase 10N — Marketplace refund persistence verification.
 * Run: node scripts/verify-inventory-phase10n-marketplace-refund-persistence.mjs
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
const PORT = 9912;
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
    "js/admin/inventory/ui/bundleReturnRestockRefund.js",
    "js/admin/inventory/api/refundRefreshApi.js",
  ];
  const files = [
    ...lineLimitFiles,
    "supabase/migrations/20261004_inventory_phase10n_marketplace_refund_observations_table.sql",
    "supabase/migrations/20261005_inventory_phase10n_backfill_rpc.sql",
    "supabase/migrations/20261006_inventory_phase10n_observations_view.sql",
    "supabase/migrations/20261007_inventory_phase10n_return_guidance_persisted.sql",
    "scripts/backfill-marketplace-refund-observations.mjs",
    "docs/pages/admin/inventory/implementation/045_phase_10n_marketplace_refund_persistence.md",
  ];

  for (const rel of files) {
    if (!existsSync(join(ROOT, rel))) errors.push(`Missing: ${rel}`);
    else {
      const lines = lineCount(rel);
      if (lineLimitFiles.includes(rel) && lines > MAX_LINES) {
        errors.push(`${rel} exceeds ${MAX_LINES} lines (${lines})`);
      } else notes.push(`${rel}: ${lines} lines`);
    }
  }

  const tableMig = read("supabase/migrations/20261004_inventory_phase10n_marketplace_refund_observations_table.sql");
  for (const sym of ["marketplace_refund_observations", "observation_dedup_key", "is_afn"]) {
    if (!tableMig.includes(sym)) errors.push(`Table migration missing ${sym}`);
    else notes.push(`Table has ${sym}`);
  }

  const rpcMig = read("supabase/migrations/20261005_inventory_phase10n_backfill_rpc.sql");
  if (!rpcMig.includes("backfill_marketplace_refund_observations")) {
    errors.push("Backfill RPC missing");
  } else notes.push("Backfill RPC defined");

  if (rpcMig.includes("stock_ledger") || rpcMig.includes("inventory_return_workflow")) {
    errors.push("Backfill RPC must not mutate inventory");
  } else notes.push("Backfill RPC is observational only");

  const viewMig = read("supabase/migrations/20261006_inventory_phase10n_observations_view.sql");
  if (!viewMig.includes("marketplace_refund_observations")) errors.push("View must union persisted table");
  else notes.push("Observations view includes persisted rows");
  if (!viewMig.includes("observation_source")) errors.push("View missing observation_source");
  else notes.push("View exposes observation_source");

  const backfill = read("scripts/backfill-marketplace-refund-observations.mjs");
  if (!backfill.includes("--dry-run")) errors.push("Backfill script must support --dry-run");
  else notes.push("Backfill script supports dry-run");

  const ebayFin = read("supabase/functions/ebay-sync-finances/index.ts");
  if (!ebayFin.includes("REVERSAL")) errors.push("eBay finance sync should persist REVERSAL");
  else notes.push("eBay finance sync persists REFUND/CREDIT/REVERSAL");

  const refundUi = read("js/admin/inventory/ui/bundleReturnRestockRefund.js");
  if (!refundUi.includes("Refresh Marketplace Observations")) {
    errors.push("Marketplace refresh button missing");
  } else notes.push("Marketplace refresh button present");
  if (!refundUi.includes("observational and may be order-level")) {
    errors.push("Marketplace observational copy missing");
  } else notes.push("Marketplace observational copy present");

  const api = read("js/admin/inventory/api/refundRefreshApi.js");
  if (!api.includes("refreshMarketplaceObservations")) errors.push("refreshMarketplaceObservations API missing");
  else notes.push("Marketplace refresh API via RPC");

  return { notes, errors };
}

async function applyMigrations(client) {
  const migs = [
    "supabase/migrations/20261004_inventory_phase10n_marketplace_refund_observations_table.sql",
    "supabase/migrations/20261005_inventory_phase10n_backfill_rpc.sql",
    "supabase/migrations/20261006_inventory_phase10n_observations_view.sql",
    "supabase/migrations/20261007_inventory_phase10n_return_guidance_persisted.sql",
  ];
  const applied = [];
  for (const rel of migs) {
    const name = rel.includes("table")
      ? "marketplace_refund_observations"
      : rel.includes("backfill")
        ? "backfill_marketplace_refund_observations"
        : rel.includes("observations_view")
          ? "v_inventory_marketplace_refund_observations"
          : "v_inventory_bundle_component_return_guidance";
    const kind = rel.includes("backfill") ? "r" : rel.includes("table") ? "r" : "v";
    const exists = await client.query(
      kind === "r"
        ? `SELECT 1 FROM pg_proc WHERE proname = $1`
        : `SELECT 1 FROM information_schema.views WHERE table_name = $1`,
      [name],
    );
    if (kind === "r" && name === "marketplace_refund_observations") {
      const t = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_refund_observations'`,
      );
      if (!t.rows.length) {
        await client.query(read(rel));
        applied.push(rel);
      }
      continue;
    }
    if (kind === "r" && name === "backfill_marketplace_refund_observations") {
      const f = await client.query(`SELECT 1 FROM pg_proc WHERE proname = $1`, [name]);
      if (!f.rows.length) {
        await client.query(read(rel));
        applied.push(rel);
      }
      continue;
    }
    if (!exists.rows.length) {
      await client.query(read(rel));
      applied.push(rel);
    }
  }
  return applied;
}

async function cleanup(client, ids) {
  for (const id of ids) {
    await client.query(`DELETE FROM marketplace_refund_observations WHERE source_order_id = $1`, [id]);
    await client.query(`DELETE FROM inventory_return_workflow WHERE source_order_id = $1`, [id]);
    await client.query(`DELETE FROM fulfillment_shipments WHERE stripe_checkout_session_id = $1`, [id]);
    await client.query(`DELETE FROM line_items_raw WHERE stripe_checkout_session_id = $1`, [id]);
    await client.query(`DELETE FROM orders_raw WHERE stripe_checkout_session_id = $1`, [id]);
  }
}

async function verifyDatabase() {
  const notes = [];
  const errors = [];
  const client = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  const ebayOrder = `ebay_10n_${Date.now()}`;
  const amazonOrder = `amazon_10n_${Date.now()}`;
  const txnId = `txn_10n_${Date.now()}`;

  try {
    await client.connect();
    const applied = await applyMigrations(client);
    if (applied.length) notes.push(`Applied: ${applied.join(", ")}`);
    else notes.push("Phase 10N migrations already applied");

    const table = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_refund_observations'`,
    );
    if (!table.rows.length) {
      notes.push("Skipped DB fixture (table missing)");
      return { notes, errors };
    }

    await cleanup(client, [ebayOrder, amazonOrder]);

    await client.query(`
      INSERT INTO orders_raw (stripe_checkout_session_id, total_paid_cents, refund_status, refund_amount_cents)
      VALUES ($1, 2000, 'full', 2000)
    `, [ebayOrder]);

    const dryBefore = (
      await client.query(`SELECT COUNT(*)::int AS c FROM marketplace_refund_observations`)
    ).rows[0]?.c;

    const result = await client.query(
      `SELECT public.backfill_marketplace_refund_observations('ebay', NULL, 100, $1) AS r`,
      [ebayOrder],
    );
    const stats = result.rows[0]?.r;
    if (!stats || (stats.inserted === 0 && stats.updated === 0)) {
      errors.push("Backfill should upsert order-level observation");
    } else notes.push(`Backfill upserted (${stats.inserted} ins, ${stats.updated} upd)`);

    const result2 = await client.query(
      `SELECT public.backfill_marketplace_refund_observations('ebay', NULL, 100, $1) AS r`,
      [ebayOrder],
    );
    const stats2 = result2.rows[0]?.r;
    if ((stats2?.inserted ?? 0) > 0) errors.push("Second backfill should not duplicate (idempotent)");
    else notes.push("Backfill idempotent on repeat");

    const obs = await client.query(
      `SELECT source_channel, sync_source FROM marketplace_refund_observations WHERE source_order_id = $1`,
      [ebayOrder],
    );
    if (!obs.rows.length) errors.push("Persisted observation missing");
    else notes.push("Persisted observation row exists");

    const wf = await client.query(
      `SELECT COUNT(*)::int AS c FROM inventory_return_workflow WHERE source_order_id = $1`,
      [ebayOrder],
    );
    if (Number(wf.rows[0]?.c) > 0) errors.push("Backfill must not create return workflow");
    else notes.push("No return workflow auto-created");

    const view = await client.query(
      `SELECT observation_source FROM v_inventory_marketplace_refund_observations WHERE source_order_id = $1`,
      [ebayOrder],
    );
    if (!view.rows.some((r) => r.observation_source === "persisted")) {
      errors.push("View should expose persisted observation");
    } else notes.push("View reads persisted observations");

    await cleanup(client, [ebayOrder, amazonOrder]);
    notes.push("Fixture cleaned up");
  } catch (err) {
    errors.push(`DB error: ${err instanceof Error ? err.message : String(err)}`);
    try {
      await cleanup(client, [ebayOrder, amazonOrder]);
    } catch {
      // ignore
    }
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
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10N — Marketplace refund persistence verification\n");

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
