/**
 * Returns & Restock Dashboard API (Phase 10U — read-only workbench).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

export const ROW_TYPE_LABELS = {
  return_workflow: "Return / RMA",
  restock_assist: "Restock Assist",
  channel_followup: "Channel Follow-Up",
  audit: "Restock Audit",
  manual_review: "Manual Review",
};

/** @param {Record<string, unknown>} row */
export function mapDashboardSummary(row) {
  return {
    openReturnWorkflows: Number(row.open_return_workflows ?? 0),
    receivedNotRestocked: Number(row.received_not_restocked ?? 0),
    readyToRestock: Number(row.ready_to_restock ?? 0),
    staleObservations: Number(row.stale_observations ?? 0),
    openChannelFollowups: Number(row.open_channel_followups ?? 0),
    syncNeededAfterRestock: Number(row.sync_needed_after_restock ?? 0),
    blockedManualReview: Number(row.blocked_manual_review ?? 0),
    recentRestocksCount: Number(row.recent_restocks_count ?? 0),
    recentRestockedQty: Number(row.recent_restocked_qty ?? 0),
    dashboardAttentionCount: Number(row.dashboard_attention_count ?? 0),
  };
}

/** @param {Record<string, unknown>} row */
export function mapWorklistRow(row) {
  return {
    rowId: String(row.row_id ?? ""),
    rowType: String(row.row_type ?? ""),
    priority: Number(row.priority ?? 500),
    sourceChannel: row.source_channel ? String(row.source_channel) : null,
    sourceOrderId: row.source_order_id ? String(row.source_order_id) : null,
    sourceOrderItemId: row.source_order_item_id ? String(row.source_order_item_id) : null,
    reservationId: row.reservation_id ? String(row.reservation_id) : null,
    restockActionId: row.restock_action_id ? String(row.restock_action_id) : null,
    auditActionId: row.audit_action_id ? String(row.audit_action_id) : null,
    workflowId: row.workflow_id ? String(row.workflow_id) : null,
    observationId: row.observation_id ? String(row.observation_id) : null,
    componentVariantId: row.component_variant_id ? String(row.component_variant_id) : null,
    parentBundleVariantId: row.parent_bundle_variant_id ? String(row.parent_bundle_variant_id) : null,
    componentSku: row.component_sku ? String(row.component_sku) : null,
    componentTitle: row.component_title ? String(row.component_title) : null,
    parentBundleSku: row.parent_bundle_sku ? String(row.parent_bundle_sku) : null,
    parentBundleTitle: row.parent_bundle_title ? String(row.parent_bundle_title) : null,
    status: row.status ? String(row.status) : null,
    reason: row.reason ? String(row.reason) : null,
    recommendedAction: row.recommended_action ? String(row.recommended_action) : null,
    isObservationStale: Boolean(row.is_observation_stale),
    observationAgeHours: row.observation_age_hours == null ? null : Number(row.observation_age_hours),
    suggestedRestockQty: row.suggested_restock_qty == null ? null : Number(row.suggested_restock_qty),
    maxRestockableQty: row.max_restockable_qty == null ? null : Number(row.max_restockable_qty),
    eventAt: row.event_at ? String(row.event_at) : null,
  };
}

/** @param {Record<string, unknown>} row */
export function mapDashboardMetrics(row) {
  return {
    restocks7d: Number(row.restocks_7d ?? 0),
    restocks30d: Number(row.restocks_30d ?? 0),
    qtyRestocked7d: Number(row.qty_restocked_7d ?? 0),
    qtyRestocked30d: Number(row.qty_restocked_30d ?? 0),
    openFollowups: Number(row.open_followups ?? 0),
    completedFollowups: Number(row.completed_followups ?? 0),
    avgHoursRestockToFollowupCompletion:
      row.avg_hours_restock_to_followup_completion == null
        ? null
        : Number(row.avg_hours_restock_to_followup_completion),
    staleObservationCount: Number(row.stale_observation_count ?? 0),
    manualReviewCount: Number(row.manual_review_count ?? 0),
  };
}

export async function fetchReturnsRestockDashboardMetrics() {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("v_inventory_returns_restock_dashboard_metrics")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message || "Failed to load dashboard metrics");
  return mapDashboardMetrics(data ?? {});
}

export async function fetchReturnsRestockDashboardSummary() {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("v_inventory_returns_restock_dashboard_summary")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message || "Failed to load dashboard summary");
  return mapDashboardSummary(data ?? {});
}

