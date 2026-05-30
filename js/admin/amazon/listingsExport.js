import { formatListingMoney } from "./listingProfit.js";
import { priceMismatchSummaryLine } from "./listingPriceMismatch.js";
import { inventoryMismatchSummaryLine } from "./listingInventoryMismatch.js";
import { getHealthExportFields, healthSummaryLine } from "./listingHealth.js";
import { fulfillmentSummaryLine, getFulfillmentExportFields } from "./listingFulfillment.js";

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatPrice(row) {
  const price = row.price;
  if (price === null || price === undefined || price === "") return "";
  const num = Number(price);
  if (!Number.isFinite(num)) return "";
  return num.toFixed(2);
}

function rowInventory(row) {
  const kkStock = Number(row.kk_stock);
  if (Number.isFinite(kkStock) && kkStock >= 0) return kkStock;
  const fbm = Number(row.fbm_quantity);
  if (Number.isFinite(fbm)) return fbm;
  const fba = Number(row.fba_fulfillable_quantity);
  if (Number.isFinite(fba)) return fba;
  return "";
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
export function buildListingsCsv(rows) {
  const headers = [
    "Title",
    "ASIN",
    "Seller SKU",
    "KK SKU",
    "Price",
    "KK Price",
    "Price Compare Status",
    "Price Delta",
    "Price Delta Pct",
    "Has Price Mismatch",
    "Currency",
    "Est Amazon Fees",
    "KK COGS",
    "Est Profit",
    "Profit Status",
    "KK Stock",
    "Amazon Fulfillable Qty",
    "Inventory Compare Status",
    "Inventory Delta",
    "Has Inventory Mismatch",
    "Is FBA Managed",
    "Inventory",
    "Health Status",
    "Open Issue Count",
    "Error Issue Count",
    "Warning Issue Count",
    "Latest Issue Code",
    "Latest Issue Message",
    "Latest Issue Source",
    "Recent Sync Error Count",
    "Latest Sync Error",
    "Fulfillment Mode",
    "Fulfillment Channel",
    "Fulfillment Channel Label",
    "FBM Quantity",
    "FBA Fulfillable",
    "FBA Reserved",
    "FBA Inbound",
    "Has FBA Reserved",
    "Has FBA Inbound",
    "Status",
    "Marketplace",
    "Last Synced",
  ];

  const lines = [headers.join(",")];
  for (const row of rows) {
    const health = getHealthExportFields(row);
    const fulfillment = getFulfillmentExportFields(row);
    lines.push([
      csvCell(row.kk_product_title || row.amazon_title || ""),
      csvCell(row.asin || ""),
      csvCell(row.seller_sku || ""),
      csvCell(row.kk_sku || ""),
      csvCell(formatPrice(row)),
      csvCell(row.kk_price ?? ""),
      csvCell(row.price_compare_status || ""),
      csvCell(row.price_delta ?? ""),
      csvCell(row.price_delta_pct ?? ""),
      csvCell(row.has_price_mismatch === true ? "true" : ""),
      csvCell(row.currency || "USD"),
      csvCell(row.est_amazon_fees ?? ""),
      csvCell(row.kk_cogs ?? ""),
      csvCell(row.est_profit ?? ""),
      csvCell(row.profit_calc_status || ""),
      csvCell(row.kk_stock ?? ""),
      csvCell(row.amazon_fulfillable_qty ?? ""),
      csvCell(row.inventory_compare_status || ""),
      csvCell(row.inventory_delta ?? ""),
      csvCell(row.has_inventory_mismatch === true ? "true" : ""),
      csvCell(row.is_fba_managed === true ? "true" : ""),
      csvCell(rowInventory(row)),
      csvCell(health.healthStatus),
      csvCell(health.openIssueCount),
      csvCell(health.errorIssueCount),
      csvCell(health.warningIssueCount),
      csvCell(health.latestIssueCode),
      csvCell(health.latestIssueMessage),
      csvCell(health.latestIssueSource),
      csvCell(health.recentSyncErrorCount),
      csvCell(health.latestSyncError),
      csvCell(fulfillment.fulfillmentMode),
      csvCell(fulfillment.fulfillmentChannel),
      csvCell(fulfillment.fulfillmentChannelLabel),
      csvCell(fulfillment.fbmQuantity),
      csvCell(fulfillment.fbaFulfillable),
      csvCell(fulfillment.fbaReserved),
      csvCell(fulfillment.fbaInbound),
      csvCell(fulfillment.hasFbaReserved),
      csvCell(fulfillment.hasFbaInbound),
      csvCell(row.listing_status || ""),
      csvCell(row.marketplace_id || ""),
      csvCell(row.last_synced_at || ""),
    ].join(","));
  }

  return lines.join("\n");
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} [filename]
 */
export function downloadListingsCsv(rows, filename) {
  const csv = buildListingsCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || `amazon-listings-${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** @param {string} marketplaceId */
export function amazonProductUrl(marketplaceId, asin) {
  const cleanAsin = String(asin || "").trim();
  if (!cleanAsin) return null;
  const domains = {
    ATVPDKIKX0DER: "www.amazon.com",
    A2EUQ1WTGCTBG2: "www.amazon.ca",
    A1AM78C64UM0Y8: "www.amazon.com.mx",
  };
  const domain = domains[String(marketplaceId || "")] || "www.amazon.com";
  return `https://${domain}/dp/${encodeURIComponent(cleanAsin)}`;
}

/** Plain-text summary for view-details toast */
export function formatListingSummary(row) {
  const title = row.kk_product_title || row.amazon_title || "Untitled";
  const sku = row.seller_sku || row.kk_sku || "—";
  const asin = row.asin || "—";
  const status = row.listing_status || "—";
  const profitLine = String(row.profit_calc_status) === "complete"
    ? ` · Est. profit ${formatListingMoney(row.est_profit, row.currency)}`
    : "";
  const mismatchLine = priceMismatchSummaryLine(row);
  const inventoryLine = inventoryMismatchSummaryLine(row);
  const healthLine = healthSummaryLine(row);
  const fulfillmentLine = fulfillmentSummaryLine(row);
  return `${title} · SKU ${sku} · ASIN ${asin} · ${status}${profitLine}${mismatchLine}${inventoryLine}${healthLine}${fulfillmentLine}`;
}
