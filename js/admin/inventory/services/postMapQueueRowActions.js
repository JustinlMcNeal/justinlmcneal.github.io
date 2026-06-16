/**
 * Shared post-map queue row navigation (Phase 9B).
 */

import { buildLineItemsOrdersUrl } from "../constants/orderLinks.js";
import { fetchReservationRetryCandidate } from "../api/reservationRetryApi.js";
import { mapShippedAuditRow } from "../api/shippedFinalizeAuditApi.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { promptReservationRetry } from "../ui/reservationRetryPrompt.js";
import { promptManualFinalize } from "../ui/manualFinalizePrompt.js";
import { openShippedFinalizeAuditModal } from "../ui/shippedFinalizeAuditModal.js";
import {
  updatePostMapQueueItem,
} from "../api/postMapQueueApi.js";
import { fetchPostMapQueueWithResolution } from "../api/postMapQueueResolutionApi.js";
import { showInventoryToast } from "../events.js";

/** @typedef {import('../api/postMapQueueApi.js').PostMapQueueItem} QueueItem */
/** @typedef {import('../api/postMapQueueApi.js').PostMapQueueStatus} PostMapQueueStatus */

/**
 * @param {QueueItem|import('../api/postMappingWorkflowApi.js').PostMappingWorkflowCandidate} row
 * @param {{ onComplete?: () => void, suggestMarkDone?: boolean }} [opts]
 */
export async function openQueueReservationRetry(row, opts = {}) {
  const candidate = await fetchReservationRetryCandidate(
    row.sourceChannel,
    row.sourceOrderId,
    row.sourceOrderItemId,
  );
  if (!candidate) {
    showInventoryToast("Line not found in retry candidates.", { variant: "info" });
    return;
  }
  await promptReservationRetry(candidate);
  if (opts.suggestMarkDone && "id" in row) {
    await maybeSuggestMarkDone(/** @type {QueueItem} */ (row), opts.onComplete);
  }
  opts.onComplete?.();
}

/** @param {QueueItem|import('../api/postMappingWorkflowApi.js').PostMappingWorkflowCandidate} row @param {{ onComplete?: () => void }} [opts] */
export async function openQueueShippedAudit(row, opts = {}) {
  await openShippedFinalizeAuditModal({
    filterOrderId: row.sourceOrderId,
    filterOrderItemId: row.sourceOrderItemId,
  });
  opts.onComplete?.();
}

/** @param {QueueItem|import('../api/postMappingWorkflowApi.js').PostMappingWorkflowCandidate} row @param {{ onComplete?: () => void, suggestMarkDone?: boolean }} [opts] */
export async function openQueueManualFinalize(row, opts = {}) {
  const sb = getSupabaseClient();
  const { data } = await sb
    .from("v_inventory_shipped_finalize_audit")
    .select("*")
    .eq("source_order_id", row.sourceOrderId)
    .eq("source_order_item_id", row.sourceOrderItemId)
    .maybeSingle();
  if (!data) {
    showInventoryToast("Line not found in shipped audit.", { variant: "info" });
    return;
  }
  await promptManualFinalize(mapShippedAuditRow(data), {
    onComplete: () => {
      if (opts.suggestMarkDone && "id" in row) {
        void maybeSuggestMarkDone(/** @type {QueueItem} */ (row), opts.onComplete);
      } else opts.onComplete?.();
    },
  });
}

/** @param {QueueItem|import('../api/postMappingWorkflowApi.js').PostMappingWorkflowCandidate} row */
export function openQueueOrder(row) {
  window.location.assign(
    buildLineItemsOrdersUrl({
      sessionId: row.sourceOrderId,
      lineId: row.sourceOrderItemId,
      channel: row.sourceChannel,
    }),
  );
}

/** @param {QueueItem} item @param {(() => void)|undefined} onRefresh */
async function maybeSuggestMarkDone(item, onRefresh) {
  const rows = await fetchPostMapQueueWithResolution({ limit: 100 });
  const fresh = rows.find((r) => r.id === item.id);
  if (!fresh || fresh.detectedResolutionStatus !== "appears_completed") return;

  const ok = window.confirm(
    `${fresh.detectedReason}\n\nMark this queue item as done?`,
  );
  if (!ok) return;

  await updatePostMapQueueItem(item.id, "done");
  showInventoryToast("Queue item marked done.", { variant: "success" });
  onRefresh?.();
}

/** @param {QueueItem} item @param {(() => void)|undefined} onRefresh */
export async function snoozeQueueItem(item, onRefresh) {
  const daysStr = window.prompt("Snooze for how many days?", "3");
  if (daysStr === null) return;
  const days = Number(daysStr);
  if (!Number.isFinite(days) || days <= 0) {
    showInventoryToast("Enter a positive number of days.", { variant: "error" });
    return;
  }
  const until = new Date();
  until.setDate(until.getDate() + Math.round(days));
  await updatePostMapQueueItem(item.id, "snoozed", { snoozedUntil: until.toISOString() });
  showInventoryToast(`Snoozed until ${until.toLocaleDateString()}.`, { variant: "success" });
  onRefresh?.();
}

/** @param {QueueItem} item @param {PostMapQueueStatus} status @param {(() => void)|undefined} onRefresh */
export async function setQueueItemStatus(item, status, onRefresh) {
  await updatePostMapQueueItem(item.id, status);
  showInventoryToast(`Marked ${status}.`, { variant: "success" });
  onRefresh?.();
}
