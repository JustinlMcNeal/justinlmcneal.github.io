/** KK warehouse vs Amazon fulfillable qty helpers (Phase 5D). FBM comparable rows only. */

import { fbaInventoryColumnMarkup } from "./listingFulfillment.js";

/** @param {unknown} value */
function asInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

/** @param {Record<string, unknown>} row */
export function isFbaManaged(row) {
  return row.is_fba_managed === true;
}

/** @param {Record<string, unknown>} row */
export function hasInventoryMismatch(row) {
  return row.has_inventory_mismatch === true;
}

/** @param {Array<Record<string, unknown>>} rows */
export function countInventoryMismatches(rows) {
  return rows.filter((row) => hasInventoryMismatch(row)).length;
}

/** @param {Record<string, unknown>} row */
export function inventoryCompareStatus(row) {
  return String(row.inventory_compare_status || "");
}

/** @param {Record<string, unknown>} row */
export function inventoryRowHighlightClass(row) {
  const status = inventoryCompareStatus(row);
  if (status === "amazon_higher") {
    return "amazon-row-inventory-mismatch amazon-row-inventory-amazon-higher";
  }
  if (status === "amazon_lower") {
    return "amazon-row-inventory-mismatch amazon-row-inventory-amazon-lower";
  }
  return "";
}

/** @param {Record<string, unknown>} row @param {typeof import("./renderListings.js").escapeHtml} escapeHtml */
export function inventoryColumnMarkup(row, escapeHtml) {
  const status = inventoryCompareStatus(row);
  const amazonQty = asInt(row.amazon_fulfillable_qty);
  const kkStock = asInt(row.kk_stock);
  const listingStatus = String(row.listing_status || "");
  const low = listingStatus === "low_stock" || (amazonQty !== null && amazonQty <= 5);

  if (status === "fba_managed") {
    return fbaInventoryColumnMarkup(row, escapeHtml);
  }

  if (status === "unmapped" || status === "missing_amazon_qty" || amazonQty === null) {
    const fallback = amazonQty ?? kkStock;
    if (fallback === null) {
      return '<span class="font-bold">—</span><span class="text-[10px] text-gray-400 block">units</span>';
    }
    const hint = status === "missing_amazon_qty" ? "No Amazon qty" : "units";
    return `<span class="font-bold">${escapeHtml(fallback)}</span><span class="text-[10px] text-gray-400 block">${hint}</span>`;
  }

  if (status === "match") {
    const qtyClass = low ? "font-bold text-amber-600" : "font-bold";
    const hint = low ? "low · matches KK" : "matches KK";
    const hintClass = low ? "text-[10px] text-amber-500 block" : "text-[10px] text-green-600 block";
    return `<span class="${qtyClass}">${escapeHtml(amazonQty)}</span><span class="${hintClass}">${hint}</span>`;
  }

  const delta = asInt(row.inventory_delta);
  const deltaText = delta === null ? "" : ` (${delta > 0 ? "+" : ""}${delta})`;
  const tone = status === "amazon_higher" ? "text-amber-700" : "text-violet-700";
  const label = status === "amazon_higher" ? "Amazon higher" : "Amazon lower";
  const badgeClass = status === "amazon_higher"
    ? "bg-amber-100 text-amber-800"
    : "bg-violet-100 text-violet-800";

  return `
    <span class="font-bold ${tone}">${escapeHtml(amazonQty)}</span>
    <span class="text-[10px] text-gray-500 block">KK ${escapeHtml(kkStock ?? 0)}</span>
    <span class="inline-flex mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${badgeClass}">${label}${escapeHtml(deltaText)}</span>
  `;
}

/** @param {Record<string, unknown>} row */
export function inventoryMismatchSummaryLine(row) {
  if (!hasInventoryMismatch(row)) return "";
  const delta = asInt(row.inventory_delta);
  if (delta === null) return " · Stock mismatch";
  const dir = delta > 0 ? "Amazon higher" : "Amazon lower";
  return ` · ${dir} by ${Math.abs(delta)} units`;
}
