/**
 * Render Parcel Receive Summary card (read-only, Phase 5).
 */

import { esc } from "../utils/formatters.js";
import {
  RECEIVE_STOCK_URL,
  PARCEL_MAPPING_URL,
  VIEW_PARCEL_RECEIVES_URL,
} from "../constants/parcelLinks.js";
import { MOCK_PARCEL_SUMMARY } from "../services/mapParcelSummary.js";

/**
 * @param {number} value
 * @param {{ highlight?: boolean, warn?: boolean }} [opts]
 */
function metricValue(value, opts = {}) {
  const cls = opts.warn
    ? "text-amber-700"
    : opts.highlight
      ? "text-teal-700"
      : "text-gray-900";
  return `<span class="font-black text-lg tabular-nums ${cls}">${value}</span>`;
}

/**
 * @param {import('../services/mapParcelSummary.js').ParcelReceiveSummary} summary
 */
function summaryGrid(summary) {
  return `
    <dl class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <div class="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <dt class="text-[9px] font-black uppercase tracking-[.12em] text-gray-500">Awaiting Mapping</dt>
        <dd class="mt-1">${metricValue(summary.awaitingMapping, { warn: summary.awaitingMapping > 0 })}</dd>
      </div>
      <div class="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <dt class="text-[9px] font-black uppercase tracking-[.12em] text-gray-500">Ready to Receive</dt>
        <dd class="mt-1">${metricValue(summary.readyToReceive, { highlight: summary.readyToReceive > 0 })}</dd>
      </div>
      <div class="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <dt class="text-[9px] font-black uppercase tracking-[.12em] text-gray-500">Recently Received</dt>
        <dd class="mt-1">${metricValue(summary.recentlyReceived)}</dd>
        <dd class="text-[10px] text-gray-400 mt-0.5">Last 30 days</dd>
      </div>
      <div class="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <dt class="text-[9px] font-black uppercase tracking-[.12em] text-gray-500">Last Parcel Receive</dt>
        <dd class="mt-1 text-xs font-bold text-gray-800 leading-snug">${esc(summary.lastParcelReceive)}</dd>
      </div>
      <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 col-span-2 sm:col-span-1">
        <dt class="text-[9px] font-black uppercase tracking-[.12em] text-gray-500">Parcel Ledger Entries</dt>
        <dd class="mt-1">${metricValue(summary.parcelLedgerEntries)}</dd>
      </div>
    </dl>
  `;
}

/** @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} opts */
function statusBanner(opts) {
  const { loading, error, isLive } = opts;
  if (loading) {
    return `<p class="text-xs text-gray-500 mb-3" role="status" aria-live="polite">Loading parcel receive summary…</p>`;
  }
  if (error && !isLive) {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3" role="alert">Live parcel summary unavailable (${esc(error)}). Showing placeholder.</p>`;
  }
  return "";
}

/**
 * @param {HTMLElement|null} mount
 * @param {import('../services/mapParcelSummary.js').ParcelReceiveSummary|null} [summary]
 * @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} [opts]
 */
export function renderParcelSummary(mount, summary, opts = {}) {
  if (!mount) return;

  const { loading = false, error = null, isLive = false } = opts;
  const data = summary ?? MOCK_PARCEL_SUMMARY;

  mount.innerHTML = `
    ${statusBanner({ loading, error, isLive })}
    ${loading ? "" : summaryGrid(data)}
    <div class="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100">
      <a href="${esc(RECEIVE_STOCK_URL)}" class="inline-flex items-center justify-center border-2 border-black bg-black text-white px-3 py-2 text-[10px] font-black uppercase tracking-[.08em] min-h-[40px] hover:bg-gray-900">Receive Stock</a>
      <a href="${esc(PARCEL_MAPPING_URL)}" class="inline-flex items-center justify-center border-2 border-black bg-white text-black px-3 py-2 text-[10px] font-black uppercase tracking-[.08em] min-h-[40px] hover:bg-gray-50">Open Parcel Imports</a>
      <a href="${esc(VIEW_PARCEL_RECEIVES_URL)}" class="inline-flex items-center justify-center border border-gray-300 bg-white text-gray-800 px-3 py-2 text-[10px] font-bold uppercase tracking-[.08em] min-h-[40px] hover:bg-gray-50">View Parcel Receives</a>
    </div>
  `;
}
