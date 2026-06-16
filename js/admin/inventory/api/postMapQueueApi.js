/**
 * Post-map action queue API (Phase 9B — workflow todos only).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/** @typedef {'open'|'reviewed'|'snoozed'|'done'|'ignored'} PostMapQueueStatus */

/**
 * @typedef {Object} PostMapQueueItem
 * @property {string} id
 * @property {string} sourceChannel
 * @property {string} sourceOrderId
 * @property {string} sourceOrderItemId
 * @property {string|null} mappingActionId
 * @property {string|null} mappingBatchId
 * @property {string|null} productId
 * @property {string|null} variantId
 * @property {string|null} productLabel
 * @property {string|null} internalSku
 * @property {number} quantity
 * @property {string} nextStep
 * @property {PostMapQueueStatus} status
 * @property {string|null} snoozedUntil
 * @property {string|null} reason
 * @property {Record<string, unknown>|null} actionTarget
 * @property {string} createdAt
 * @property {string|null} completedAt
 */

/** @param {Record<string, unknown>} row @returns {PostMapQueueItem} */
export function mapPostMapQueueRow(row) {
  return {
    id: String(row.id ?? ""),
    sourceChannel: String(row.source_channel ?? ""),
    sourceOrderId: String(row.source_order_id ?? ""),
    sourceOrderItemId: String(row.source_order_item_id ?? ""),
    mappingActionId: row.mapping_action_id ? String(row.mapping_action_id) : null,
    mappingBatchId: row.mapping_batch_id ? String(row.mapping_batch_id) : null,
    productId: row.product_id ? String(row.product_id) : null,
    variantId: row.variant_id ? String(row.variant_id) : null,
    productLabel: row.product_label ? String(row.product_label) : null,
    internalSku: row.internal_sku ? String(row.internal_sku) : null,
    quantity: Number(row.quantity ?? 0),
    nextStep: String(row.next_step ?? ""),
    status: /** @type {PostMapQueueStatus} */ (String(row.status ?? "open")),
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : null,
    reason: row.reason ? String(row.reason) : null,
    actionTarget:
      row.action_target && typeof row.action_target === "object"
        ? /** @type {Record<string, unknown>} */ (row.action_target)
        : null,
    createdAt: String(row.created_at ?? ""),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

/** @param {import('./postMappingWorkflowApi.js').PostMappingWorkflowCandidate} candidate */
export function checklistItemToQueuePayload(candidate) {
  return {
    source_channel: candidate.sourceChannel,
    source_order_id: candidate.sourceOrderId,
    source_order_item_id: candidate.sourceOrderItemId,
    mapping_action_id: candidate.mappingActionId || null,
    mapping_batch_id: candidate.batchId || null,
    product_id: candidate.productId || null,
    variant_id: candidate.variantId || null,
    product_label: candidate.productLabel || null,
    internal_sku: candidate.internalSku || null,
    quantity: candidate.quantity,
    next_step: candidate.nextStep,
    reason: candidate.nextStepReason || null,
    action_target: { type: candidate.actionTarget },
  };
}

/** @param {import('./postMappingWorkflowApi.js').PostMappingWorkflowCandidate[]} candidates */
export async function createPostMapQueueFromChecklist(candidates) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const items = candidates.map(checklistItemToQueuePayload);

  const { data, error } = await sb.rpc("upsert_post_map_queue_from_checklist", {
    p_items: items,
  });

  if (error) throw new Error(error.message || "Queue upsert failed");
  return data;
}

/**
 * @param {Object} [opts]
 * @param {'active'|'open'|'reviewed'|'snoozed'|'done'|'ignored'} [opts.filter]
 * @param {string} [opts.nextStep]
 * @param {string} [opts.sourceChannel]
 * @param {number} [opts.limit]
 */
export async function fetchPostMapQueue(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const now = new Date().toISOString();
  const filter = opts.filter ?? "active";

  let query = sb.from("inventory_post_map_action_queue").select("*").order("created_at", { ascending: false }).limit(limit);

  if (opts.nextStep) query = query.eq("next_step", opts.nextStep);
  if (opts.sourceChannel) query = query.eq("source_channel", opts.sourceChannel);

  if (filter === "snoozed") {
    query = query.eq("status", "snoozed").gt("snoozed_until", now);
  } else if (filter === "done") {
    query = query.eq("status", "done");
  } else if (filter === "ignored") {
    query = query.eq("status", "ignored");
  } else if (filter === "reviewed") {
    query = query.eq("status", "reviewed");
  } else if (filter === "open") {
    query = query.eq("status", "open");
  } else if (filter === "active") {
    query = query.or(`status.in.(open,reviewed),and(status.eq.snoozed,snoozed_until.lte.${now})`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let rows = (data ?? []).map(mapPostMapQueueRow);

  if (filter === "active") {
    rows = rows.filter((r) => {
      if (r.status === "snoozed" && r.snoozedUntil && new Date(r.snoozedUntil) > new Date()) return false;
      return r.status === "open" || r.status === "reviewed" || r.status === "snoozed";
    });
  }

  return rows;
}

/** @returns {Promise<{ active: number, byStep: Record<string, number> }>} */
export async function fetchPostMapQueueCounts() {
  const rows = await fetchPostMapQueue({ limit: 100, filter: "active" });
  const byStep = {};
  for (const row of rows) {
    byStep[row.nextStep] = (byStep[row.nextStep] || 0) + 1;
  }
  return { active: rows.length, byStep };
}

/**
 * @param {string} id
 * @param {PostMapQueueStatus} status
 * @param {{ snoozedUntil?: string|null, reason?: string|null }} [opts]
 */
export async function updatePostMapQueueItem(id, status, opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb.rpc("update_post_map_queue_item", {
    p_id: id,
    p_status: status,
    p_snoozed_until: opts.snoozedUntil ?? null,
    p_reason: opts.reason ?? null,
  });

  if (error) throw new Error(error.message || "Queue update failed");
  return data;
}

/**
 * Suggest marking done when underlying action appears complete (read-only checks).
 * @param {PostMapQueueItem} item
 * @returns {Promise<'reservation_exists'|'finalized'|'accounted'|null>}
 */
export async function detectUnderlyingActionComplete(item) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  if (item.nextStep === "reservation_retry") {
    const { data } = await sb
      .from("v_inventory_reservation_retry_candidates")
      .select("suggested_action, is_eligible")
      .eq("source_order_id", item.sourceOrderId)
      .eq("source_order_item_id", item.sourceOrderItemId)
      .maybeSingle();
    if (data && !data.is_eligible && data.suggested_action === "already_reserved") {
      return "reservation_exists";
    }
  }

  if (item.nextStep === "manual_finalize_possible" || item.nextStep === "shipped_finalize_audit") {
    const { data } = await sb
      .from("v_inventory_shipped_finalize_audit")
      .select("suggested_audit_status, is_finalize_eligible")
      .eq("source_order_id", item.sourceOrderId)
      .eq("source_order_item_id", item.sourceOrderItemId)
      .maybeSingle();
    if (data?.suggested_audit_status === "accounted_for") return "accounted";
    if (item.nextStep === "manual_finalize_possible" && data && !data.is_finalize_eligible) {
      return "accounted";
    }
  }

  return null;
}
