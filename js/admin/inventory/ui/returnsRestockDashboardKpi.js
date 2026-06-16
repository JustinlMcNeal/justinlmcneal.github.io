/**
 * Returns & Restock Dashboard KPI strip (Phase 10U).
 */

import { esc } from "../utils/formatters.js";

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapDashboardSummary>} summary
 *  @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapDashboardMetrics>|null} [metrics] */
export function renderDashboardKpiStrip(summary, metrics = null) {
  const chips = [
    { label: "Open Returns", value: summary.openReturnWorkflows, cls: "text-violet-800 border-violet-400" },
    { label: "Received Not Restocked", value: summary.receivedNotRestocked, cls: "text-amber-800 border-amber-400" },
    { label: "Ready to Restock", value: summary.readyToRestock, cls: "text-emerald-800 border-emerald-400" },
    { label: "Stale Obs", value: summary.staleObservations, cls: "text-orange-800 border-orange-400" },
    { label: "Channel Follow-Ups", value: summary.openChannelFollowups, cls: "text-indigo-800 border-indigo-400" },
    { label: "Blocked / Manual", value: summary.blockedManualReview, cls: "text-gray-800 border-gray-400" },
    { label: "Recent Restocks (7d)", value: summary.recentRestocksCount, cls: "text-teal-800 border-teal-400" },
  ];

  const metricsLine = metrics
    ? `<p class="text-[9px] text-gray-600 pt-1">
        Metrics: restocks 7d/30d <strong>${metrics.restocks7d}/${metrics.restocks30d}</strong>
        · qty <strong>${metrics.qtyRestocked7d}/${metrics.qtyRestocked30d}</strong>
        · follow-ups open/done <strong>${metrics.openFollowups}/${metrics.completedFollowups}</strong>
        ${metrics.avgHoursRestockToFollowupCompletion != null ? `· avg follow-up <strong>${metrics.avgHoursRestockToFollowupCompletion}h</strong>` : ""}
      </p>`
    : "";

  return `
    <div class="px-4 py-2 border-b border-gray-200 bg-slate-50 space-y-1">
      <div class="flex flex-wrap gap-1.5">
        ${chips
          .map(
            (c) => `<span class="inline-flex flex-col border px-2 py-1 rounded ${c.cls}">
              <span class="text-[8px] font-black uppercase">${esc(c.label)}</span>
              <span class="text-sm font-black tabular-nums">${c.value}</span>
            </span>`,
          )
          .join("")}
      </div>
      <p class="text-[9px] text-gray-600">
        Attention items: <strong>${summary.dashboardAttentionCount}</strong>
        · Recent restocked qty (7d): <strong>${summary.recentRestockedQty}</strong>
        · Sync review suggested: <strong>${summary.syncNeededAfterRestock}</strong>
      </p>
      ${metricsLine}
    </div>`;
}
