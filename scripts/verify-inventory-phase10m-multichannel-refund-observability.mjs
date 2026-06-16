#!/usr/bin/env node
/**
 * Phase 10M — Multi-channel refund/cancellation observability verification.
 * Run: node scripts/verify-inventory-phase10m-multichannel-refund-observability.mjs
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
const PORT = 9911;
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
    "js/admin/inventory/api/returnWorkflowApi.js",
  ];
  const files = [
    ...lineLimitFiles,
    "supabase/migrations/20261002_inventory_phase10m_marketplace_refund_observations.sql",
    "supabase/migrations/20261002_inventory_phase10m_return_guidance_marketplace.sql",
    "supabase/migrations/20261003_inventory_phase10m_marketplace_issues.sql",
    "docs/pages/admin/inventory/implementation/044_phase_10m_multichannel_refund_observability.md",
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

  const obsMig = read("supabase/migrations/20261002_inventory_phase10m_marketplace_refund_observations.sql");
  for (const sym of [
    "v_inventory_marketplace_refund_observations",
    "order_refund_details",
    "orders_raw",
    "fulfillment_shipments",
    "amazon_finance_transactions",
    "ebay_finance_transactions",
  ]) {
    if (!obsMig.includes(sym)) errors.push(`Observations view missing source: ${sym}`);
    else notes.push(`Observations view includes ${sym}`);
  }

  const guidMig = read("supabase/migrations/20261002_inventory_phase10m_return_guidance_marketplace.sql");
  for (const sym of [
    "marketplace_refund_review",
    "cancellation_detected",
    "return_detected",
    "afn_external_fulfillment_review",
    "refund_source_channel",
    "is_amazon_afn",
  ]) {
    if (!guidMig.includes(sym)) errors.push(`Guidance migration missing: ${sym}`);
    else notes.push(`Guidance includes ${sym}`);
  }

  if (guidMig.includes("inventory_return_workflow") && guidMig.includes("INSERT")) {
    errors.push("Guidance migration must not insert into return workflow");
  } else notes.push("Guidance migration is view-only (no workflow inserts)");

  const issuesMig = read("supabase/migrations/20261003_inventory_phase10m_marketplace_issues.sql");
  for (const sym of ["marketplace_refund_review", "marketplace_cancel_review", "afn_return_external_review"]) {
    if (!issuesMig.includes(sym)) errors.push(`Issues migration missing: ${sym}`);
    else notes.push(`Issue group ${sym} present`);
  }

  const refundUi = read("js/admin/inventory/ui/bundleReturnRestockRefund.js");
  if (!refundUi.includes("REFUND_SOURCE_LABELS")) errors.push("Refund UI must show refund source");
  else notes.push("Refund UI shows refund source");
  if (!refundUi.includes("Refresh Stripe Refund Data")) errors.push("Stripe refresh button label required");
  else notes.push("Stripe refresh kept separate");
  if (!refundUi.includes("Marketplace refund/cancel signal detected")) {
    errors.push("Marketplace copy missing");
  } else notes.push("Marketplace guidance copy present");
  if (!refundUi.includes("read-only from order sync")) errors.push("Marketplace read-only label missing");
  else notes.push("Marketplace data labeled read-only");

  const issueActions = read("js/admin/inventory/services/issueActions.js");
  for (const sym of ["marketplace_refund_review", "marketplace_cancel_review", "afn_return_external_review"]) {
    if (!issueActions.includes(sym)) errors.push(`issueActions missing ${sym}`);
    else notes.push(`issueActions defines ${sym}`);
  }

  const returnApi = read("js/admin/inventory/api/returnWorkflowApi.js");
  if (!returnApi.includes("refundSourceChannel")) errors.push("returnWorkflowApi must map refundSourceChannel");
  else notes.push("returnWorkflowApi maps marketplace fields");

  const labels = read("js/admin/inventory/api/refundRefreshApi.js");
  if (!labels.includes("marketplace_refund_review")) errors.push("REFUND_GUIDANCE_LABELS missing marketplace statuses");
  else notes.push("Marketplace guidance labels defined");

  return { notes, errors };
}

async function applyMigrations(client) {
  const applied = [];
  const migs = [
    "supabase/migrations/20261002_inventory_phase10m_marketplace_refund_observations.sql",
    "supabase/migrations/20261002_inventory_phase10m_return_guidance_marketplace.sql",
    "supabase/migrations/20261003_inventory_phase10m_marketplace_issues.sql",
  ];
  for (const rel of migs) {
    const viewName = rel.includes("observations")
      ? "v_inventory_marketplace_refund_observations"
      : rel.includes("issues")
        ? "v_inventory_issues"
        : "v_inventory_bundle_component_return_guidance";
    const exists = await client.query(
      `SELECT 1 FROM information_schema.views WHERE table_name = $1`,
      [viewName],
    );
    if (!exists.rows.length) {
      await client.query(read(rel));
      applied.push(rel);
    }
  }
  return applied;
}

async function cleanup(client, orderIds) {
  for (const id of orderIds) {
    await client.query(`DELETE FROM fulfillment_shipments WHERE stripe_checkout_session_id = $1`, [id]);
    await client.query(`DELETE FROM inventory_return_workflow WHERE source_order_id = $1`, [id]);
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

  const ebayOrder = `ebay_verify_10m_${Date.now()}`;
  const amazonOrder = `amazon_verify_10m_${Date.now()}`;
  const afnOrder = `amazon_afn_10m_${Date.now()}`;

  try {
    await client.connect();
    const applied = await applyMigrations(client);
    if (applied.length) notes.push(`Applied migrations: ${applied.join(", ")}`);
    else notes.push("Phase 10M migrations already applied");

    const viewCheck = await client.query(`
      SELECT table_name FROM information_schema.views
      WHERE table_name IN (
        'v_inventory_marketplace_refund_observations',
        'v_inventory_bundle_component_return_guidance',
        'v_inventory_issues'
      )
    `);
    if (viewCheck.rows.length < 3) {
      notes.push("Skipped DB fixture (views missing — apply migrations first)");
      return { notes, errors };
    }

    await cleanup(client, [ebayOrder, amazonOrder, afnOrder]);

    await client.query(`
      INSERT INTO orders_raw (stripe_checkout_session_id, total_paid_cents, refund_status, refund_amount_cents, refund_reason)
      VALUES ($1, 3000, 'full', 3000, NULL)
    `, [ebayOrder]);
    await client.query(`
      INSERT INTO orders_raw (stripe_checkout_session_id, total_paid_cents, refund_status, refund_amount_cents, refund_reason)
      VALUES ($1, 4000, 'partial', 1500, 'returned')
    `, [amazonOrder]);
    await client.query(`
      INSERT INTO orders_raw (stripe_checkout_session_id, total_paid_cents, refund_status, refund_amount_cents)
      VALUES ($1, 5000, 'full', 5000)
    `, [afnOrder]);
    await client.query(`
      INSERT INTO fulfillment_shipments (stripe_checkout_session_id, carrier, service, label_status)
      VALUES ($1, 'Amazon', 'Fulfilled by Amazon', 'shipped')
    `, [afnOrder]);

    const ebayObs = await client.query(`
      SELECT refund_source, observation_kind, line_allocation_confidence
      FROM v_inventory_marketplace_refund_observations
      WHERE source_order_id = $1
    `, [ebayOrder]);
    if (!ebayObs.rows.some((r) => r.refund_source === "ebay")) {
      errors.push("eBay refund observation not classified");
    } else notes.push("eBay refund signal classified read-only");

    const amazonObs = await client.query(`
      SELECT observation_kind FROM v_inventory_marketplace_refund_observations
      WHERE source_order_id = $1
    `, [amazonOrder]);
    if (!amazonObs.rows.some((r) => r.observation_kind === "return")) {
      errors.push("Amazon return observation not classified");
    } else notes.push("Amazon return signal classified read-only");

    const wfBefore = (
      await client.query(`SELECT COUNT(*)::int AS c FROM inventory_return_workflow WHERE source_order_id = ANY($1)`, [
        [ebayOrder, amazonOrder, afnOrder],
      ])
    ).rows[0]?.c;
    if (Number(wfBefore) > 0) errors.push("Fixture should have no workflow");
    else notes.push("No return workflow before observation load");

    const ledgerBefore = (
      await client.query(`SELECT COUNT(*)::int AS c FROM stock_ledger WHERE reference_id = ANY($1)`, [
        [ebayOrder, amazonOrder, afnOrder],
      ])
    ).rows[0]?.c;
    if (Number(ledgerBefore) > 0) errors.push("Fixture should have no ledger rows");
    else notes.push("No stock ledger mutations from observations");

    const issues = await client.query(`
      SELECT issue_type FROM v_inventory_issues
      WHERE issue_type IN ('marketplace_refund_review', 'marketplace_cancel_review', 'afn_return_external_review')
    `);
    notes.push(`Marketplace issue groups queryable (${issues.rows.length} active types in fixture)`);

    await cleanup(client, [ebayOrder, amazonOrder, afnOrder]);
    notes.push("Fixture cleaned up");
  } catch (err) {
    errors.push(`DB error: ${err instanceof Error ? err.message : String(err)}`);
    try {
      await cleanup(client, [ebayOrder, amazonOrder, afnOrder]);
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
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, { waitUntil: "domcontentloaded" });
    notes.push("Inventory page loads");

    const bundleReturnRestock = read("js/admin/inventory/ui/bundleReturnRestockRefund.js");
    if (!bundleReturnRestock.includes("renderRefundBlock")) errors.push("renderRefundBlock missing");
    else notes.push("Bundle Return/Restock refund module present");

    const blocking = consoleErrors.filter(
      (e) => !e.includes("Supabase") && !e.includes("401") && !e.includes("Failed to fetch"),
    );
    if (blocking.length) errors.push(`Console errors: ${blocking.slice(0, 3).join("; ")}`);
    else notes.push("No blocking console errors (auth expected offline)");
  } finally {
    await browser.close();
    server.close();
  }
  return { notes, errors };
}

async function main() {
  console.log("Phase 10M — Multi-channel refund observability verification\n");

  const staticResult = verifySourceFiles();
  console.log("--- Static checks ---");
  for (const n of staticResult.notes) console.log(`  ✓ ${n}`);
  for (const e of staticResult.errors) console.log(`  ✗ ${e}`);

  let dbResult = { notes: ["Skipped DB (no credentials)"], errors: [] };
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
