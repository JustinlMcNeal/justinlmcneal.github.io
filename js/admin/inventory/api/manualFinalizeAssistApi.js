/**
 * Manual finalize assist API (Phase 8F — admin confirm only).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";
import { mapShippedAuditRow } from "./shippedFinalizeAuditApi.js";

/**
 * @typedef {import('./shippedFinalizeAuditApi.js').ShippedFinalizeAuditRow & {
 *   isFinalizeEligible: boolean
 * }} ManualFinalizeCandidate
 */

/** @param {Record<string, unknown>} row @returns {ManualFinalizeCandidate} */
export function mapManualFinalizeCandidate(row) {
  return {
    ...mapShippedAuditRow(row),
    isFinalizeEligible: Boolean(row.is_finalize_eligible),
  };
}

/**
 * @param {string} channel
 * @param {string} orderId
 * @param {string} orderItemId
 * @returns {Promise<ManualFinalizeCandidate|null>}
 */
export async function fetchManualFinalizeCandidate(channel, orderId, orderItemId) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_shipped_finalize_audit")
    .select("*")
    .eq("source_channel", channel)
    .eq("source_order_id", orderId)
    .eq("source_order_item_id", orderItemId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapManualFinalizeCandidate(data) : null;
}

/** @param {{ limit?: number, eligibleOnly?: boolean }} [opts] */
export async function fetchManualFinalizeCandidates(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);

  let query = sb.from("v_inventory_shipped_finalize_audit").select("*").limit(limit);
  if (opts.eligibleOnly) query = query.eq("is_finalize_eligible", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapManualFinalizeCandidate);
}

/**
 * @param {Object} params
 * @param {string} params.sourceChannel
 * @param {string} params.sourceOrderId
 * @param {string} params.sourceOrderItemId
 * @param {string} params.expectedVariantId
 * @param {string} params.note
 */
export async function manualFinalizeShippedOrderLine(params) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb.rpc("manual_finalize_shipped_order_line", {
    p_source_channel: params.sourceChannel,
    p_source_order_id: params.sourceOrderId,
    p_source_order_item_id: params.sourceOrderItemId,
    p_expected_variant_id: params.expectedVariantId,
    p_note: params.note,
  });

  if (error) throw new Error(error.message || "Manual finalize failed");
  if (!data?.ok) throw new Error("Manual finalize failed");
  return data;
}

/** @param {ManualFinalizeCandidate} candidate */
export function manualFinalizeImpactCopy(candidate) {
  const qty = candidate.quantity;
  return {
    onHandDelta: `−${qty}`,
    reservedDelta: candidate.reservationStatus === "reserved" ? `−${qty} (finalize existing)` : "unchanged",
    availableDelta: candidate.reservationStatus === "reserved" ? "unchanged (reserved released on finalize)" : `−${qty}`,
  };
}

/** @param {number} [limit] */
export async function countEligibleManualFinalizeCandidates(limit = 100) {
  const rows = await fetchManualFinalizeCandidates({ limit, eligibleOnly: true });
  return rows.length;
}
