/**
 * Shipped finalize audit reads (Phase 8E — read-only).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/**
 * @typedef {Object} ShippedFinalizeAuditRow
 * @property {string} sourceChannel
 * @property {string} sourceOrderId
 * @property {string} sourceOrderItemId
 * @property {string|null} productId
 * @property {string|null} variantId
 * @property {string} productLabel
 * @property {string} sku
 * @property {string} title
 * @property {number} quantity
 * @property {string} orderStatus
 * @property {string|null} fulfillmentStatus
 * @property {string} paymentStatus
 * @property {string|null} refundStatus
 * @property {string} fulfillmentChannel
 * @property {string|null} existingReservationId
 * @property {string|null} reservationStatus
 * @property {string|null} finalizedAt
 * @property {string|null} matchingLedgerId
 * @property {string|null} matchingLedgerReason
 * @property {string} suggestedAuditStatus
 * @property {string} severity
 * @property {string} reason
 * @property {boolean} needsAuditIssue
 * @property {boolean} isFinalizeEligible
 */

/** @param {Record<string, unknown>} row @returns {ShippedFinalizeAuditRow} */
export function mapShippedAuditRow(row) {
  return {
    sourceChannel: String(row.source_channel ?? ""),
    sourceOrderId: String(row.source_order_id ?? ""),
    sourceOrderItemId: String(row.source_order_item_id ?? ""),
    productId: row.product_id ? String(row.product_id) : null,
    variantId: row.variant_id ? String(row.variant_id) : null,
    productLabel: String(row.product_label ?? ""),
    sku: String(row.sku ?? ""),
    title: String(row.title ?? ""),
    quantity: Number(row.quantity ?? 0),
    orderStatus: String(row.order_status ?? ""),
    fulfillmentStatus: row.fulfillment_status ? String(row.fulfillment_status) : null,
    paymentStatus: String(row.payment_status ?? ""),
    refundStatus: row.refund_status ? String(row.refund_status) : null,
    fulfillmentChannel: String(row.fulfillment_channel ?? ""),
    existingReservationId: row.existing_reservation_id ? String(row.existing_reservation_id) : null,
    reservationStatus: row.reservation_status ? String(row.reservation_status) : null,
    finalizedAt: row.finalized_at ? String(row.finalized_at) : null,
    matchingLedgerId: row.matching_ledger_id ? String(row.matching_ledger_id) : null,
    matchingLedgerReason: row.matching_ledger_reason ? String(row.matching_ledger_reason) : null,
    suggestedAuditStatus: String(row.suggested_audit_status ?? ""),
    severity: String(row.severity ?? ""),
    reason: String(row.reason ?? ""),
    needsAuditIssue: Boolean(row.needs_audit_issue),
    isFinalizeEligible: Boolean(row.is_finalize_eligible),
  };
}

/** @param {{ limit?: number, needsAuditOnly?: boolean, auditStatus?: string }} [opts] */
export async function fetchShippedFinalizeAuditRows(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

  let query = sb.from("v_inventory_shipped_finalize_audit").select("*").limit(limit);
  if (opts.needsAuditOnly) query = query.eq("needs_audit_issue", true);
  if (opts.auditStatus) query = query.eq("suggested_audit_status", opts.auditStatus);
  if (opts.eligibleOnly) query = query.eq("is_finalize_eligible", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapShippedAuditRow);
}

/** @param {number} [limit] */
export async function fetchShippedAuditIssueSamples(limit = 8) {
  return fetchShippedFinalizeAuditRows({ limit, needsAuditOnly: true });
}

/** @returns {Promise<Record<string, number>>} */
export async function fetchShippedAuditStatusCounts() {
  await requireAuthenticatedSession();
  const rows = await fetchShippedFinalizeAuditRows({ limit: 100 });
  const counts = {};
  for (const row of rows) {
    counts[row.suggestedAuditStatus] = (counts[row.suggestedAuditStatus] || 0) + 1;
  }
  return counts;
}
