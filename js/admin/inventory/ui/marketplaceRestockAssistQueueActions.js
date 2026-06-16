/**
 * Queue row/batch action handlers (Phase 10S — no batch restock).
 */

import {
  logMarketplaceRestockAssistAction,
  queueRowCanRestock,
} from "../api/marketplaceRestockAssistQueueApi.js";
import { upsertMarketplaceRestockQueueState } from "../api/marketplaceRestockAssistAnalyticsApi.js";
import { restockBundleComponentLine } from "../api/bundleReturnRestockApi.js";
import {
  confirmPhysicalReturn,
  createReturnWorkflow,
  linkReturnWorkflowRestock,
} from "../api/returnWorkflowApi.js";
import { refreshMarketplaceObservations } from "../api/refundRefreshApi.js";
import { showInventoryToast } from "../events.js";
import { openRestockFollowupChecklistModal } from "./restockFollowupChecklist.js";

/** @param {ReturnType<import('../api/marketplaceRestockAssistQueueApi.js').mapQueueRow>} row */
export async function actionReview(row) {
  await upsertMarketplaceRestockQueueState({
    reservationId: row.reservationId,
    observationId: row.observationId,
    status: "reviewed",
    note: row.triageNote || null,
  });
  await logMarketplaceRestockAssistAction({
    reservationId: row.reservationId,
    returnWorkflowId: row.returnWorkflowId,
    observationId: row.observationId,
    actionType: "reviewed",
    previousStatus: row.queueBucket,
    nextStatus: row.queueBucket,
    note: "Marked reviewed from batch queue",
  });
}

/** @param {ReturnType<import('../api/marketplaceRestockAssistQueueApi.js').mapQueueRow>} row @param {number} hours */
export async function actionSnooze(row, hours) {
  const until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const note = window.prompt("Optional snooze note:") || null;
  await upsertMarketplaceRestockQueueState({
    reservationId: row.reservationId,
    observationId: row.observationId,
    status: "snoozed",
    snoozedUntil: until,
    note,
  });
  await logMarketplaceRestockAssistAction({
    reservationId: row.reservationId,
    observationId: row.observationId,
    actionType: "snoozed",
    previousStatus: row.queueBucket,
    nextStatus: "snoozed",
    note,
    rawContext: { snoozed_until: until, hours },
  });
}

/** @param {ReturnType<import('../api/marketplaceRestockAssistQueueApi.js').mapQueueRow>} row */
export async function actionUnsnooze(row) {
  await upsertMarketplaceRestockQueueState({
    reservationId: row.reservationId,
    observationId: row.observationId,
    status: "open",
  });
  await logMarketplaceRestockAssistAction({
    reservationId: row.reservationId,
    observationId: row.observationId,
    actionType: "unsnoozed",
    previousStatus: row.queueBucket,
    nextStatus: row.queueBucket,
  });
}

/** @param {ReturnType<import('../api/marketplaceRestockAssistQueueApi.js').mapQueueRow>} row @param {number} qty */
export async function actionRestock(row, qty) {
  if (!queueRowCanRestock(row)) {
    showInventoryToast("Restock not allowed for this row.", { variant: "error" });
    return false;
  }
  if (qty > row.maxRestockableQty) {
    showInventoryToast(`Qty cannot exceed max restockable (${row.maxRestockableQty}).`, { variant: "error" });
    return false;
  }
  if (
    !window.confirm(
      `Restock ${qty} unit(s)?\n\nI confirmed the component was physically returned and is resellable.\n\nStock changes only for the component variant.`,
    )
  ) {
    return false;
  }

  const note = window.prompt("Optional restock note:") || null;
  const result = await restockBundleComponentLine({
    reservationId: row.reservationId,
    restockQty: qty,
    note,
    idempotencyKey: `queue_restock:${row.reservationId}:${qty}:${Date.now()}`,
  });

  await logMarketplaceRestockAssistAction({
    reservationId: row.reservationId,
    returnWorkflowId: row.returnWorkflowId,
    observationId: row.observationId,
    actionType: "restock_confirmed",
    qty,
    previousStatus: row.queueBucket,
    nextStatus: "already_done",
    note,
    rawContext: {
      suggested_restock_qty: row.suggestedRestockQty,
      observation_confidence: row.observationConfidence,
      restock_result: result,
      ledger_id: result?.ledger_id ?? null,
      audit_id: result?.audit_id ?? null,
    },
  });

  if (row.returnWorkflowId && window.confirm("Link return workflow restock qty?")) {
    await linkReturnWorkflowRestock({
      workflowId: row.returnWorkflowId,
      restockQty: qty,
      reservationId: row.reservationId,
    });
  }

  showInventoryToast("Component stock restored.", { variant: "success" });
  if (result?.audit_id) {
    try {
      await openRestockFollowupChecklistModal(String(result.audit_id));
    } catch (err) {
      console.warn("[restock] follow-up modal failed:", err);
    }
  }
  return true;
}

