/**
 * Post-map workflow candidates API (Phase 9A — read-only classification).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/**
 * @typedef {Object} PostMappingWorkflowCandidate
 * @property {string} mappingActionId
 * @property {string|null} batchId
 * @property {string} sourceChannel
 * @property {string} sourceOrderId
 * @property {string} sourceOrderItemId
 * @property {string|null} productId
 * @property {string|null} variantId
 * @property {string} productLabel
 * @property {string} internalSku
 * @property {string|null} sourceSku
 * @property {string|null} sourceTitle
 * @property {number} quantity
 * @property {string} orderStatus
 * @property {string} paymentStatus
 * @property {string|null} fulfillmentStatus
 * @property {string|null} refundStatus
 * @property {string|null} fulfillmentChannel
 * @property {string} mappedAt
 * @property {string} nextStep
 * @property {string} nextStepReason
 * @property {string} actionTarget
 */

/** @param {Record<string, unknown>} row @returns {PostMappingWorkflowCandidate} */
export function mapPostMappingCandidate(row) {
  return {
    mappingActionId: String(row.mapping_action_id ?? ""),
    batchId: row.batch_id ? String(row.batch_id) : null,
    sourceChannel: String(row.source_channel ?? ""),
    sourceOrderId: String(row.source_order_id ?? ""),
    sourceOrderItemId: String(row.source_order_item_id ?? ""),
    productId: row.product_id ? String(row.product_id) : null,
    variantId: row.variant_id ? String(row.variant_id) : null,
    productLabel: String(row.product_label ?? ""),
    internalSku: String(row.internal_sku ?? ""),
    sourceSku: row.source_sku ? String(row.source_sku) : null,
    sourceTitle: row.source_title ? String(row.source_title) : null,
    quantity: Number(row.quantity ?? 0),
    orderStatus: String(row.order_status ?? ""),
    paymentStatus: String(row.payment_status ?? ""),
    fulfillmentStatus: row.fulfillment_status ? String(row.fulfillment_status) : null,
    refundStatus: row.refund_status ? String(row.refund_status) : null,
    fulfillmentChannel: row.fulfillment_channel ? String(row.fulfillment_channel) : null,
    mappedAt: String(row.mapped_at ?? ""),
    nextStep: String(row.next_step ?? "manual_review"),
    nextStepReason: String(row.next_step_reason ?? ""),
    actionTarget: String(row.action_target ?? "line_items_orders"),
  };
}

/**
 * @param {Object} opts
 * @param {string[]} [opts.mappingActionIds]
 * @param {Array<{ sourceOrderId: string, sourceOrderItemId: string }>} [opts.orderRefs]
 * @param {string} [opts.batchId]
 */
export async function fetchPostMappingWorkflowCandidates(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  /** @type {Array<{ sourceOrderId: string, sourceOrderItemId: string }>} */
  let orderRefs = opts.orderRefs ?? [];

  if (opts.batchId) {
    const { data: batch, error: batchErr } = await sb
      .from("inventory_mapping_assist_batches")
      .select("results")
      .eq("id", opts.batchId)
      .maybeSingle();
    if (batchErr) throw new Error(batchErr.message);
    if (!batch?.results) return [];

    orderRefs = (Array.isArray(batch.results) ? batch.results : [])
      .filter((row) => row?.ok !== false && !row?.skipped)
      .map((row) => ({
        sourceOrderId: String(row.source_order_id ?? ""),
        sourceOrderItemId: String(row.source_order_item_id ?? ""),
      }))
      .filter((r) => r.sourceOrderId && r.sourceOrderItemId);
  }

  if (opts.mappingActionIds?.length) {
    const { data, error } = await sb
      .from("v_inventory_post_mapping_workflow_candidates")
      .select("*")
      .in("mapping_action_id", opts.mappingActionIds)
      .order("mapped_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapPostMappingCandidate);
  }

  if (!orderRefs.length) return [];

  const orderIds = [...new Set(orderRefs.map((r) => r.sourceOrderId))];
  const { data, error } = await sb
    .from("v_inventory_post_mapping_workflow_candidates")
    .select("*")
    .in("source_order_id", orderIds)
    .order("mapped_at", { ascending: false });
  if (error) throw new Error(error.message);

  const keys = new Set(orderRefs.map((r) => `${r.sourceOrderId}:${r.sourceOrderItemId}`));
  return (data ?? []).map(mapPostMappingCandidate).filter((r) => keys.has(`${r.sourceOrderId}:${r.sourceOrderItemId}`));
}

/** @param {PostMappingWorkflowCandidate[]} rows */
export function summarizePostMappingSteps(rows) {
  const counts = {
    reservation_retry: 0,
    shipped_finalize_audit: 0,
    manual_finalize_possible: 0,
    already_accounted_for: 0,
    skipped_manual: 0,
  };

  for (const row of rows) {
    if (row.nextStep === "reservation_retry") counts.reservation_retry += 1;
    else if (row.nextStep === "shipped_finalize_audit") counts.shipped_finalize_audit += 1;
    else if (row.nextStep === "manual_finalize_possible") counts.manual_finalize_possible += 1;
    else if (row.nextStep === "already_accounted_for") counts.already_accounted_for += 1;
    else counts.skipped_manual += 1;
  }

  return counts;
}

/** @param {Record<string, unknown>} batchResult @returns {string[]} */
export function mappingActionIdsFromBatchResult(batchResult) {
  const results = batchResult?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((row) => (row?.audit_id ? String(row.audit_id) : ""))
    .filter(Boolean);
}

/** @param {Record<string, unknown>} singleApplyResult @returns {string[]} */
export function mappingActionIdsFromSingleApply(singleApplyResult) {
  const id = singleApplyResult?.audit_id;
  return id ? [String(id)] : [];
}
