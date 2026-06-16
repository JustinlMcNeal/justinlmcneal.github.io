/**
 * Returns dashboard CSV / clipboard export (Phase 10V — read-only).
 */

import { showInventoryToast } from "../events.js";
import {
  fetchMarketplaceRestockAudit,
  fetchMarketplaceRestockQueueSummary,
} from "../api/marketplaceRestockAssistAnalyticsApi.js";
import { fetchRestockFollowupCandidates } from "../api/restockFollowupApi.js";
import { fetchAllFilteredWorklistRows } from "../api/returnsRestockDashboardApi.js";

/** @param {unknown} value */
function escapeCsvCell(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** @param {string[]} headers @param {Record<string, unknown>[]} rows @param {string[]} keys */
function buildCsv(headers, rows, keys) {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(keys.map((k) => escapeCsvCell(row[k])).join(","));
  }
  return lines.join("\r\n");
}

function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

const WORKLIST_HEADERS = [
  "source_channel",
  "source_order_id",
  "source_order_item_id",
  "component_sku",
  "component_title",
  "parent_bundle_sku",
  "parent_bundle_title",
  "row_type",
  "status",
  "reason",
  "qty",
  "followup_status",
  "audit_action",
  "event_at",
  "reservation_id",
  "restock_action_id",
];

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>[]} rows */
export function worklistToExportRows(rows) {
  return rows.map((r) => ({
    source_channel: r.sourceChannel ?? "",
    source_order_id: r.sourceOrderId ?? "",
    source_order_item_id: r.sourceOrderItemId ?? "",
    component_sku: r.componentSku ?? "",
    component_title: r.componentTitle ?? "",
    parent_bundle_sku: r.parentBundleSku ?? "",
    parent_bundle_title: r.parentBundleTitle ?? "",
    row_type: r.rowType,
    status: r.status ?? "",
    reason: r.reason ?? "",
    qty: r.suggestedRestockQty ?? r.maxRestockableQty ?? "",
    followup_status: r.rowType === "channel_followup" ? r.status ?? "" : "",
    audit_action: r.rowType === "audit" ? r.status ?? "" : "",
    event_at: r.eventAt ?? "",
    reservation_id: r.reservationId ?? "",
    restock_action_id: r.restockActionId ?? "",
  }));
}

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>[]} rows @param {"copy"|"download"} mode @param {string} [label] */
export async function exportWorklist(rows, mode = "copy", label = "worklist") {
  const data = worklistToExportRows(rows);
  const csv = buildCsv(WORKLIST_HEADERS, data, WORKLIST_HEADERS);
  const suffix = label.includes("page") ? "page" : label.includes("filtered") ? "filtered" : "worklist";
  if (mode === "download") {
    downloadCsv(`returns-dashboard-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    showInventoryToast(`Downloaded ${data.length} row(s) (${label}).`, { variant: "success" });
  } else {
    await copyText(csv);
    showInventoryToast(`Copied ${data.length} row(s) (${label}).`, { variant: "success" });
  }
}

/** @param {"copy"|"download"} mode */
export async function exportAuditHistory(mode = "copy") {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = await fetchMarketplaceRestockAudit({ since, limit: 500 });
  const headers = [
    "created_at",
    "action_type",
    "source_channel",
    "source_order_id",
    "source_order_item_id",
    "component_sku",
    "component_title",
    "parent_bundle_title",
    "qty",
    "previous_status",
    "next_status",
    "note",
    "reservation_id",
  ];
  const data = rows.map((r) => ({
    created_at: r.createdAt,
    action_type: r.actionType,
    source_channel: r.sourceChannel ?? "",
    source_order_id: r.sourceOrderId ?? "",
    source_order_item_id: r.sourceOrderItemId ?? "",
    component_sku: r.componentSku ?? "",
    component_title: r.componentTitle ?? "",
    parent_bundle_title: r.parentBundleTitle ?? "",
    qty: r.qty ?? "",
    previous_status: r.previousStatus ?? "",
    next_status: r.nextStatus ?? "",
    note: r.note ?? "",
    reservation_id: r.reservationId ?? "",
  }));
  const csv = buildCsv(headers, data, headers);
  if (mode === "download") {
    downloadCsv(`restock-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    showInventoryToast(`Downloaded ${data.length} audit row(s).`, { variant: "success" });
  } else {
    await copyText(csv);
    showInventoryToast(`Copied ${data.length} audit row(s).`, { variant: "success" });
  }
}

/** @param {"copy"|"download"} mode */
export async function exportOpenFollowups(mode = "copy") {
  const rows = await fetchRestockFollowupCandidates({ limit: 200 });
  const open = rows.filter((r) =>
    ["needs_channel_review", "needs_amazon_review", "needs_ebay_review"].includes(r.followupStatus),
  );
  const headers = [
    "restock_created_at",
    "source_channel",
    "source_order_id",
    "source_order_item_id",
    "component_sku",
    "component_title",
    "parent_bundle_title",
    "restocked_qty",
    "followup_status",
    "workflow_status",
    "followup_reason",
    "restock_action_id",
  ];
  const data = open.map((r) => ({
    restock_created_at: r.restockCreatedAt,
    source_channel: r.sourceChannel ?? "",
    source_order_id: r.sourceOrderId ?? "",
    source_order_item_id: r.sourceOrderItemId ?? "",
    component_sku: r.componentSku,
    component_title: r.componentTitle,
    parent_bundle_sku: r.parentBundleSku ?? "",
    parent_bundle_title: r.parentBundleTitle ?? "",
    restocked_qty: r.restockedQty,
    followup_status: r.followupStatus,
    workflow_status: r.workflowStatus,
    followup_reason: r.followupReason,
    restock_action_id: r.restockActionId,
  }));
  const csv = buildCsv(headers, data, headers);
  if (mode === "download") {
    downloadCsv(`open-followups-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    showInventoryToast(`Downloaded ${data.length} follow-up row(s).`, { variant: "success" });
  } else {
    await copyText(csv);
    showInventoryToast(`Copied ${data.length} follow-up row(s).`, { variant: "success" });
  }
}

/** @param {"copy"|"download"} mode */
export async function exportQueueSummaryMetrics(mode = "copy") {
  const s = await fetchMarketplaceRestockQueueSummary();
  const headers = ["metric", "value"];
  const data = Object.entries(s).map(([k, v]) => ({ metric: k, value: v ?? "" }));
  const csv = buildCsv(headers, data, headers);
  if (mode === "download") {
    downloadCsv(`restock-queue-summary-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    showInventoryToast("Downloaded queue summary metrics.", { variant: "success" });
  } else {
    await copyText(csv);
    showInventoryToast("Copied queue summary metrics.", { variant: "success" });
  }
}

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapDashboardMetrics>} metrics @param {"copy"|"download"} mode */
export async function exportDashboardMetrics(metrics, mode = "copy") {
  const headers = ["metric", "value"];
  const data = [
    { metric: "restocks_7d", value: metrics.restocks7d },
    { metric: "restocks_30d", value: metrics.restocks30d },
    { metric: "qty_restocked_7d", value: metrics.qtyRestocked7d },
    { metric: "qty_restocked_30d", value: metrics.qtyRestocked30d },
    { metric: "open_followups", value: metrics.openFollowups },
    { metric: "completed_followups", value: metrics.completedFollowups },
    { metric: "avg_hours_restock_to_followup_completion", value: metrics.avgHoursRestockToFollowupCompletion ?? "" },
    { metric: "stale_observation_count", value: metrics.staleObservationCount },
    { metric: "manual_review_count", value: metrics.manualReviewCount },
  ];
  const csv = buildCsv(headers, data, headers);
  if (mode === "download") {
    downloadCsv(`returns-dashboard-metrics-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    showInventoryToast("Downloaded dashboard metrics.", { variant: "success" });
  } else {
    await copyText(csv);
    showInventoryToast("Copied dashboard metrics.", { variant: "success" });
  }
}

/** @param {Object} state @param {"copy"|"download"} mode */
export async function exportFilteredWorklist(state, mode = "download") {
  const rows = await fetchAllFilteredWorklistRows(state);
  await exportWorklist(rows, mode, `filtered (max ${rows.length})`);
}
