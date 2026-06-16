/**
 * Queue KPI strip for Marketplace Restock Assist (Phase 10S).
 */

import { esc } from "../utils/formatters.js";
import { QUEUE_BUCKET_LABELS } from "../api/marketplaceRestockAssistQueueApi.js";

/** @param {ReturnType<import('../api/marketplaceRestockAssistAnalyticsApi.js').mapQueueSummary>} summary */
export function renderQueueKpiStrip(summary) {
  const kpis = [
    { key: "ready_to_restock", value: summary.readyToRestock, cls: "text-emerald-800 border-emerald-400" },
    {
      key: "needs_physical_confirmation",
      value: summary.needsPhysicalConfirmation,
      cls: "text-amber-800 border-amber-400",
    },
    { key: "needs_rma", value: summary.needsRma, cls: "text-violet-800 border-violet-400" },
    { key: "stale_observation", value: summary.staleObservation, cls: "text-orange-800 border-orange-400" },
    { key: "manual_review", value: summary.manualReview, cls: "text-gray-800 border-gray-400" },
    { key: "blocked", value: summary.blocked, cls: "text-red-800 border-red-400" },
    { key: "already_done", value: summary.alreadyDone, cls: "text-gray-500 border-gray-300" },
  ];

  const chips = kpis
    .map(
      (k) => `<span class="inline-flex flex-col border px-2 py-1 rounded ${k.cls}">
        <span class="text-[8px] font-black uppercase">${esc(QUEUE_BUCKET_LABELS[k.key] || k.key)}</span>
        <span class="text-sm font-black tabular-nums">${k.value}</span>
      </span>`,
    )
    .join("");

  const extras = [
    `<span class="text-[9px] text-gray-600">Open: <strong>${summary.totalOpenQueueItems}</strong></span>`,
    summary.snoozed > 0
      ? `<span class="text-[9px] text-indigo-700">Snoozed: <strong>${summary.snoozed}</strong></span>`
      : "",
    summary.oldestStaleObservationAgeHours != null
      ? `<span class="text-[9px] text-amber-700">Oldest stale: <strong>${summary.oldestStaleObservationAgeHours}h</strong></span>`
      : "",
    `<span class="text-[9px] text-gray-600">Restockable qty: <strong>${summary.totalRestockableQty}</strong></span>`,
    summary.estimatedPendingComponentQty > 0
      ? `<span class="text-[9px] text-emerald-700">Pending ready qty: <strong>${summary.estimatedPendingComponentQty}</strong></span>`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `
    <div class="px-4 py-2 border-b border-gray-200 bg-gray-50 space-y-1">
      <div class="flex flex-wrap gap-1.5">${chips}</div>
      <p class="text-[9px]">${extras}</p>
    </div>`;
}
