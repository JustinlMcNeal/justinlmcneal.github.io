/**
 * Render inventory table and summary line (mockup-aligned).
 */

import { esc } from "../utils/formatters.js";
import { INVENTORY_ROWS } from "../mockData.js";

/** @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} opts */
function tableStatusBanner(opts) {
  const { loading, error, isLive } = opts;
  if (loading) {
    return `<p class="text-xs text-gray-500 mb-3" role="status" aria-live="polite">Loading inventory…</p>`;
  }
  if (error && !isLive) {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3" role="alert">Live inventory unavailable (${esc(error)}). Showing placeholder data.</p>`;
  }
  return "";
}

function statusPill(status) {
  const map = {
    healthy: "bg-green-50 text-green-800 border-green-200",
    low: "bg-amber-50 text-amber-800 border-amber-200",
    issue: "bg-red-50 text-red-800 border-red-200",
  };
  const cls = map[status] || map.healthy;
  const label = status === "healthy" ? "Healthy" : status.charAt(0).toUpperCase() + status.slice(1);
  return `<span class="inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase border ${cls}">${label}</span>`;
}

const EBAY_COLUMN_HEADER_TITLE =
  "eBay stock from local cache (Phase 7D). Refresh in Sync Channels — no live eBay API on page load.";

/** @param {import('../services/mapWorkspaceRow.js').InventoryRow} row */
function ebayChannelCell(row) {
  const tooltip = row.ebayStockTooltip || EBAY_COLUMN_HEADER_TITLE;
  const titleAttr = ` title="${esc(tooltip)}"`;

  if (row.ebayStock == null) {
    const canOpenSync =
      row.ebayStockSource === "missing_cache"
      || row.ebayStockSource === "unsupported_variation"
      || row.ebayStockIsStale;
    const syncHint = canOpenSync
      ? `<button type="button" data-inventory-action="open-sync-channels" class="block text-[9px] font-black uppercase text-indigo-700 hover:underline mt-0.5">Sync Channels →</button>`
      : "";
    return `<span class="text-gray-400 font-medium cursor-help inline-flex flex-col items-end"${titleAttr}>—${syncHint}</span>`;
  }

  const diff = row.onHand - row.ebayStock;
  const base = `<span class="font-mono font-bold tabular-nums text-sm">${row.ebayStock}</span>`;
  const staleBadge = row.ebayStockIsStale
    ? `<span class="text-[9px] font-black uppercase text-amber-700 border border-amber-300 rounded px-1 py-0.5 bg-amber-50" title="${esc(tooltip)}">Stale</span>`
    : "";
  const syncLink = row.ebayStockIsStale
    ? `<button type="button" data-inventory-action="open-sync-channels" class="text-[9px] font-black uppercase text-indigo-700 hover:underline">Refresh cache →</button>`
    : "";

  if (diff === 0) {
    return `<div class="text-right flex flex-col items-end gap-0.5 cursor-help"${titleAttr}>${base}${staleBadge}${syncLink}</div>`;
  }
  const sign = diff > 0 ? "+" : "";
  return `
    <div class="flex flex-col items-end gap-0.5 cursor-help"${titleAttr}>
      ${base}
      <span class="text-[10px] font-black text-amber-600 tabular-nums">${sign}${diff}</span>
      ${staleBadge}
      ${syncLink}
    </div>`;
}

function channelCell(channelQty, onHand) {
  if (channelQty == null) {
    return `<span class="text-gray-400 font-medium">—</span>`;
  }
  const diff = onHand - channelQty;
  const base = `<span class="font-mono font-bold tabular-nums text-sm">${channelQty}</span>`;
  if (diff === 0) return `<div class="text-right">${base}</div>`;
  const sign = diff > 0 ? "+" : "";
  return `
    <div class="flex flex-col items-end gap-0.5">
      ${base}
      <span class="text-[10px] font-black text-amber-600 tabular-nums">${sign}${diff}</span>
    </div>
  `;
}

