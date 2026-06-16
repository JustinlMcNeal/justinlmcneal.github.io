/**
 * Render recent stock ledger (compact, footer left column).
 */

import { LEDGER_ENTRIES } from "../mockData.js";
import { esc } from "../utils/formatters.js";
import { VIEW_PARCEL_RECEIVES_URL } from "../constants/parcelLinks.js";

/** @param {string} change */
function changeBadge(change) {
  const isPositive = String(change).startsWith("+");
  const cls = isPositive ? "text-green-700" : "text-red-600";
  return `<span class="font-mono font-black text-xs ${cls}">${esc(change)}</span>`;
}

/** @param {string} reasonKey @param {string} reasonLabel */
function reasonBadge(reasonKey, reasonLabel) {
  const tones = {
    parcel_receive: "bg-teal-50 text-teal-900 border-teal-200",
    manual_adjustment: "bg-violet-50 text-violet-900 border-violet-200",
    order: "bg-blue-50 text-blue-900 border-blue-200",
    refund: "bg-orange-50 text-orange-900 border-orange-200",
  };
  const cls = tones[reasonKey] || "bg-gray-50 text-gray-800 border-gray-200";
  return `<span class="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[.04em] ${cls}">${esc(reasonLabel)}</span>`;
}

/** @param {{ time: string, product: string, change: string, reason: string, reasonKey?: string, source: string, reference: string }} entry */
function ledgerRow(entry) {
  const reasonKey = entry.reasonKey || "";
  return `
    <tr class="border-b border-gray-100" data-ledger-reason="${esc(reasonKey)}">
      <td class="py-2 pr-2 text-[11px] text-gray-500 whitespace-nowrap align-top">${esc(entry.time)}</td>
      <td class="py-2 pr-2 text-xs font-medium text-gray-900 align-top leading-snug">${esc(entry.product)}</td>
      <td class="py-2 pr-2 align-top">${changeBadge(entry.change)}</td>
      <td class="py-2 pr-2 align-top">${reasonBadge(reasonKey, entry.reason)}</td>
      <td class="py-2 pr-2 text-[11px] text-gray-500 align-top hidden lg:table-cell">${esc(entry.source)}</td>
      <td class="py-2 text-[11px] font-mono text-gray-400 align-top hidden xl:table-cell">${esc(entry.reference)}</td>
    </tr>
  `;
}

/** @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} opts */
function ledgerStatusBanner(opts) {
  const { loading, error, isLive } = opts;
  if (loading) {
    return `<p class="text-xs text-gray-500 mb-2" role="status" aria-live="polite">Loading recent ledger…</p>`;
  }
  if (error && !isLive) {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2" role="alert">Live ledger unavailable (${esc(error)}). Showing placeholder data.</p>`;
  }
  return "";
}

/**
 * @param {typeof LEDGER_ENTRIES} rows
 * @param {'all'|'parcel'} filter
 */
function filterLedgerRows(rows, filter) {
  if (filter !== "parcel") return rows;
  return rows.filter((entry) => entry.reasonKey === "parcel_receive");
}

/**
 * @param {HTMLElement|null} mount
 * @param {typeof LEDGER_ENTRIES} [entries]
 * @param {{ loading?: boolean, error?: string|null, isLive?: boolean, limit?: number, filter?: 'all'|'parcel' }} [opts]
 */
export function renderLedger(mount, entries, opts = {}) {
  if (!mount) return;

  const { loading = false, error = null, isLive = false, limit = 5, filter = "all" } = opts;
  const rows = entries ?? LEDGER_ENTRIES;
  const filtered = loading ? [] : filterLedgerRows(rows, filter);
  const visible = filtered.slice(0, limit);

  const body = loading
    ? `<tr><td colspan="6" class="py-6 text-center text-xs text-gray-400">Loading…</td></tr>`
    : visible.length
      ? visible.map(ledgerRow).join("")
      : `<tr><td colspan="6" class="py-6 text-center text-xs text-gray-400">${filter === "parcel" ? "No parcel receive entries in recent ledger." : "No ledger entries yet."}</td></tr>`;

  const allActive = filter === "all";
  const parcelActive = filter === "parcel";

  mount.innerHTML = `
    ${ledgerStatusBanner({ loading, error, isLive })}
    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Ledger filter">
        <button type="button" data-inventory-ledger-filter="all" class="px-2.5 py-1 text-[10px] font-black uppercase tracking-[.06em] border-2 min-h-[32px] ${allActive ? "border-black bg-black text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}">All</button>
        <button type="button" data-inventory-ledger-filter="parcel" class="px-2.5 py-1 text-[10px] font-black uppercase tracking-[.06em] border-2 min-h-[32px] ${parcelActive ? "border-black bg-black text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}">Parcel Receive</button>
      </div>
      <a href="${esc(VIEW_PARCEL_RECEIVES_URL)}" class="text-[10px] font-bold text-teal-800 hover:underline whitespace-nowrap">View Parcel Receives →</a>
    </div>
    <div class="overflow-x-auto inv-ledger-scroll">
      <table class="w-full border-collapse text-sm min-w-[480px]" ${loading ? 'aria-busy="true"' : ""}>
        <thead>
          <tr class="border-b border-gray-200 text-left">
            <th scope="col" class="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[.1em] text-gray-400">Time</th>
            <th scope="col" class="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[.1em] text-gray-400">Product / Variant</th>
            <th scope="col" class="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[.1em] text-gray-400">Change</th>
            <th scope="col" class="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[.1em] text-gray-400">Reason</th>
            <th scope="col" class="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[.1em] text-gray-400 hidden lg:table-cell">Source</th>
            <th scope="col" class="py-1.5 text-[9px] font-black uppercase tracking-[.1em] text-gray-400 hidden xl:table-cell">Reference</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}
