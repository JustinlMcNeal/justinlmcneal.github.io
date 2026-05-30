import { qs } from "./dom.js";
import { applyAmazonTableSettings } from "./tableSettings.js";
import {
  feeColumnMarkup,
  profitColumnMarkup,
} from "./listingProfit.js";
import {
  fbaInboundColumnMarkup,
  fbaReservedColumnMarkup,
  fulfillmentColumnMarkup,
} from "./listingFulfillment.js";
import {
  getHealthRowClass,
  renderHealthCell,
} from "./listingHealth.js";
import {
  inventoryColumnMarkup,
  inventoryRowHighlightClass,
} from "./listingInventoryMismatch.js";
import {
  priceColumnMarkup,
  priceRowHighlightClass,
} from "./listingPriceMismatch.js";

const STATUS_BADGES = {
  active: { label: "Active", className: "bg-green-100 text-green-800" },
  low_stock: { label: "Low Stock", className: "bg-amber-100 text-amber-800" },
  out_of_stock: { label: "Out of Stock", className: "bg-gray-200 text-gray-700" },
  draft: { label: "Draft", className: "bg-blue-100 text-blue-800" },
  issue: { label: "Issue", className: "bg-red-100 text-red-800" },
  suppressed: { label: "Suppressed", className: "bg-red-100 text-red-800" },
  inactive: { label: "Inactive", className: "bg-gray-200 text-gray-700" },
  unknown: { label: "Unknown", className: "bg-gray-100 text-gray-700" },
};

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {Record<string, unknown>} row */
function rowTitle(row) {
  return String(row.kk_product_title || row.amazon_title || "Untitled Amazon Listing");
}

/** @param {Record<string, unknown>} row */
function rowSku(row) {
  return String(row.kk_sku || row.seller_sku || "—");
}

/** @param {Record<string, unknown>} row */
function rowInventory(row) {
  const kkStock = Number(row.kk_stock);
  if (Number.isFinite(kkStock) && kkStock >= 0) return kkStock;
  const fbm = Number(row.fbm_quantity);
  if (Number.isFinite(fbm)) return fbm;
  const fba = Number(row.fba_fulfillable_quantity);
  if (Number.isFinite(fba)) return fba;
  return null;
}

