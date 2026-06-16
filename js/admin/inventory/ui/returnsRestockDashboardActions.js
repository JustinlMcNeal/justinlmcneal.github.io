/**
 * Dashboard row action routing (Phase 10U — reuses existing handlers only).
 */

import { buildLineItemsOrdersUrl, channelFromOrderId } from "../constants/orderLinks.js";
import { openSyncDryRunModal } from "./syncDryRunModal.js";
import { openBundlePreviewModal } from "./bundlePreviewModal.js";
import { openMarketplaceRestockAssistQueueModal } from "./marketplaceRestockAssistQueueModal.js";
import { openRestockFollowupChecklistModal } from "./restockFollowupChecklist.js";
import { upsertMarketplaceRestockQueueState } from "../api/marketplaceRestockAssistAnalyticsApi.js";
import { logMarketplaceRestockAssistAction } from "../api/marketplaceRestockAssistQueueApi.js";
import { showInventoryToast } from "../events.js";

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>} row */
export function openOrderLine(row) {
  if (!row.sourceOrderId) return;
  window.open(
    buildLineItemsOrdersUrl({
      sessionId: row.sourceOrderId,
      lineId: row.sourceOrderItemId || undefined,
      channel: channelFromOrderId(row.sourceOrderId) || row.sourceChannel || undefined,
      tab: "overview",
    }),
    "_blank",
    "noopener",
  );
}

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>} row */
export function openBundleReturns(row) {
  openBundlePreviewModal({
    focusBundleVariantId: row.parentBundleVariantId ?? null,
    focusReturnsSection: true,
  });
}

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>} row */
export function openRestockQueueForRow(row) {
  const bucket =
    row.status === "ready_to_restock"
      ? "ready_to_restock"
      : row.isObservationStale
        ? "stale_observation"
        : row.status === "needs_physical_confirmation"
          ? "needs_physical_confirmation"
          : row.status === "needs_rma"
            ? "needs_rma"
            : "manual_review";
  void openMarketplaceRestockAssistQueueModal({ initialBucket: bucket });
}

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>} row */
export async function openFollowUpForRow(row) {
  if (row.restockActionId) await openRestockFollowupChecklistModal(row.restockActionId);
  else showInventoryToast("No follow-up record for this row.", { variant: "info" });
}

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>} row */
export function openSyncPreviewForRow(row) {
  void openSyncDryRunModal({
    highlightVariantId: row.componentVariantId || undefined,
    highlightSku: row.componentSku || undefined,
    contextNote: `Dashboard ${row.rowType} — ${row.recommendedAction || "review channel quantities manually"}. Sync is not run automatically.`,
  });
}

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>} row */
export async function markRowReviewed(row) {
  if (row.rowType !== "restock_assist" || !row.reservationId) {
    showInventoryToast("Review applies to restock assist rows only.", { variant: "info" });
    return;
  }
  await upsertMarketplaceRestockQueueState({
    reservationId: row.reservationId,
    observationId: row.observationId,
    status: "reviewed",
  });
  await logMarketplaceRestockAssistAction({
    reservationId: row.reservationId,
    observationId: row.observationId,
    actionType: "reviewed",
    previousStatus: row.status,
    note: "Reviewed from Returns & Restock Dashboard",
  });
  showInventoryToast("Marked reviewed.", { variant: "success" });
}

/** @param {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>} row */
export async function snoozeRow(row) {
  if (row.rowType !== "restock_assist" || !row.reservationId) {
    showInventoryToast("Snooze applies to restock assist rows only.", { variant: "info" });
    return;
  }
  const raw = window.prompt("Snooze for how many hours?", "24");
  if (raw === null) return;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    showInventoryToast("Enter a positive number of hours.", { variant: "error" });
    return;
  }
  const until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  await upsertMarketplaceRestockQueueState({
    reservationId: row.reservationId,
    observationId: row.observationId,
    status: "snoozed",
    snoozedUntil: until,
  });
  await logMarketplaceRestockAssistAction({
    reservationId: row.reservationId,
    observationId: row.observationId,
    actionType: "snoozed",
    previousStatus: row.status,
    note: "Snoozed from Returns & Restock Dashboard",
    rawContext: { snoozed_until: until, hours },
  });
  showInventoryToast(`Snoozed ${hours}h.`, { variant: "success" });
}
