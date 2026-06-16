/**
 * Recent channel sync failures snippet (Phase 8A).
 */

import { esc } from "../utils/formatters.js";

/** @param {import('../api/issuesApi.js').SyncFailureRow[]} rows */
export function renderRecentSyncFailuresSection(rows) {
  if (!rows?.length) {
    return `
      <section class="border-2 border-gray-300 rounded-xl p-3 bg-gray-50/80 space-y-1">
        <h3 class="text-xs font-black uppercase tracking-[.1em] text-gray-700">Recent Sync Failures</h3>
        <p class="text-xs text-gray-500">No failed sync results in recent history.</p>
      </section>`;
  }

  const body = rows
    .slice(0, 6)
    .map(
      (r) => `<tr class="border-t border-gray-100 text-xs">
        <td class="py-1.5 px-2 font-black uppercase text-[10px]">${esc(r.channel)}</td>
        <td class="py-1.5 px-2 font-mono">${esc(r.sellerSku)}</td>
        <td class="py-1.5 px-2 text-right">${esc(r.previousQty ?? "—")} → ${esc(r.targetQty ?? "—")}</td>
        <td class="py-1.5 px-2 text-red-700">${esc((r.errorMessage || "failed").slice(0, 80))}</td>
      </tr>`,
    )
    .join("");

  return `
    <section class="border-2 border-red-200 rounded-xl p-3 bg-red-50/30 space-y-2">
      <h3 class="text-xs font-black uppercase tracking-[.1em] text-red-900">Recent Sync Failures</h3>
      <p class="text-[10px] text-red-900/70">Read-only log excerpt — use issue Details for full context.</p>
      <div class="overflow-x-auto border border-red-100 rounded-lg bg-white">
        <table class="w-full text-left min-w-[480px]">
          <thead class="bg-red-50 text-[9px] font-black uppercase text-red-800">
            <tr>
              <th class="py-1.5 px-2">Channel</th>
              <th class="py-1.5 px-2">SKU</th>
              <th class="py-1.5 px-2 text-right">Qty</th>
              <th class="py-1.5 px-2">Error</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>`;
}