/** @param {unknown} value */
function formatSyncedDate(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** @param {Record<string, unknown>} row */
function listingRowHighlightClass(row) {
  return [
    getHealthRowClass(row),
    priceRowHighlightClass(row),
    inventoryRowHighlightClass(row),
  ].filter(Boolean).join(" ");
}

/** @param {Record<string, unknown>} row */
function mobileCardBorderClass(row) {
  const health = String(row.listing_health_status || "");
  if (health === "error" || health === "suppressed") {
    return "border-red-300 bg-red-50/30";
  }
  if (health === "warning" || health === "sync_error") {
    return "border-amber-300 bg-amber-50/25";
  }
  if (health === "unknown") return "border-gray-300 bg-gray-50/40";
  if (row.has_price_mismatch === true) return "border-amber-300 bg-amber-50/30";
  if (row.has_inventory_mismatch === true) return "border-violet-300 bg-violet-50/30";
  return "border-gray-200";
}

/** @param {string} status */
function statusBadge(status) {
  return STATUS_BADGES[status] || STATUS_BADGES.unknown;
}

/** @param {Record<string, unknown>} row */
function healthMarkup(row) {
  return renderHealthCell(row, escapeHtml);
}

/** @param {Record<string, unknown>} row */
function fulfillmentMarkup(row) {
  return fulfillmentColumnMarkup(row, escapeHtml);
}

/** @param {Record<string, unknown>} row */
function inventoryMarkup(row) {
  return inventoryColumnMarkup(row, escapeHtml);
}

/** @param {Record<string, unknown>} row */
function staleBadgeMarkup(row) {
  if (row.is_stale !== true) return "";
  return '<span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-orange-100 text-orange-800 ml-1" title="Last synced more than 24 hours ago">Stale</span>';
}

/**
 * @param {Record<string, unknown>} row
 */
export function buildListingTableRow(row) {
  const id = String(row.amazon_listing_id || "");
  const status = String(row.listing_status || "unknown");
  const badge = statusBadge(status);
  const title = escapeHtml(rowTitle(row));
  const subtitle = escapeHtml(row.product_type || row.fulfillment_channel || "Amazon listing");
  const asin = escapeHtml(row.asin || "—");
  const sku = escapeHtml(rowSku(row));
  const price = priceColumnMarkup(row, escapeHtml);
  const fulfillment = fulfillmentMarkup(row);
  const synced = escapeHtml(formatSyncedDate(row.last_synced_at));
  const rowHighlight = listingRowHighlightClass(row);
  const health = healthMarkup(row);

  return `
    <tr class="amazon-listing-row border-b border-gray-100 hover:bg-gray-50 transition-colors ${rowHighlight}" data-listing-id="${escapeHtml(id)}" data-status="${escapeHtml(status)}" data-asin="${asin}" data-sku="${sku}" data-price-mismatch="${row.has_price_mismatch === true ? "true" : "false"}" data-inventory-mismatch="${row.has_inventory_mismatch === true ? "true" : "false"}" data-health-status="${escapeHtml(String(row.listing_health_status || "unknown"))}">
      <td class="px-2 py-2.5 w-10" data-amazon-col="select">
        <input type="checkbox" data-action="select-listing" data-listing-id="${escapeHtml(id)}" aria-label="Select ${title}" class="w-4 h-4 border-2 border-black rounded-sm" />
      </td>
      <td class="px-4 py-2.5" data-amazon-col="product">
        <div class="flex items-center gap-3">
          <div class="amazon-listing-product-thumb w-11 h-11 rounded-lg bg-kkpeach/60 border border-gray-200 flex-shrink-0" aria-hidden="true"></div>
          <div>
            <p class="font-bold text-sm leading-tight">${title}</p>
            <p class="text-[11px] text-gray-400 mt-0.5">${subtitle}</p>
          </div>
        </div>
      </td>
      <td class="px-4 py-2.5 font-mono text-xs text-gray-600" data-amazon-col="asin">${asin}</td>
      <td class="px-4 py-2.5 font-mono text-xs text-gray-600" data-amazon-col="sku">${sku}</td>
      <td class="px-4 py-2.5 text-right" data-amazon-col="price">${price}</td>
      <td class="px-4 py-2.5 text-right hidden xl:table-cell" data-amazon-col="amazonFee">${feeColumnMarkup(row)}</td>
      <td class="px-4 py-2.5 text-right" data-amazon-col="profit">${profitColumnMarkup(row)}</td>
      <td class="px-4 py-2.5 text-center hidden xl:table-cell" data-amazon-col="fulfillment">${fulfillment}</td>
      <td class="px-4 py-2.5 text-center" data-amazon-col="inventory">${inventoryMarkup(row)}</td>
      <td class="px-4 py-2.5 text-center hidden 2xl:table-cell" data-amazon-col="fbaReserved">${fbaReservedColumnMarkup(row, escapeHtml)}</td>
      <td class="px-4 py-2.5 text-center hidden 2xl:table-cell" data-amazon-col="fbaInbound">${fbaInboundColumnMarkup(row, escapeHtml)}</td>
      <td class="px-4 py-2.5 text-center" data-amazon-col="status">
        <div class="flex flex-col items-center gap-1">
          <span class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide ${badge.className}">${escapeHtml(badge.label)}</span>
          ${health}
        </div>
      </td>
      <td class="px-4 py-2.5 text-xs text-gray-500 hidden xl:table-cell" data-amazon-col="lastSynced">${synced}${staleBadgeMarkup(row)}</td>
      <td class="px-4 py-2.5 text-right" data-amazon-col="actions">
        <button type="button" data-action="row-menu" data-listing-id="${escapeHtml(id)}" data-status="${escapeHtml(status)}" data-asin="${escapeHtml(String(row.asin || ""))}" data-seller-sku="${escapeHtml(String(row.seller_sku || row.kk_sku || ""))}" data-marketplace-id="${escapeHtml(String(row.marketplace_id || ""))}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${title}" title="Open row actions menu" class="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded border-2 border-black bg-white text-[10px] font-black uppercase tracking-wide text-gray-700 hover:bg-gray-50 min-h-[36px] whitespace-nowrap">Actions <span aria-hidden="true">▾</span></button>
      </td>
    </tr>
  `;
}

/**
 * @param {Record<string, unknown>} row
 */
export function buildListingMobileCard(row) {
  const id = String(row.amazon_listing_id || "");
  const status = String(row.listing_status || "unknown");
  const badge = statusBadge(status);
  const title = escapeHtml(rowTitle(row));
  const subtitle = escapeHtml(row.product_type || row.fulfillment_channel || "Amazon listing");
  const asin = escapeHtml(row.asin || "—");
  const sku = escapeHtml(rowSku(row));
  const price = priceColumnMarkup(row, escapeHtml);
  const fulfillment = fulfillmentMarkup(row);
  const synced = escapeHtml(formatSyncedDate(row.last_synced_at));
  const inventory = inventoryMarkup(row);
  const health = healthMarkup(row);
  const cardBorder = mobileCardBorderClass(row);

  return `
    <article class="amazon-mobile-card bg-white rounded-xl border p-4 shadow-sm active:bg-gray-50 ${cardBorder}" data-listing-id="${escapeHtml(id)}" data-status="${escapeHtml(status)}" data-asin="${asin}" data-sku="${sku}" data-price-mismatch="${row.has_price_mismatch === true ? "true" : "false"}" data-inventory-mismatch="${row.has_inventory_mismatch === true ? "true" : "false"}" data-health-status="${escapeHtml(String(row.listing_health_status || "unknown"))}">
      <div class="flex items-center gap-2 mb-2">
        <input type="checkbox" data-action="select-listing" data-listing-id="${escapeHtml(id)}" aria-label="Select ${title}" class="w-4 h-4 border-2 border-black rounded-sm shrink-0" />
        <span class="text-[10px] font-black uppercase tracking-wide text-gray-500">Select for bulk update</span>
      </div>
      <div class="flex gap-3">
        <div class="w-14 h-14 rounded-lg bg-kkpeach/60 border border-gray-200 flex-shrink-0" aria-hidden="true"></div>
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-bold text-sm leading-tight">${title}</h3>
            <span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${badge.className} flex-shrink-0">${escapeHtml(badge.label)}</span>
          </div>
          <p class="text-[11px] text-gray-400 mt-0.5">${subtitle}</p>
          <dl class="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-xs">
            <div data-amazon-mobile-col="asin"><dt class="text-gray-400">ASIN</dt><dd class="font-mono font-medium">${asin}</dd></div>
            <div data-amazon-mobile-col="sku"><dt class="text-gray-400">SKU</dt><dd class="font-mono font-medium">${sku}</dd></div>
            <div data-amazon-mobile-col="price"><dt class="text-gray-400">Price</dt><dd>${price}</dd></div>
            <div data-amazon-mobile-col="fulfillment"><dt class="text-gray-400">Fulfillment</dt><dd>${fulfillment}</dd></div>
            <div data-amazon-mobile-col="inventory"><dt class="text-gray-400">Inventory</dt><dd>${inventory}</dd></div>
            <div data-amazon-mobile-col="amazonFee"><dt class="text-gray-400">Amazon Fee</dt><dd>${feeColumnMarkup(row)}</dd></div>
            <div data-amazon-mobile-col="profit"><dt class="text-gray-400">Est. Profit</dt><dd>${profitColumnMarkup(row)}</dd></div>
            <div data-amazon-mobile-col="lastSynced"><dt class="text-gray-400">Synced</dt><dd class="text-gray-600">${synced}${staleBadgeMarkup(row)}</dd></div>
            <div class="col-span-2" data-amazon-mobile-col="status"><dt class="text-gray-400">Health</dt><dd>${health}</dd></div>
          </dl>
        </div>
      </div>
      <button type="button" data-action="row-menu" data-listing-id="${escapeHtml(id)}" data-status="${escapeHtml(status)}" data-asin="${escapeHtml(String(row.asin || ""))}" data-seller-sku="${escapeHtml(String(row.seller_sku || row.kk_sku || ""))}" data-marketplace-id="${escapeHtml(String(row.marketplace_id || ""))}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${title}" title="Open row actions menu" class="mt-3 w-full inline-flex items-center justify-center gap-1 border-2 border-black bg-white py-2.5 text-xs font-black uppercase tracking-[.12em] text-gray-700 hover:bg-gray-50 min-h-[44px]">Actions <span aria-hidden="true">▾</span></button>
    </article>
  `;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ afterRender?: () => void }} [options]
 */
