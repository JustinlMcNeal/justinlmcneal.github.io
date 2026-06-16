/**
 * Return/RMA workflow API (Phase 10J).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";
import { mapReturnGuidance } from "./bundleReturnRestockApi.js";

/** @typedef {import('./bundleReturnRestockApi.js').ReturnGuidanceRow & {
 *   workflowId: string|null,
 *   workflowStatus: string|null,
 *   workflowCondition: string|null,
 *   workflowQuantityExpected: number|null,
 *   workflowQuantityReceived: number|null,
 *   workflowQuantityRestocked: number|null,
 *   workflowRmaNumber: string|null,
 *   workflowTrackingNumber: string|null,
 *   workflowNote: string|null,
 *   workflowNextAction: string,
 *   refundGuidanceStatus: string,
 *   refundGuidanceStatusResolved: string|null,
 *   refundConfidence: string,
 *   refundDetailCount: number|null,
 *   latestRefundAt: string|null,
 *   orderRefundedAt: string|null,
 *   lineRefundCents: number|null,
 *   suggestedPanelAction: string|null,
 *   refundSourceChannel: string,
 *   orderChannel: string,
 *   isAmazonAfn: boolean,
 *   marketplaceObservationCount: number|null,
 *   latestMarketplaceObsAt: string|null,
 *   persistedObservationCount: number|null,
 *   latestPersistedObsAt: string|null,
 *   marketplaceSyncSource: string|null,
 *   marketplaceLineConfidence: string|null,
 *   marketplaceLineSyncSource: string|null,
 *   marketplaceAssistStatus: string|null,
 *   marketplaceAssistReason: string|null,
 *   marketplaceSuggestedRestockQty: number|null,
 *   marketplaceObservationConfidence: string|null,
 *   marketplaceObservationId: string|null,
 *   workflowPhysicalReturnConfirmedAt: string|null,
 *   workflowPhysicalReturnConfirmedNote: string|null,
 * }} ReturnWorkflowGuidanceRow */

/** @param {Record<string, unknown>} row @returns {ReturnWorkflowGuidanceRow} */
export function mapReturnWorkflowGuidance(row) {
  const base = mapReturnGuidance(row);
  return {
    ...base,
    returnStatus: row.workflow_status ? String(row.workflow_status) : base.returnStatus,
    workflowId: row.workflow_id ? String(row.workflow_id) : null,
    workflowStatus: row.workflow_status ? String(row.workflow_status) : null,
    workflowCondition: row.workflow_condition ? String(row.workflow_condition) : null,
    workflowQuantityExpected:
      row.workflow_quantity_expected == null ? null : Number(row.workflow_quantity_expected),
    workflowQuantityReceived:
      row.workflow_quantity_received == null ? null : Number(row.workflow_quantity_received),
    workflowQuantityRestocked:
      row.workflow_quantity_restocked == null ? null : Number(row.workflow_quantity_restocked),
    workflowRmaNumber: row.workflow_rma_number ? String(row.workflow_rma_number) : null,
    workflowTrackingNumber: row.workflow_tracking_number ? String(row.workflow_tracking_number) : null,
    workflowNote: row.workflow_note ? String(row.workflow_note) : null,
    workflowNextAction: String(row.workflow_next_action ?? "manual_review"),
    refundGuidanceStatus: String(row.refund_guidance_status_resolved ?? row.refund_guidance_status ?? "no_refund"),
    refundGuidanceStatusResolved: row.refund_guidance_status_resolved
      ? String(row.refund_guidance_status_resolved)
      : null,
    refundConfidence: String(row.refund_confidence ?? "none"),
    refundDetailCount: row.refund_detail_count == null ? null : Number(row.refund_detail_count),
    latestRefundAt: row.latest_refund_at ? String(row.latest_refund_at) : null,
    orderRefundedAt: row.order_refunded_at ? String(row.order_refunded_at) : null,
    lineRefundCents: row.line_refund_cents == null ? null : Number(row.line_refund_cents),
    suggestedPanelAction: row.suggested_panel_action ? String(row.suggested_panel_action) : null,
    refundSourceChannel: String(row.refund_source_channel ?? "none"),
    orderChannel: String(row.order_channel ?? "kk"),
    isAmazonAfn: Boolean(row.is_amazon_afn),
    marketplaceObservationCount:
      row.marketplace_observation_count == null ? null : Number(row.marketplace_observation_count),
    latestMarketplaceObsAt: row.latest_marketplace_obs_at
      ? String(row.latest_marketplace_obs_at)
      : null,
    persistedObservationCount:
      row.persisted_observation_count == null ? null : Number(row.persisted_observation_count),
    latestPersistedObsAt: row.latest_persisted_obs_at
      ? String(row.latest_persisted_obs_at)
      : null,
    marketplaceSyncSource: row.marketplace_sync_source
      ? String(row.marketplace_sync_source)
      : null,
    marketplaceLineConfidence: row.marketplace_line_confidence
      ? String(row.marketplace_line_confidence)
      : null,
    marketplaceLineSyncSource: row.marketplace_line_sync_source
      ? String(row.marketplace_line_sync_source)
      : null,
    marketplaceAssistStatus: row.marketplace_assist_status
      ? String(row.marketplace_assist_status)
      : null,
    marketplaceAssistReason: row.marketplace_assist_reason
      ? String(row.marketplace_assist_reason)
      : null,
    marketplaceSuggestedRestockQty:
      row.marketplace_suggested_restock_qty == null
        ? null
        : Number(row.marketplace_suggested_restock_qty),
    marketplaceObservationConfidence: row.marketplace_observation_confidence
      ? String(row.marketplace_observation_confidence)
      : null,
    marketplaceObservationId: row.marketplace_observation_id
      ? String(row.marketplace_observation_id)
      : null,
    workflowPhysicalReturnConfirmedAt: row.workflow_physical_return_confirmed_at
      ? String(row.workflow_physical_return_confirmed_at)
      : null,
    workflowPhysicalReturnConfirmedNote: row.workflow_physical_return_confirmed_note
      ? String(row.workflow_physical_return_confirmed_note)
      : null,
  };
}

