/**
 * Reservation retry API (Phase 8D — admin confirm only).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/**
 * @typedef {Object} ReservationRetryCandidate
 * @property {string} sourceChannel
 * @property {string} sourceOrderId
 * @property {string} sourceOrderItemId
 * @property {string} variantId
 * @property {string|null} productId
 * @property {string} productLabel
 * @property {string} sku
 * @property {string} title
 * @property {number} quantity
 * @property {string} orderStatus
 * @property {string|null} fulfillmentStatus
 * @property {string} paymentStatus
 * @property {string|null} mappingSource
 * @property {string|null} existingReservationId
 * @property {string} suggestedAction
 * @property {string} reason
 * @property {boolean} isEligible
 */

/** @param {Record<string, unknown>} row @returns {ReservationRetryCandidate} */
export function mapRetryCandidateRow(row) {
  return {
    sourceChannel: String(row.source_channel ?? ""),
    sourceOrderId: String(row.source_order_id ?? ""),
    sourceOrderItemId: String(row.source_order_item_id ?? ""),
    variantId: String(row.variant_id ?? ""),
    productId: row.product_id ? String(row.product_id) : null,
    productLabel: String(row.product_label ?? ""),
    sku: String(row.sku ?? ""),
    title: String(row.title ?? ""),
    quantity: Number(row.quantity ?? 0),
    orderStatus: String(row.order_status ?? ""),
    fulfillmentStatus: row.fulfillment_status ? String(row.fulfillment_status) : null,
    paymentStatus: String(row.payment_status ?? ""),
    mappingSource: row.mapping_source ? String(row.mapping_source) : null,
    existingReservationId: row.existing_reservation_id ? String(row.existing_reservation_id) : null,
    suggestedAction: String(row.suggested_action ?? ""),
    reason: String(row.reason ?? ""),
    isEligible: Boolean(row.is_eligible),
  };
}

/**
 * @param {string} channel
 * @param {string} orderId
 * @param {string} orderItemId
 * @returns {Promise<ReservationRetryCandidate|null>}
 */
export async function fetchReservationRetryCandidate(channel, orderId, orderItemId) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_reservation_retry_candidates")
    .select("*")
    .eq("source_channel", channel)
    .eq("source_order_id", orderId)
    .eq("source_order_item_id", orderItemId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapRetryCandidateRow(data) : null;
}

/** @param {{ limit?: number, eligibleOnly?: boolean }} [opts] */
export async function fetchReservationRetryCandidates(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);

  let query = sb.from("v_inventory_reservation_retry_candidates").select("*").limit(limit);
  if (opts.eligibleOnly) query = query.eq("is_eligible", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRetryCandidateRow);
}

/**
 * @param {Object} params
 * @param {string} params.sourceChannel
 * @param {string} params.sourceOrderId
 * @param {string} params.sourceOrderItemId
 * @param {string|null} [params.expectedVariantId]
 * @param {string|null} [params.note]
 */
export async function retryReservationForOrderLine(params) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb.rpc("retry_inventory_reservation_for_order_line", {
    p_source_channel: params.sourceChannel,
    p_source_order_id: params.sourceOrderId,
    p_source_order_item_id: params.sourceOrderItemId,
    p_expected_variant_id: params.expectedVariantId ?? null,
    p_note: params.note ?? null,
  });

  if (error) throw new Error(error.message || "Reservation retry failed");
  if (!data?.ok) throw new Error("Reservation retry failed");
  return data;
}

/** @param {ReservationRetryCandidate} candidate */
export function reservationImpactCopy(candidate) {
  const qty = candidate.quantity;
  return {
    reservedDelta: `+${qty}`,
    availableDelta: `−${qty}`,
    onHandDelta: "unchanged",
  };
}