export function renderLiveListings(rows, options = {}) {
  const tbody = qs("#amazonListingsBody");
  const mobile = qs("#amazonMobileCards");
  if (!tbody || !mobile) return;

  const htmlRows = rows.map((row) => buildListingTableRow(row)).join("");
  const htmlCards = rows.map((row) => buildListingMobileCard(row)).join("");

  tbody.innerHTML = htmlRows;
  mobile.innerHTML = '<h2 class="sr-only">Listing cards</h2>' + htmlCards;
  applyAmazonTableSettings();
  options.afterRender?.();
}

/**
 * @param {number | { total?: number, filteredTotal?: number, staleCount?: number, priceMismatchCount?: number, inventoryMismatchCount?: number, listingHealthIssueCount?: number, page?: ReturnType<typeof import("./listingsQuery.js").paginateListings> }} arg
 */
export function updateListingsCounts(arg) {
  const total = typeof arg === "number" ? arg : Number(arg.total || 0);
  const filteredTotal = typeof arg === "number"
    ? arg
    : Number(arg.filteredTotal ?? arg.page?.total ?? total);
  const staleCount = typeof arg === "object" ? Number(arg.staleCount || 0) : 0;
  const priceMismatchCount = typeof arg === "object" ? Number(arg.priceMismatchCount || 0) : 0;
  const inventoryMismatchCount = typeof arg === "object" ? Number(arg.inventoryMismatchCount || 0) : 0;
  const listingHealthIssueCount = typeof arg === "object" ? Number(arg.listingHealthIssueCount || 0) : 0;
  const page = typeof arg === "object" && arg.page ? arg.page : null;

  const tableLabel = qs("#amazonTableCountLabel");
  if (tableLabel) {
    if (total === 0) {
      tableLabel.textContent = "0 synced · live";
    } else if (filteredTotal !== total) {
      tableLabel.textContent = `${filteredTotal} shown · ${total} synced · live`;
    } else {
      tableLabel.textContent = `${total} synced · live`;
    }
  }

  const staleLabel = qs("#amazonStaleCountLabel");
  if (staleLabel) {
    if (staleCount > 0) {
      staleLabel.textContent = `${staleCount} stale`;
      staleLabel.classList.remove("hidden");
    } else {
      staleLabel.textContent = "";
      staleLabel.classList.add("hidden");
    }
  }

  const mismatchLabel = qs("#amazonPriceMismatchCountLabel");
  if (mismatchLabel) {
    if (priceMismatchCount > 0) {
      mismatchLabel.textContent = `${priceMismatchCount} price mismatch`;
      mismatchLabel.classList.remove("hidden");
    } else {
      mismatchLabel.textContent = "";
      mismatchLabel.classList.add("hidden");
    }
  }

  const inventoryMismatchLabel = qs("#amazonInventoryMismatchCountLabel");
  if (inventoryMismatchLabel) {
    if (inventoryMismatchCount > 0) {
      inventoryMismatchLabel.textContent = `${inventoryMismatchCount} stock mismatch`;
      inventoryMismatchLabel.classList.remove("hidden");
    } else {
      inventoryMismatchLabel.textContent = "";
      inventoryMismatchLabel.classList.add("hidden");
    }
  }

  const healthIssueLabel = qs("#amazonListingHealthCountLabel");
  if (healthIssueLabel) {
    healthIssueLabel.textContent = `${listingHealthIssueCount} health issue${listingHealthIssueCount === 1 ? "" : "s"}`;
    healthIssueLabel.classList.remove("hidden");
  }

  const tabCount = qs("#amazonTabSynced [data-count]");
  if (tabCount) {
    tabCount.textContent = String(total);
    tabCount.setAttribute("data-count", String(total));
  }

  const pagination = qs("#amazonPaginationSummary");
  if (pagination) {
    if (!page || page.total <= 0) {
      pagination.textContent = "Showing 0 results";
      return;
    }
    pagination.innerHTML =
      `Showing <span class="font-bold text-black">${page.startIndex}</span> to <span class="font-bold text-black">${page.endIndex}</span> of <span class="font-bold text-black">${page.total}</span> results`;
  }
}

