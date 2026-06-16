/**
 * Marketplace restock assist API (Phase 10Q — admin-confirmed only).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/** @typedef {Object} MarketplaceRestockAssistRow
 * @property {string} reservationId
 * @property {string} sourceChannel
 * @property {string} sourceOrderId
 * @property {string|null} sourceOrderItemId
 * @property {string|null} observationId
 * @property {string|null} observationConfidence
 * @property {string} assistStatus
 * @property {string} assistReason
 * @property {number|null} suggestedRestockQty
 * @property {number} maxRestockableQty
 * @property {number} finalizedQty
 * @property {number} alreadyRestockedQty
 * @property {string|null} workflowId
 * @property {string|null} workflowStatus
 * @property {string|null} workflowCondition
 * @property {string|null} physicalReturnConfirmedAt
 * @property {number|null} refundAmountCents
 * @property {string|null} cancellationStatus
 * @property {string|null} returnStatus
 */

/** @param {Record<string, unknown>} row @returns {MarketplaceRestockAssistRow} */
export function mapMarketplaceRestockAssist(row) {
  return {
    reservationId: String(row.reservation_id ?? ""),
    sourceChannel: String(row.source_channel ?? ""),
    sourceOrderId: String(row.source_order_id ?? ""),
    sourceOrderItemId: row.source_order_item_id ? String(row.source_order_item_id) : null,
    parentBundleVariantId: row.parent_bundle_variant_id ? String(row.parent_bundle_variant_id) : null,
    componentSku: String(row.component_sku ?? ""),
    componentTitle: String(row.component_title ?? ""),
    parentBundleTitle: String(row.parent_bundle_title ?? ""),
    observationId: row.observation_id ? String(row.observation_id) : null,
    observationSourceChannel: row.observation_source_channel
      ? String(row.observation_source_channel)
      : null,
    observationConfidence: row.observation_confidence ? String(row.observation_confidence) : null,
    observationStatus: row.observation_status ? String(row.observation_status) : null,
    assistStatus: String(row.assist_status ?? "order_level_manual_review"),
    assistReason: String(row.assist_reason ?? ""),
    suggestedRestockQty:
      row.suggested_restock_qty == null ? null : Number(row.suggested_restock_qty),
    maxRestockableQty: Number(row.max_restockable_qty ?? 0),
    finalizedQty: Number(row.finalized_qty ?? 0),
    alreadyRestockedQty: Number(row.already_restocked_qty ?? 0),
    workflowId: row.workflow_id ? String(row.workflow_id) : null,
    workflowStatus: row.workflow_status ? String(row.workflow_status) : null,
    workflowCondition: row.workflow_condition ? String(row.workflow_condition) : null,
    physicalReturnConfirmedAt: row.physical_return_confirmed_at
      ? String(row.physical_return_confirmed_at)
      : null,
    refundAmountCents: row.refund_amount_cents == null ? null : Number(row.refund_amount_cents),
    cancellationStatus: row.cancellation_status ? String(row.cancellation_status) : null,
    returnStatus: row.return_status ? String(row.return_status) : null,
    quantityReturned: row.quantity_returned == null ? null : Number(row.quantity_returned),
    quantityRefunded: row.quantity_refunded == null ? null : Number(row.quantity_refunded),
    observationObservedAt: row.observation_observed_at
      ? String(row.observation_observed_at)
      : null,
    observationSyncSource: row.observation_sync_source
      ? String(row.observation_sync_source)
      : null,
  };
}

/** @param {Object} [opts]
 * @param {string} [opts.reservationId]
 * @param {string} [opts.assistStatus]
 * @param {number} [opts.limit]
 * @returns {Promise<MarketplaceRestockAssistRow[]>}
 */
export async function fetchMarketplaceRestockAssist(opts = {}) {
  await requireAuthenticatedSession();
  let q = getSupabaseClient()
    .from("v_inventory_marketplace_restock_assist_candidates")
    .select("*")
    .order("observation_observed_at", { ascending: false, nullsFirst: false });

  if (opts.reservationId) q = q.eq("reservation_id", opts.reservationId);
  if (opts.assistStatus) q = q.eq("assist_status", opts.assistStatus);
  q = q.limit(opts.limit ?? 50);

  const { data, error } = await q;
  if (error) throw new Error(error.message || "Failed to load marketplace restock assist");
  return (data ?? []).map((row) => mapMarketplaceRestockAssist(row));
}

/** @param {string[]} reservationIds @returns {Promise<Map<string, MarketplaceRestockAssistRow>>} */
export async function fetchMarketplaceRestockAssistMap(reservationIds) {
  const ids = [...new Set((reservationIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await getSupabaseClient()
    .from("v_inventory_marketplace_restock_assist_candidates")
    .select("*")
    .in("reservation_id", ids);

  if (error) throw new Error(error.message || "Failed to load marketplace restock assist");
  const m = new Map();
  for (const row of data ?? []) {
    const mapped = mapMarketplaceRestockAssist(row);
    m.set(mapped.reservationId, mapped);
  }
  return m;
}

export const ASSIST_STATUS_LABELS = {
  eligible_line_confirmed: "Eligible (line confirmed)",
  needs_rma_workflow: "Needs return workflow",
  needs_physical_return_confirmation: "Confirm physical return",
  sku_inferred_manual_review: "SKU inferred — manual review",
  order_level_manual_review: "Order-level — manual review",
  already_restocked: "Already restocked",
  afn_external_review: "AFN external review",
  not_finalized: "Not finalized",
};

export const ASSIST_CHANNEL_LABELS = {
  ebay: "eBay",
  amazon: "Amazon",
  stripe: "Stripe",
  kk: "KK",
};
