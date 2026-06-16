/**
 * Marketplace restock assist analytics + audit + triage API (Phase 10S).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

export const AUDIT_ACTION_LABELS = {
  reviewed: "Reviewed",
  physical_return_confirmed: "Physical Return Confirmed",
  restock_confirmed: "Restock Confirmed",
  skipped: "Skipped",
  blocked: "Blocked",
  refreshed_observation: "Refreshed Observation",
  snoozed: "Snoozed",
  unsnoozed: "Unsnoozed",
  dismissed: "Dismissed",
};

/** @param {Record<string, unknown>} row */
export function mapQueueSummary(row) {
  return {
    readyToRestock: Number(row.ready_to_restock ?? 0),
    needsPhysicalConfirmation: Number(row.needs_physical_confirmation ?? 0),
    needsRma: Number(row.needs_rma ?? 0),
    staleObservation: Number(row.stale_observation ?? 0),
    manualReview: Number(row.manual_review ?? 0),
    blocked: Number(row.blocked ?? 0),
    alreadyDone: Number(row.already_done ?? 0),
    snoozed: Number(row.snoozed ?? 0),
    totalOpenQueueItems: Number(row.total_open_queue_items ?? 0),
    oldestStaleObservationAgeHours:
      row.oldest_stale_observation_age_hours == null
        ? null
        : Number(row.oldest_stale_observation_age_hours),
    totalRestockableQty: Number(row.total_restockable_qty ?? 0),
    estimatedPendingComponentQty: Number(row.estimated_pending_component_qty ?? 0),
  };
}

/** @param {Record<string, unknown>} row */
export function mapAuditRow(row) {
  return {
    actionId: String(row.action_id ?? ""),
    actionType: String(row.action_type ?? ""),
    createdAt: String(row.created_at ?? ""),
    createdBy: row.created_by ? String(row.created_by) : null,
    reservationId: row.reservation_id ? String(row.reservation_id) : null,
    returnWorkflowId: row.return_workflow_id ? String(row.return_workflow_id) : null,
    observationId: row.observation_id ? String(row.observation_id) : null,
    sourceChannel: row.source_channel ? String(row.source_channel) : null,
    sourceOrderId: row.source_order_id ? String(row.source_order_id) : null,
    sourceOrderItemId: row.source_order_item_id ? String(row.source_order_item_id) : null,
    componentSku: row.component_sku ? String(row.component_sku) : null,
    componentTitle: row.component_title ? String(row.component_title) : null,
    parentBundleTitle: row.parent_bundle_title ? String(row.parent_bundle_title) : null,
    parentBundleSku: row.parent_bundle_sku ? String(row.parent_bundle_sku) : null,
    qty: row.qty == null ? null : Number(row.qty),
    previousStatus: row.previous_status ? String(row.previous_status) : null,
    nextStatus: row.next_status ? String(row.next_status) : null,
    note: row.note ? String(row.note) : null,
    rawContext: row.raw_context ?? null,
    ledgerId: row.ledger_id ? String(row.ledger_id) : null,
    restockResult: row.restock_result ?? null,
  };
}

export async function fetchMarketplaceRestockQueueSummary() {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("v_inventory_marketplace_restock_assist_queue_summary")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message || "Failed to load queue summary");
  return mapQueueSummary(data ?? {});
}

/** @param {Object} [opts]
 * @param {string} [opts.actionType]
 * @param {string} [opts.sourceChannel]
 * @param {string} [opts.componentSearch]
 * @param {string} [opts.orderId]
 * @param {string} [opts.since]
 * @param {string} [opts.until]
 * @param {string} [opts.reservationId]
 * @param {number} [opts.limit]
 */
export async function fetchMarketplaceRestockAudit(opts = {}) {
  await requireAuthenticatedSession();
  let q = getSupabaseClient()
    .from("v_inventory_marketplace_restock_assist_audit")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 150);

  if (opts.actionType) q = q.eq("action_type", opts.actionType);
  if (opts.sourceChannel) q = q.eq("source_channel", opts.sourceChannel);
  if (opts.orderId) q = q.ilike("source_order_id", `%${opts.orderId}%`);
  if (opts.reservationId) q = q.eq("reservation_id", opts.reservationId);
  if (opts.since) q = q.gte("created_at", opts.since);
  if (opts.until) q = q.lte("created_at", opts.until);
  if (opts.componentSearch) {
    const term = `%${opts.componentSearch}%`;
    q = q.or(`component_sku.ilike.${term},component_title.ilike.${term}`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message || "Failed to load audit history");
  return (data ?? []).map((row) => mapAuditRow(row));
}

/** @param {Object} input */
export async function upsertMarketplaceRestockQueueState(input) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc(
    "upsert_marketplace_restock_assist_queue_state",
    {
      p_reservation_id: input.reservationId,
      p_observation_id: input.observationId ?? null,
      p_status: input.status,
      p_snoozed_until: input.snoozedUntil ?? null,
      p_note: input.note ?? null,
    },
  );
  if (error) throw new Error(error.message || "Failed to update queue triage state");
  return data;
}
