/**
 * Post-restock channel follow-up API (Phase 10T — workflow only, no sync/stock).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

export const FOLLOWUP_STATUS_LABELS = {
  needs_channel_review: "Needs Channel Review",
  needs_amazon_review: "Needs Amazon Review",
  needs_ebay_review: "Needs eBay Review",
  kk_updated: "KK Updated",
  no_channel_mapping: "No Channel Mapping",
  completed: "Completed",
};

export const WORKFLOW_STATUS_LABELS = {
  open: "Follow-up Open",
  reviewed: "Reviewed",
  sync_not_needed: "Sync Not Needed",
  sync_completed: "Sync Completed",
  dismissed: "Dismissed",
};

/** @param {Record<string, unknown>} row */
export function mapFollowupCandidate(row) {
  return {
    restockActionId: String(row.restock_action_id ?? ""),
    reservationId: row.reservation_id ? String(row.reservation_id) : null,
    returnWorkflowId: row.return_workflow_id ? String(row.return_workflow_id) : null,
    observationId: row.observation_id ? String(row.observation_id) : null,
    assistActionId: row.assist_action_id ? String(row.assist_action_id) : null,
    componentVariantId: row.component_variant_id ? String(row.component_variant_id) : null,
    parentBundleVariantId: row.parent_bundle_variant_id ? String(row.parent_bundle_variant_id) : null,
    componentSku: String(row.component_sku ?? ""),
    componentTitle: String(row.component_title ?? ""),
    parentBundleSku: row.parent_bundle_sku ? String(row.parent_bundle_sku) : null,
    parentBundleTitle: row.parent_bundle_title ? String(row.parent_bundle_title) : null,
    restockedQty: Number(row.restocked_qty ?? 0),
    stockAfter: row.stock_after == null ? null : Number(row.stock_after),
    restockCreatedAt: String(row.restock_created_at ?? ""),
    sourceChannel: row.source_channel ? String(row.source_channel) : null,
    sourceOrderId: row.source_order_id ? String(row.source_order_id) : null,
    sourceOrderItemId: row.source_order_item_id ? String(row.source_order_item_id) : null,
    ledgerId: row.ledger_id ? String(row.ledger_id) : null,
    amazonMappingStatus: String(row.amazon_mapping_status ?? "not_mapped"),
    ebayMappingStatus: String(row.ebay_mapping_status ?? "not_mapped"),
    kkAvailableAfter: row.kk_available_after == null ? null : Number(row.kk_available_after),
    virtualBundleAvailableAfter:
      row.virtual_bundle_available_after == null ? null : Number(row.virtual_bundle_available_after),
    workflowStatus: String(row.workflow_status ?? "open"),
    workflowNote: row.workflow_note ? String(row.workflow_note) : null,
    followupStatus: String(row.followup_status ?? "kk_updated"),
    followupReason: String(row.followup_reason ?? ""),
  };
}

/** @param {Object} [opts] */
export async function fetchRestockFollowupCandidates(opts = {}) {
  await requireAuthenticatedSession();
  let q = getSupabaseClient()
    .from("v_inventory_restock_followup_candidates")
    .select("*")
    .order("restock_created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.sourceChannel) q = q.eq("source_channel", opts.sourceChannel);
  const { data, error } = await q;
  if (error) throw new Error(error.message || "Failed to load follow-up candidates");
  return (data ?? []).map((row) => mapFollowupCandidate(row));
}

/** @param {string} restockActionId */
export async function fetchRestockFollowupCandidate(restockActionId) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("v_inventory_restock_followup_candidates")
    .select("*")
    .eq("restock_action_id", restockActionId)
    .maybeSingle();
  if (error) throw new Error(error.message || "Failed to load follow-up candidate");
  return data ? mapFollowupCandidate(data) : null;
}

/** @param {string} ledgerId */
export async function fetchRestockFollowupByLedgerId(ledgerId) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("v_inventory_restock_followup_candidates")
    .select("*")
    .eq("ledger_id", ledgerId)
    .order("restock_created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message || "Failed to load follow-up by ledger");
  return data ? mapFollowupCandidate(data) : null;
}

/** @param {Object} input */
export async function upsertRestockFollowupState(input) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("upsert_inventory_restock_followup_state", {
    p_restock_action_id: input.restockActionId,
    p_status: input.status,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(error.message || "Failed to update follow-up state");
  return data;
}

/** @param {ReturnType<typeof mapFollowupCandidate>} candidate */
export function followupBadgeLabel(candidate) {
  const ws = candidate.workflowStatus;
  if (ws === "sync_completed") return WORKFLOW_STATUS_LABELS.sync_completed;
  if (ws === "sync_not_needed") return WORKFLOW_STATUS_LABELS.sync_not_needed;
  if (ws === "reviewed") return WORKFLOW_STATUS_LABELS.reviewed;
  if (ws === "dismissed") return WORKFLOW_STATUS_LABELS.dismissed;
  if (candidate.followupStatus === "no_channel_mapping") return "No Mapping";
  return WORKFLOW_STATUS_LABELS.open;
}