function qtyCell(value, { highlight = false, negative = false } = {}) {
  if (highlight) {
    const cls = value < 0 ? "text-red-600" : "text-green-700";
    return `<span class="font-mono font-black tabular-nums ${cls}">${value}</span>`;
  }
  const cls = negative || value < 0 ? "text-red-600 font-black" : "font-mono font-bold tabular-nums";
  return `<span class="${cls}">${value}</span>`;
}

function productThumb(row) {
  if (row.imageUrl) {
    return `<img src="${esc(row.imageUrl)}" alt="" class="w-10 h-10 rounded-lg object-cover border border-gray-200 shrink-0" loading="lazy" />`;
  }
  return `<div class="w-10 h-10 rounded-lg ${row.thumbClass || "bg-kkpeach/70"} border border-gray-200 shrink-0" aria-hidden="true"></div>`;
}

function productCell(row) {
  return `
    <div class="flex items-start gap-2.5 min-w-[180px] max-w-[240px]">
      ${productThumb(row)}
      <div class="min-w-0">
        <p class="font-bold text-gray-900 text-sm truncate" title="${esc(row.title)}">${esc(row.title)}</p>
        <p class="text-[11px] text-gray-500 truncate">${esc(row.variantDetail || row.variant)}</p>
        <p class="text-[10px] font-mono text-gray-400 mt-0.5">${esc(row.shortSku || row.internalSku)}</p>
      </div>
    </div>
  `;
}

function rowHtml(row) {
  const negative = row.onHand < 0;
  return `
    <tr class="border-b border-gray-100 hover:bg-gray-50/80" data-inventory-id="${esc(row.id)}">
      <td class="py-2.5 px-2 align-top w-8">
        <input type="checkbox" class="w-4 h-4 border-2 border-gray-300 rounded accent-black" aria-label="Select ${esc(row.title)}" data-inventory-row-select />
      </td>
      <td class="py-2.5 px-2 align-top">${productCell(row)}</td>
      <td class="py-2.5 px-2 align-top font-mono text-[11px] text-gray-700 whitespace-nowrap">${esc(row.internalSku)}</td>
      <td class="py-2.5 px-2 align-top text-right">${channelCell(row.kkStock, row.onHand)}</td>
      <td class="py-2.5 px-2 align-top text-right">${ebayChannelCell(row)}</td>
      <td class="py-2.5 px-2 align-top text-right">${channelCell(row.amazonStock, row.onHand)}</td>
      <td class="py-2.5 px-2 align-top text-right">${qtyCell(row.onHand, { negative })}</td>
      <td class="py-2.5 px-2 align-top text-right">${qtyCell(row.reserved)}</td>
      <td class="py-2.5 px-2 align-top text-right">${qtyCell(row.available, { highlight: true, negative: row.available < 0 })}</td>
      <td class="py-2.5 px-2 align-top text-right font-mono text-sm text-gray-600">${row.threshold}</td>
      <td class="py-2.5 px-2 align-top">${statusPill(row.status)}</td>
      <td class="py-2.5 px-2 align-top text-[11px] text-gray-500 whitespace-nowrap">${esc(row.updated)}</td>
      <td class="py-2.5 px-2 align-top text-center">
        <button type="button" data-inventory-action="adjust-stock" data-row-id="${esc(row.id)}" title="Adjust Stock" class="inline-flex items-center justify-center border-2 border-black bg-white text-black px-2 py-1 text-[10px] font-black uppercase tracking-[.06em] hover:bg-gray-50 min-h-[32px] whitespace-nowrap">
          Adjust
        </button>
      </td>
    </tr>
  `;
}