/**
 * @param {{ total: number, totalPages: number, page: number, startIndex: number, endIndex: number }} pageResult
 */
export function updatePaginationControls(pageResult) {
  const prevBtn = qs("#listings-prev-page");
  const nextBtn = qs("#listings-next-page");
  const pageLabel = qs("#amazonPaginationPageLabel");

  const atStart = pageResult.page <= 1 || pageResult.total === 0;
  const atEnd = pageResult.page >= pageResult.totalPages || pageResult.total === 0;

  if (prevBtn instanceof HTMLButtonElement) {
    prevBtn.disabled = atStart;
    prevBtn.setAttribute("aria-disabled", atStart ? "true" : "false");
    prevBtn.classList.toggle("opacity-40", atStart);
    prevBtn.classList.toggle("cursor-not-allowed", atStart);
  }

  if (nextBtn instanceof HTMLButtonElement) {
    nextBtn.disabled = atEnd;
    nextBtn.setAttribute("aria-disabled", atEnd ? "true" : "false");
    nextBtn.classList.toggle("opacity-40", atEnd);
    nextBtn.classList.toggle("cursor-not-allowed", atEnd);
  }

  if (pageLabel) {
    if (pageResult.total === 0) {
      pageLabel.textContent = "Page 0 of 0";
    } else {
      pageLabel.textContent = `Page ${pageResult.page} of ${pageResult.totalPages}`;
    }
  }
}

/** @param {{ total: number, active: number, lowStock: number, issues: number }} stats */
export function updateStatsCards(stats) {
  const map = {
    total: stats.total,
    active: stats.active,
    "low-stock": stats.lowStock,
    issues: stats.issues,
  };

  for (const [key, value] of Object.entries(map)) {
    const card = document.querySelector(`#amazonStats [data-stat="${key}"] [data-value]`);
    if (card) card.textContent = String(value);
  }
}
