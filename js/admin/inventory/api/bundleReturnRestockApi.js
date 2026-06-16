/**
 * Bundle component return/restock API (Phase 10G + 10H guidance).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/** @typedef {Object} ReturnGuidanceRow
 * @property {string} reservationId
 * @property {string|null} parentBundleVariantId
 * @property {string|null} parentOrderItemId
 * @property {string} sourceOrderId
 * @property {string|null} sourceOrderItemId
 * @property {string} componentVariantId
 * @property {string} componentProductLabel
 * @property {string} componentSku
 * @property {string} parentBundleLabel
 * @property {number} finalizedQty
 * @property {number} alreadyRestockedQty
 * @property {number} maxRestockableQty
 * @property {string|null} finalizedAt
 * @property {string|null} matchingLedgerId
 * @property {string|null} refundStatus
 * @property {string|null} returnStatus
 * @property {string} suggestedAction
 * @property {number|null} orderTotalCents
 * @property {number|null} refundedAmountCents
 * @property {number|null} lineTotalCents
 * @property {number|null} parentLineQuantity
 * @property {number|null} estimatedRefundRatio
 * @property {number|null} suggestedRestockQty
 * @property {string} guidanceStatus
 * @property {string} guidanceReason
 */

/** @param {Record<string, unknown>} row @returns {ReturnGuidanceRow} */
export function mapReturnGuidance(row) {
  return {
    reservationId: String(row.reservation_id ?? ""),
    parentBundleVariantId: row.parent_bundle_variant_id ? String(row.parent_bundle_variant_id) : null,
    parentOrderItemId: row.parent_order_item_id ? String(row.parent_order_item_id) : null,
    sourceOrderId: String(row.source_order_id ?? ""),
    sourceOrderItemId: row.source_order_item_id ? String(row.source_order_item_id) : null,
    componentVariantId: String(row.component_variant_id ?? ""),
    componentProductLabel: String(row.component_product_label ?? ""),
    componentSku: String(row.component_sku ?? ""),
    parentBundleLabel: String(row.parent_bundle_label ?? ""),
    finalizedQty: Number(row.finalized_qty ?? row.quantity_finalized ?? 0),
    alreadyRestockedQty: Number(row.already_restocked_qty ?? row.quantity_already_restocked ?? 0),
    maxRestockableQty: Number(row.max_restockable_qty ?? row.quantity_available_to_restock ?? 0),
    finalizedAt: row.finalized_at ? String(row.finalized_at) : null,
    matchingLedgerId: row.matching_ledger_id ? String(row.matching_ledger_id) : null,
    refundStatus: row.refund_status ? String(row.refund_status) : null,
    returnStatus: row.return_status ? String(row.return_status) : null,
    suggestedAction: String(row.suggested_action ?? "manual_review"),
    orderTotalCents: row.order_total_cents == null ? null : Number(row.order_total_cents),
    refundedAmountCents: row.refunded_amount_cents == null ? null : Number(row.refunded_amount_cents),
    lineTotalCents: row.line_total_cents == null ? null : Number(row.line_total_cents),
    parentLineQuantity: row.parent_line_quantity == null ? null : Number(row.parent_line_quantity),
    estimatedRefundRatio: row.estimated_refund_ratio == null ? null : Number(row.estimated_refund_ratio),
    suggestedRestockQty: row.suggested_restock_qty == null ? null : Number(row.suggested_restock_qty),
    guidanceStatus: String(row.guidance_status ?? "manual_review"),
    guidanceReason: String(row.guidance_reason ?? ""),
  };
}

/** @typedef {ReturnGuidanceRow} ReturnCandidateRow */

/** @param {Object} [opts]
 * @param {string} [opts.bundleVariantId]
 * @param {string} [opts.guidanceStatus]
 * @param {number} [opts.limit]
 * @returns {Promise<ReturnGuidanceRow[]>}
 */
export async function fetchBundleReturnGuidance(opts = {}) {
  await requireAuthenticatedSession();
  let q = getSupabaseClient()
    .from("v_inventory_bundle_component_return_guidance")
    .select("*")
    .order("finalized_at", { ascending: false });

  if (opts.bundleVariantId) q = q.eq("parent_bundle_variant_id", opts.bundleVariantId);
  if (opts.guidanceStatus) q = q.eq("guidance_status", opts.guidanceStatus);
  q = q.limit(opts.limit ?? 50);

  const { data, error } = await q;
  if (error) throw new Error(error.message || "Failed to load return guidance");
  return (data ?? []).map((row) => mapReturnGuidance(row));
}

/** @deprecated use fetchBundleReturnGuidance */
export async function fetchBundleReturnCandidates(opts = {}) {
  return fetchBundleReturnGuidance(opts);
}

/**
 * @param {Object} input
 * @param {string} input.reservationId
 * @param {number} input.restockQty
 * @param {string} [input.reason]
 * @param {string|null} [input.note]
 * @param {string|null} [input.idempotencyKey]
 */
export async function restockBundleComponentLine(input) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("restock_bundle_component_line", {
    p_reservation_id: input.reservationId,
    p_restock_qty: input.restockQty,
    p_reason: input.reason ?? "customer_return",
    p_note: input.note ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) throw new Error(error.message || "Restock failed");
  return data;
}

/** @param {number|null|undefined} cents */
export function formatCents(cents) {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}
