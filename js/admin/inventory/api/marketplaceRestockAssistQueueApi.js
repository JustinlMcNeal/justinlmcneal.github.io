/**
 * Marketplace restock assist queue + audit API (Phase 10R).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

export const STALE_OBSERVATION_HOURS = 48;

export const QUEUE_BUCKET_LABELS = {
  ready_to_restock: "Ready to Restock",
  needs_physical_confirmation: "Needs Physical Confirmation",
  needs_rma: "Needs RMA",
  stale_observation: "Stale Observation",
  manual_review: "Manual Review",
  blocked: "Blocked",
  already_done: "Done",
  snoozed: "Snoozed",
};

/** @param {Record<string, unknown>} row */
export function mapQueueRow(row) {
  return {
    reservationId: String(row.reservation_id ?? ""),
    returnWorkflowId: row.return_workflow_id ? String(row.return_workflow_id) : null,
    observationId: row.observation_id ? String(row.observation_id) : null,
    sourceChannel: String(row.source_channel ?? ""),
    sourceOrderId: String(row.source_order_id ?? ""),
    sourceOrderItemId: row.source_order_item_id ? String(row.source_order_item_id) : null,
    parentBundleVariantId: row.parent_bundle_variant_id ? String(row.parent_bundle_variant_id) : null,
    componentVariantId: row.component_variant_id ? String(row.component_variant_id) : null,
    componentTitle: String(row.component_title ?? ""),
    componentSku: String(row.component_sku ?? ""),
    parentBundleTitle: String(row.parent_bundle_title ?? ""),
    parentBundleSku: row.parent_bundle_sku ? String(row.parent_bundle_sku) : null,
    finalizedQty: Number(row.finalized_qty ?? 0),
    alreadyRestockedQty: Number(row.already_restocked_qty ?? 0),
    maxRestockableQty: Number(row.max_restockable_qty ?? 0),
    suggestedRestockQty: row.suggested_restock_qty == null ? null : Number(row.suggested_restock_qty),
    observationConfidence: row.observation_confidence ? String(row.observation_confidence) : null,
    observationAgeHours: row.observation_age_hours == null ? null : Number(row.observation_age_hours),
    isObservationStale: Boolean(row.is_observation_stale),
    physicalReturnConfirmedAt: row.physical_return_confirmed_at
      ? String(row.physical_return_confirmed_at)
      : null,
    workflowStatus: row.workflow_status ? String(row.workflow_status) : null,
    workflowCondition: row.workflow_condition ? String(row.workflow_condition) : null,
    assistStatus: String(row.assist_status ?? ""),
    assistReason: String(row.assist_reason ?? ""),
    queueBucket: String(row.queue_bucket ?? "manual_review"),
    queuePriority: Number(row.queue_priority ?? 500),
    observationObservedAt: row.observation_observed_at ? String(row.observation_observed_at) : null,
    observationSyncSource: row.observation_sync_source ? String(row.observation_sync_source) : null,
    observationSourceChannel: row.observation_source_channel
      ? String(row.observation_source_channel)
      : null,
    triageStatus: row.triage_status ? String(row.triage_status) : "open",
    triageSnoozedUntil: row.triage_snoozed_until ? String(row.triage_snoozed_until) : null,
    triageNote: row.triage_note ? String(row.triage_note) : null,
    isActivelySnoozed: Boolean(row.is_actively_snoozed),
    isDismissed: Boolean(row.is_dismissed),
  };
}

/** @param {Object} [opts]
 * @param {string} [opts.queueBucket]
 * @param {number} [opts.limit]
 */
export async function fetchMarketplaceRestockQueue(opts = {}) {
  await requireAuthenticatedSession();
  let q = getSupabaseClient()
    .from("v_inventory_marketplace_restock_assist_queue_with_triage")
    .select("*")
    .order("queue_priority", { ascending: true })
    .order("observation_observed_at", { ascending: false, nullsFirst: false });

  if (opts.queueBucket === "snoozed") {
    q = q.eq("is_actively_snoozed", true);
  } else if (opts.queueBucket) {
    q = q.eq("queue_bucket", opts.queueBucket).eq("is_actively_snoozed", false).eq("is_dismissed", false);
  } else {
    q = q.eq("is_actively_snoozed", false).eq("is_dismissed", false);
  }
  q = q.limit(opts.limit ?? 100);

  const { data, error } = await q;
  if (error) throw new Error(error.message || "Failed to load restock assist queue");
  return (data ?? []).map((row) => mapQueueRow(row));
}

/** @param {Object} input */
export async function logMarketplaceRestockAssistAction(input) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("log_marketplace_restock_assist_action", {
    p_reservation_id: input.reservationId ?? null,
    p_return_workflow_id: input.returnWorkflowId ?? null,
    p_observation_id: input.observationId ?? null,
    p_action_type: input.actionType,
    p_qty: input.qty ?? null,
    p_previous_status: input.previousStatus ?? null,
    p_next_status: input.nextStatus ?? null,
    p_note: input.note ?? null,
    p_raw_context: input.rawContext ?? null,
  });
  if (error) throw new Error(error.message || "Failed to log assist action");
  return data;
}

/** @param {ReturnType<typeof mapQueueRow>} row */
export function queueRowCanRestock(row) {
  if (row.queueBucket !== "ready_to_restock") return false;
  if (row.isObservationStale) return false;
  if (row.maxRestockableQty <= 0) return false;
  if (row.workflowCondition === "damaged" || row.workflowCondition === "missing") return false;
  if (row.observationConfidence !== "line_confirmed") return false;
  return true;
}