function mobileCard(row) {
  const negative = row.onHand < 0;
  return `
    <article class="inv-mobile-card border border-gray-200 rounded-xl p-3 bg-white" data-inventory-id="${esc(row.id)}">
      <div class="flex items-start gap-2.5 mb-2">
        ${productThumb(row)}
        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <p class="font-black text-gray-900 text-sm truncate">${esc(row.title)}</p>
            ${statusPill(row.status)}
          </div>
          <p class="text-[11px] text-gray-500">${esc(row.variantDetail || row.variant)}</p>
          <p class="text-[10px] font-mono text-gray-400">${esc(row.internalSku)}</p>
        </div>
      </div>
      <dl class="grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs">
        <div><dt class="text-gray-400 text-[9px] font-black uppercase">On Hand</dt><dd class="font-bold ${negative ? "text-red-600" : ""}">${row.onHand}</dd></div>
        <div><dt class="text-gray-400 text-[9px] font-black uppercase">Available</dt><dd class="font-black text-green-700">${row.available}</dd></div>
        <div><dt class="text-gray-400 text-[9px] font-black uppercase">Reserved</dt><dd class="font-bold">${row.reserved}</dd></div>
      </dl>
      <div class="mt-2 pt-2 border-t border-gray-100">
        <button type="button" data-inventory-action="adjust-stock" data-row-id="${esc(row.id)}" class="w-full border-2 border-black bg-white text-black px-3 py-2 text-xs font-black uppercase tracking-[.08em] min-h-[44px] hover:bg-gray-50">Adjust Stock</button>
      </div>
    </article>
  `;
}

/**
 * @param {HTMLElement|null} mount
 * @param {import('../services/mapWorkspaceRow.js').InventoryRow[]} [rows]
 * @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} [opts]
 */
export function renderInventoryTable(mount, rows, opts = {}) {
  if (!mount) return;

  const { loading = false, error = null, isLive = false } = opts;
  const data = loading ? [] : (rows ?? INVENTORY_ROWS);

  const tableBody = loading
    ? `<tr><td colspan="13" class="py-10 px-4 text-center text-sm text-gray-400">Loading inventory…</td></tr>`
    : data.length
      ? data.map(rowHtml).join("")
      : `<tr><td colspan="13" class="py-10 px-4 text-center text-sm text-gray-500">No inventory rows match the current filters.</td></tr>`;

  const mobileCards = loading
    ? `<p class="text-sm text-gray-400 text-center py-8">Loading inventory…</p>`
    : data.length
      ? data.map(mobileCard).join("")
      : `<p class="text-sm text-gray-500 text-center py-8">No inventory rows match the current filters.</p>`;

  mount.innerHTML = `
    ${tableStatusBanner({ loading, error, isLive })}
    <div class="hidden md:block overflow-x-auto inv-table-scroll" ${loading ? 'aria-busy="true"' : ""}>
      <table class="w-full border-collapse text-sm min-w-[1180px]">
        <thead>
          <tr class="border-b-2 border-gray-200 text-left">
            <th scope="col" class="py-2 px-2 w-8"><span class="sr-only">Select</span></th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500">Product</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500">Internal SKU</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500 text-right">KK Stock</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500 text-right cursor-help" title="${esc(EBAY_COLUMN_HEADER_TITLE)}">eBay Stock</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500 text-right">Amazon Stock</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500 text-right">On Hand</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500 text-right">Reserved</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500 text-right">Available</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500 text-right">Threshold</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500">Status</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500">Updated</th>
            <th scope="col" class="py-2 px-2 text-[10px] font-black uppercase tracking-[.12em] text-gray-500"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>${tableBody}</tbody>
      </table>
    </div>
    <div class="md:hidden flex flex-col gap-2 inv-mobile-list">${mobileCards}</div>
  `;
}

/**
 * @param {HTMLElement|null} mount
 * @param {{ tracked: number, lowStock: number, unmapped: number, issues: number }} summary
 */
export function renderTableSummary(mount, summary) {
  if (!mount) return;
  mount.innerHTML = `
    <span class="text-[11px] font-bold text-gray-500 tabular-nums">
      <span class="text-gray-900">${summary.tracked}</span> tracked
      <span class="text-gray-300 mx-1.5">|</span>
      <span class="text-amber-700">${summary.lowStock}</span> low stock
      <span class="text-gray-300 mx-1.5">|</span>
      <span class="text-orange-700">${summary.unmapped}</span> unmapped
      <span class="text-gray-300 mx-1.5">|</span>
      <span class="text-red-600">${summary.issues}</span> issues
    </span>
  `;
}
