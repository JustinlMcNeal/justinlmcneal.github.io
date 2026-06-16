#!/usr/bin/env node
/**
 * Phase 10I — Line Items deep-link focus + return workflow polish verification.
 * Run: node scripts/verify-inventory-phase10i-line-items-deeplink-return-polish.mjs
 */
import { chromium } from "@playwright/test";
import { createServer } from "http";
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INVENTORY_PAGE = "/pages/admin/inventory.html";
const LINE_ITEMS_PAGE = "/pages/admin/lineItemsOrders.html";
const PORT = 9907;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const MAX_LINES = 500;

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

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function verifySourceFiles() {
  const notes = [];
  const errors = [];

  const lineLimitFiles = [
    "js/admin/inventory/constants/orderLinks.js",
    "js/admin/inventory/ui/bundleReturnRestockPanel.js",
    "js/admin/inventory/ui/bundleReturnRestockChecklist.js",
    "js/admin/inventory/ui/shippedFinalizeAuditModal.js",
    "js/admin/inventory/ui/mappingAssistModal.js",
    "js/admin/inventory/ui/issueDetailModal.js",
  ];

  const files = [
    ...lineLimitFiles,
    "js/admin/lineItemsOrders/index.js",
    "js/admin/lineItemsOrders/workspace.js",
    "js/admin/lineItemsOrders/api.js",
    "docs/pages/admin/inventory/implementation/040_phase_10i_line_items_deeplink_return_polish.md",
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

  const orderLinks = read("js/admin/inventory/constants/orderLinks.js");
  if (!orderLinks.includes("buildLineItemsOrdersUrl")) errors.push("buildLineItemsOrdersUrl missing");
  else notes.push("buildLineItemsOrdersUrl present");

  if (!orderLinks.includes("parseLineItemsDeepLinkParams")) errors.push("parseLineItemsDeepLinkParams missing");
  else notes.push("parseLineItemsDeepLinkParams present");

  if (!orderLinks.includes("buildOrderReferenceLabel")) errors.push("buildOrderReferenceLabel missing");
  else notes.push("buildOrderReferenceLabel present");

  if (orderLinks.includes("does not auto-focus")) errors.push("Stale line-focus limitation comment remains");

  const urlFn = read("js/admin/inventory/constants/orderLinks.js");
  if (!urlFn.includes('params.set("session_id"') || !urlFn.includes('params.set("line_id"'))
    errors.push("URL builder missing session_id/line_id params");
  else notes.push("URL builder sets session_id + line_id");

  const indexJs = read("js/admin/lineItemsOrders/index.js");
  if (!indexJs.includes("fetchOrderSummaryRow")) errors.push("Line Items index missing fetchOrderSummaryRow");
  else notes.push("Deep link fetches order when not on loaded page");

  if (!indexJs.includes('urlParams.get("line_id")')) errors.push("Line Items index missing line_id read");
  else notes.push("Line Items reads line_id param");

  if (!indexJs.includes("Order not found for deep link")) errors.push("Missing order-not-found handling");
  else notes.push("Order not-found status message present");

  const workspace = read("js/admin/lineItemsOrders/workspace.js");
  if (!workspace.includes("_highlightLineItem")) errors.push("Workspace highlight missing");
  else notes.push("Workspace line highlight helper present");

  if (!workspace.includes("line could not be found in the loaded items"))
    errors.push("Line not-found banner message missing");
  else notes.push("Line not-found banner present");

  if (!workspace.includes("scrollIntoView")) errors.push("scrollIntoView missing");
  else notes.push("Line scroll-into-view wired");

  const panel = read("js/admin/inventory/ui/bundleReturnRestockPanel.js");
  if (!panel.includes("Open Order Line")) errors.push("Return panel missing Open Order Line");
  else notes.push("Return panel Open Order Line button present");

  if (!panel.includes("data-copy-order-ref")) errors.push("Copy order reference missing");
  else notes.push("Copy order reference wired");

  if (!panel.includes("_selectedReservationId")) errors.push("Selection preserve state missing");
  else notes.push("Candidate selection preserved across refresh");

  if (!panel.includes("Last restock:")) errors.push("Restock result display missing");
  else notes.push("Latest restock result shown after confirm");

  const checklist = read("js/admin/inventory/ui/bundleReturnRestockChecklist.js");
  if (!checklist.includes("data-checklist-dismiss")) errors.push("Checklist dismiss missing");
  else notes.push("Post-restock checklist dismissible");

  const audit = read("js/admin/inventory/ui/shippedFinalizeAuditModal.js");
  if (!audit.includes("buildLineItemsOrdersUrl")) errors.push("Shipped audit missing deep link helper");
  else notes.push("Shipped Finalize Audit uses buildLineItemsOrdersUrl");

  const mapping = read("js/admin/inventory/ui/mappingAssistModal.js");
  if (!mapping.includes("Open Order Line")) errors.push("Mapping Assist missing order line link");
  else notes.push("Mapping Assist order line link present");

  const issueDetail = read("js/admin/inventory/ui/issueDetailModal.js");
  if (!issueDetail.includes("Open order line")) errors.push("Issue detail missing order line link label");
  else notes.push("Issue detail order line links present");

  // Navigation modules must not call restock RPC
  for (const rel of [
    "js/admin/lineItemsOrders/index.js",
    "js/admin/inventory/constants/orderLinks.js",
    "js/admin/inventory/ui/shippedFinalizeAuditModal.js",
    "js/admin/inventory/ui/mappingAssistModal.js",
  ]) {
    const src = read(rel);
    if (src.includes("restock_bundle_component_line") || src.includes("restockBundleComponentLine"))
      errors.push(`${rel} must not invoke restock RPC`);
  }
  notes.push("Navigation modules do not call restock RPC");

  if (panel.includes("restockBundleComponentLine")) notes.push("Restock RPC remains in panel only (10G/10H unchanged path)");

  return { notes, errors };
}

async function verifyPagesLoad() {
  const notes = [];
  const errors = [];
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => errors.push(`Page error: ${err.message}`));

    await page.goto(`http://127.0.0.1:${PORT}${INVENTORY_PAGE}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    notes.push("Inventory page loads");

    await page.goto(`http://127.0.0.1:${PORT}${LINE_ITEMS_PAGE}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    notes.push("Line Items Orders page loads (auth redirect acceptable)");

    const indexSrc = read("js/admin/lineItemsOrders/index.js");
    if (!indexSrc.includes("applyLineItemsDeepLink")) errors.push("applyLineItemsDeepLink missing");
    else notes.push("Line Items deep-link handler present");
  } catch (err) {
    errors.push(`Browser: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
    server.close();
  }

  return { notes, errors };
}

async function main() {
  const src = verifySourceFiles();
  const pages = await verifyPagesLoad();

  const notes = [...src.notes, ...pages.notes];
  const errors = [...src.errors, ...pages.errors];

  console.log("Phase 10I — Line Items deep-link + return polish verification\n");
  for (const n of notes) console.log(`  ✓ ${n}`);
  for (const e of errors) console.log(`  ✗ ${e}`);

  console.log(`\n${errors.length ? "FAIL" : "PASS"} (${notes.length} checks, ${errors.length} errors)`);
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