/** @param {Object} [opts] */
export async function fetchReturnsRestockDashboardWorklist(opts = {}) {
  await requireAuthenticatedSession();
  let q = getSupabaseClient()
    .from("v_inventory_returns_restock_dashboard_worklist")
    .select("*")
    .order("priority", { ascending: true })
    .order("event_at", { ascending: false, nullsFirst: false });

  if (opts.rowType) q = q.eq("row_type", opts.rowType);
  if (opts.sourceChannel) q = q.eq("source_channel", opts.sourceChannel);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.staleOnly) q = q.eq("is_observation_stale", true);
  if (opts.reservationId) q = q.eq("reservation_id", opts.reservationId);
  if (opts.orderId) q = q.ilike("source_order_id", `%${opts.orderId}%`);
  if (opts.observationId) q = q.eq("observation_id", opts.observationId);
  if (opts.restockActionId) q = q.eq("restock_action_id", opts.restockActionId);
  if (opts.search) {
    const term = `%${opts.search}%`;
    q = q.or(`component_sku.ilike.${term},component_title.ilike.${term},parent_bundle_title.ilike.${term}`);
  }
  q = q.limit(opts.limit ?? 150);

  const { data, error } = await q;
  if (error) throw new Error(error.message || "Failed to load dashboard worklist");
  return (data ?? []).map((row) => mapWorklistRow(row));
}

/** @param {Record<string, unknown>} payload */
export function mapWorklistPage(payload) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    rows: rows.map((row) => mapWorklistRow(row)),
    totalCount: Number(payload.total_count ?? 0),
    pageCount: Number(payload.page_count ?? 0),
    offset: Number(payload.offset ?? 0),
    limit: Number(payload.limit ?? 50),
    hasMore: Boolean(payload.has_more),
    nextOffset: payload.next_offset == null ? null : Number(payload.next_offset),
    prevOffset: payload.prev_offset == null ? null : Number(payload.prev_offset),
    bucketCounts: payload.bucket_counts ?? null,
    targetFound: Boolean(payload.target_found),
    targetOffset: payload.target_offset == null ? null : Number(payload.target_offset),
    targetRow: payload.target_row ? mapWorklistRow(payload.target_row) : null,
    targetRn: payload.target_rn == null ? null : Number(payload.target_rn),
  };
}

/**
 * @param {Object} state Dashboard filter state
 * @param {{ offset?: number; limit?: number; seekTarget?: boolean }} [pageOpts]
 */
export function buildWorklistPageParams(state, pageOpts = {}) {
  const priorityMax = state.priorityMax ? Number(state.priorityMax) : null;
  return {
    p_tab: state.tab || "worklist",
    p_channel: state.channel || null,
    p_status: state.status || null,
    p_priority_max: Number.isFinite(priorityMax) ? priorityMax : null,
    p_stale_only: Boolean(state.staleOnly),
    p_q: state.search || null,
    p_row_type: state.rowType || null,
    p_offset: pageOpts.offset ?? 0,
    p_limit: pageOpts.limit ?? 50,
    p_reservation_id: state.reservationId || null,
    p_order_id: state.orderId || null,
    p_observation_id: state.observationId || null,
    p_restock_action_id: state.restockActionId || null,
    p_followup_id: state.restockActionId || null,
    p_seek_target: Boolean(pageOpts.seekTarget),
  };
}

/** @param {ReturnType<typeof buildWorklistPageParams>} params */
export async function fetchReturnsRestockDashboardWorklistPage(params) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc(
    "get_returns_restock_dashboard_worklist_page",
    params,
  );
  if (error) throw new Error(error.message || "Failed to load paginated worklist");
  return mapWorklistPage(data ?? {});
}

const FILTERED_EXPORT_CAP = 2000;

/** @param {Object} state @param {number} [cap] */
export async function fetchAllFilteredWorklistRows(state, cap = FILTERED_EXPORT_CAP) {
  const all = [];
  let offset = 0;
  const limit = 250;
  while (all.length < cap) {
    const params = buildWorklistPageParams(state, { offset, limit, seekTarget: false });
    const page = await fetchReturnsRestockDashboardWorklistPage(params);
    all.push(...page.rows);
    if (!page.hasMore || page.nextOffset == null) break;
    offset = page.nextOffset;
  }
  return all.slice(0, cap);
}