export function promptSnoozeHours() {
  const raw = window.prompt("Snooze for how many hours?", "24");
  if (raw === null) return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    showInventoryToast("Enter a positive number of hours.", { variant: "error" });
    return null;
  }
  return hours;
}

/** @param {ReturnType<import('../api/marketplaceRestockAssistQueueApi.js').mapQueueRow>} row */
export async function actionPhysicalReturn(row) {
  if (!row.returnWorkflowId) return;
  const note = window.prompt("Optional note:") || null;
  await confirmPhysicalReturn({ workflowId: row.returnWorkflowId, note });
  await logMarketplaceRestockAssistAction({
    reservationId: row.reservationId,
    returnWorkflowId: row.returnWorkflowId,
    observationId: row.observationId,
    actionType: "physical_return_confirmed",
    previousStatus: row.queueBucket,
    nextStatus: "ready_to_restock",
    note,
  });
  showInventoryToast("Physical return confirmed.", { variant: "success" });
}

/** @param {ReturnType<import('../api/marketplaceRestockAssistQueueApi.js').mapQueueRow>} row */
export async function actionCreateRma(row) {
  await createReturnWorkflow({ reservationId: row.reservationId, quantityExpected: row.finalizedQty });
  showInventoryToast("Return workflow created.", { variant: "success" });
}

/** @param {ReturnType<import('../api/marketplaceRestockAssistQueueApi.js').mapQueueRow>} row */
export async function actionRefreshObs(row) {
  const ch = row.sourceChannel === "amazon" ? "amazon" : row.sourceChannel === "ebay" ? "ebay" : "all";
  await refreshMarketplaceObservations({ channel: ch, sourceOrderId: row.sourceOrderId });
  await logMarketplaceRestockAssistAction({
    reservationId: row.reservationId,
    observationId: row.observationId,
    actionType: "refreshed_observation",
    previousStatus: row.queueBucket,
    note: "Single-row refresh from queue",
  });
  showInventoryToast("Observations refreshed.", { variant: "success" });
}

/** @param {ReturnType<import('../api/marketplaceRestockAssistQueueApi.js').mapQueueRow>} row */
export async function actionSkip(row) {
  const note = window.prompt("Skip reason / note:");
  if (note === null) return;
  await logMarketplaceRestockAssistAction({
    reservationId: row.reservationId,
    returnWorkflowId: row.returnWorkflowId,
    observationId: row.observationId,
    actionType: "skipped",
    previousStatus: row.queueBucket,
    note: note.trim() || null,
  });
  showInventoryToast("Skipped with note.", { variant: "info" });
}

/** @param {ReturnType<import('../api/marketplaceRestockAssistQueueApi.js').mapQueueRow>[]} targets */
export async function batchRefreshObs(targets) {
  const channels = new Set(targets.map((r) => r.sourceChannel).filter((c) => c === "ebay" || c === "amazon"));
  for (const ch of channels) await refreshMarketplaceObservations({ channel: ch });
  for (const row of targets) {
    await logMarketplaceRestockAssistAction({
      reservationId: row.reservationId,
      observationId: row.observationId,
      actionType: "refreshed_observation",
      previousStatus: row.queueBucket,
      note: "Batch refresh from queue",
    });
  }
  showInventoryToast("Observations refreshed.", { variant: "success" });
}
