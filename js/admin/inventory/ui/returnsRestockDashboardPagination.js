/**
 * Returns dashboard pagination UI helpers (Phase 10X).
 */

import { esc } from "../utils/formatters.js";

export const PAGE_SIZE_OPTIONS = [50, 100, 250];

/** @param {{ totalCount: number; offset: number; limit: number; hasMore: boolean; prevOffset: number|null; nextOffset: number|null; bucketCounts?: Record<string, unknown>|null }} page */
export function formatPageRange(page) {
  if (!page.totalCount) return "0 rows";
  const start = page.offset + 1;
  const end = Math.min(page.offset + page.limit, page.totalCount);
  return `${start}–${end} of ${page.totalCount}`;
}

/** @param {Record<string, number>} bucketCounts @param {string} tab */
export function tabCountLabel(tab, bucketCounts) {
  if (!bucketCounts) return "";
  const map = {
    worklist: bucketCounts.tab_worklist,
    ready: bucketCounts.tab_ready,
    returns: bucketCounts.tab_returns,
    followup: bucketCounts.tab_followup,
    audit: bucketCounts.tab_audit,
  };
  const n = map[tab];
  return n == null ? "" : ` (${n})`;
}

/**
 * @param {{ totalCount: number; offset: number; limit: number; hasMore: boolean; prevOffset: number|null; nextOffset: number|null }} page
 * @param {number} pageSize
 */
export function renderPaginationBar(page, pageSize) {
  return `
    <div class="px-4 py-2 border-t border-gray-200 flex flex-wrap items-center gap-2 bg-slate-50" data-rrd-pagination>
      <span class="text-[9px] text-gray-600 font-mono">${esc(formatPageRange(page))}</span>
      <label class="text-[9px] font-black uppercase text-gray-500 ml-2">Page size
        <select data-rrd-page-size class="border rounded text-[11px] ml-1">
          ${PAGE_SIZE_OPTIONS.map(
            (n) => `<option value="${n}" ${pageSize === n ? "selected" : ""}>${n}</option>`,
          ).join("")}
        </select>
      </label>
      <button type="button" data-rrd-prev class="text-[9px] font-black uppercase border px-2 py-0.5 rounded ${page.prevOffset == null ? "opacity-40 cursor-not-allowed" : "hover:bg-white"}" ${page.prevOffset == null ? "disabled" : ""}>Previous</button>
      <button type="button" data-rrd-next class="text-[9px] font-black uppercase border px-2 py-0.5 rounded ${!page.hasMore ? "opacity-40 cursor-not-allowed" : "hover:bg-white"}" ${!page.hasMore ? "disabled" : ""}>Next</button>
      <button type="button" data-rrd-load-target class="text-[9px] font-black uppercase text-amber-900 border border-amber-400 px-2 py-0.5 rounded hidden">Load Target Row</button>
    </div>`;
}