/** @param {Object} [opts]
 * @param {string} [opts.bundleVariantId]
 * @param {string} [opts.guidanceStatus]
 * @param {number} [opts.limit]
 * @returns {Promise<ReturnWorkflowGuidanceRow[]>}
 */
export async function fetchReturnWorkflowGuidance(opts = {}) {
  await requireAuthenticatedSession();
  let q = getSupabaseClient()
    .from("v_inventory_bundle_component_return_workflow_guidance")
    .select("*")
    .order("finalized_at", { ascending: false });

  if (opts.bundleVariantId) q = q.eq("parent_bundle_variant_id", opts.bundleVariantId);
  if (opts.guidanceStatus) q = q.eq("guidance_status", opts.guidanceStatus);
  q = q.limit(opts.limit ?? 50);

  const { data, error } = await q;
  if (error) throw new Error(error.message || "Failed to load return workflow guidance");
  return (data ?? []).map((row) => mapReturnWorkflowGuidance(row));
}

/**
 * @param {Object} input
 * @param {string} input.reservationId
 * @param {number} [input.quantityExpected]
 * @param {string} [input.rmaNumber]
 * @param {string} [input.trackingNumber]
 * @param {string|null} [input.note]
 * @param {string} [input.status]
 */
export async function createReturnWorkflow(input) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("create_inventory_return_workflow", {
    p_reservation_id: input.reservationId,
    p_quantity_expected: input.quantityExpected ?? null,
    p_rma_number: input.rmaNumber ?? null,
    p_tracking_number: input.trackingNumber ?? null,
    p_note: input.note ?? null,
    p_status: input.status ?? "return_expected",
  });
  if (error) throw new Error(error.message || "Failed to create return workflow");
  return data;
}

/**
 * @param {Object} input
 * @param {string} input.workflowId
 * @param {string} [input.status]
 * @param {string} [input.condition]
 * @param {number} [input.quantityReceived]
 * @param {number} [input.quantityRestocked]
 * @param {string} [input.rmaNumber]
 * @param {string} [input.trackingNumber]
 * @param {string|null} [input.note]
 * @param {string|null} [input.overrideNote]
 * @param {boolean} [input.physicalReturnConfirmed]
 * @param {string|null} [input.physicalReturnConfirmedNote]
 */
export async function updateReturnWorkflow(input) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("update_inventory_return_workflow", {
    p_workflow_id: input.workflowId,
    p_status: input.status ?? null,
    p_condition: input.condition ?? null,
    p_quantity_received: input.quantityReceived ?? null,
    p_quantity_restocked: input.quantityRestocked ?? null,
    p_rma_number: input.rmaNumber ?? null,
    p_tracking_number: input.trackingNumber ?? null,
    p_note: input.note ?? null,
    p_override_note: input.overrideNote ?? null,
    p_physical_return_confirmed: input.physicalReturnConfirmed ?? null,
    p_physical_return_confirmed_note: input.physicalReturnConfirmedNote ?? null,
  });
  if (error) throw new Error(error.message || "Failed to update return workflow");
  return data;
}

/** @param {string} workflowId @param {string|null} [note] */
export async function closeReturnWorkflow(workflowId, note = null) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("close_inventory_return_workflow", {
    p_workflow_id: workflowId,
    p_note: note,
  });
  if (error) throw new Error(error.message || "Failed to close return workflow");
  return data;
}

/**
 * @param {Object} input
 * @param {string} input.workflowId
 * @param {number} input.restockQty
 * @param {string} [input.reservationId]
 */
export async function linkReturnWorkflowRestock(input) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("link_return_workflow_restock", {
    p_workflow_id: input.workflowId,
    p_restock_qty: input.restockQty,
    p_reservation_id: input.reservationId ?? null,
  });
  if (error) throw new Error(error.message || "Failed to link return workflow restock");
  return data;
}

/** Phase 10Q — confirm physical return (no stock change). */
export async function confirmPhysicalReturn(input) {
  return updateReturnWorkflow({
    workflowId: input.workflowId,
    physicalReturnConfirmed: true,
    physicalReturnConfirmedNote: input.note ?? null,
    status: "inspected",
    condition: "resellable",
  });
}

export const WORKFLOW_NEXT_LABELS = {
  create_rma: "Create return workflow",
  wait_for_return: "Wait for return",
  inspect_return: "Inspect return",
  restock_received: "Restock received units",
  close_return: "Close return",
  manual_review: "Manual review",
};

export const WORKFLOW_STATUS_LABELS = {
  open: "Open",
  return_expected: "Return expected",
  received: "Received",
  partially_received: "Partially received",
  inspected: "Inspected",
  restocked: "Restocked",
  closed: "Closed",
  canceled: "Canceled",
};
