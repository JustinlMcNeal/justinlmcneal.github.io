/**
 * Post-map queue resolution API (Phase 9C — read-only detection + bulk status).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";
import { mapPostMapQueueRow } from "./postMapQueueApi.js";

/** @typedef {import('./postMapQueueApi.js').PostMapQueueItem} PostMapQueueItem */
/** @typedef {import('./postMapQueueApi.js').PostMapQueueStatus} PostMapQueueStatus */

/**
 * @typedef {PostMapQueueItem & {
 *   detectedResolutionStatus: string,
 *   detectedReason: string,
 *   suggestedStatusAction: string,
 *   underlyingSignal: string,
 *   retryReservationId: string|null,
 *   retrySuggestedAction: string|null,
 *   suggestedAuditStatus: string|null,
 *   matchingLedgerId: string|null,
 *   matchingLedgerReason: string|null,
 *   manualFinalizeActionId: string|null,
 *   manualFinalizeLedgerId: string|null,
 *   auditReservationStatus: string|null,
 *   auditReservationId: string|null,
 * }} PostMapQueueWithResolution
 */

/** @param {Record<string, unknown>} row @returns {PostMapQueueWithResolution} */
export function mapPostMapQueueWithResolution(row) {
  const base = mapPostMapQueueRow(row);
  return {
    ...base,
    detectedResolutionStatus: String(row.detected_resolution_status ?? "still_open"),
    detectedReason: String(row.detected_reason ?? ""),
    suggestedStatusAction: String(row.suggested_status_action ?? "keep_open"),
    underlyingSignal: String(row.underlying_signal ?? "none"),
    retryReservationId: row.retry_reservation_id ? String(row.retry_reservation_id) : null,
    retrySuggestedAction: row.retry_suggested_action ? String(row.retry_suggested_action) : null,
    suggestedAuditStatus: row.suggested_audit_status ? String(row.suggested_audit_status) : null,
    matchingLedgerId: row.matching_ledger_id ? String(row.matching_ledger_id) : null,
    matchingLedgerReason: row.matching_ledger_reason ? String(row.matching_ledger_reason) : null,
    manualFinalizeActionId: row.manual_finalize_action_id ? String(row.manual_finalize_action_id) : null,
    manualFinalizeLedgerId: row.manual_finalize_ledger_id ? String(row.manual_finalize_ledger_id) : null,
    auditReservationStatus: row.audit_reservation_status ? String(row.audit_reservation_status) : null,
    auditReservationId: row.audit_reservation_id ? String(row.audit_reservation_id) : null,
  };
}

/**
 * @param {Object} [opts]
 * @param {'active'|'open'|'reviewed'|'snoozed'|'done'|'ignored'|'appears_completed'} [opts.filter]
 * @param {string} [opts.nextStep]
 * @param {string} [opts.sourceChannel]
 * @param {number} [opts.limit]
 */
export async function fetchPostMapQueueWithResolution(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 100);
  const now = new Date().toISOString();
  const filter = opts.filter ?? "active";

  let query = sb
    .from("v_inventory_post_map_queue_with_resolution")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

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
  } else if (filter === "appears_completed") {
    query = query
      .in("status", ["open", "reviewed", "snoozed"])
      .eq("detected_resolution_status", "appears_completed");
  } else if (filter === "active") {
    query = query.in("status", ["open", "reviewed", "snoozed"]);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let rows = (data ?? []).map(mapPostMapQueueWithResolution);

  if (filter === "active") {
    rows = rows.filter((r) => {
      if (r.status === "snoozed" && r.snoozedUntil && new Date(r.snoozedUntil) > new Date()) return false;
      return true;
    });
  }

  return rows;
}

/** @returns {Promise<{ open: number, snoozed: number, appearsCompleted: number, manualReview: number, doneIgnored: number, byStep: Record<string, number> }>} */
export async function fetchPostMapQueueWorkCounts() {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("v_inventory_post_map_queue_with_resolution")
    .select("status, next_step, detected_resolution_status, snoozed_until")
    .limit(200);

  if (error) throw new Error(error.message);

  const now = Date.now();
  const counts = {
    open: 0,
    snoozed: 0,
    appearsCompleted: 0,
    manualReview: 0,
    doneIgnored: 0,
    byStep: /** @type {Record<string, number>} */ ({}),
  };

  for (const row of data ?? []) {
    const status = String(row.status ?? "");
    const step = String(row.next_step ?? "");
    const resolution = String(row.detected_resolution_status ?? "");
    counts.byStep[step] = (counts.byStep[step] || 0) + 1;

    if (status === "done" || status === "ignored") {
      counts.doneIgnored += 1;
      continue;
    }
    if (status === "snoozed" && row.snoozed_until && new Date(String(row.snoozed_until)).getTime() > now) {
      counts.snoozed += 1;
      continue;
    }
    if (resolution === "appears_completed") counts.appearsCompleted += 1;
    if (step === "manual_review") counts.manualReview += 1;
    if (status === "open" || status === "reviewed" || status === "snoozed") counts.open += 1;
  }

  return counts;
}

/**
 * @param {string[]} ids
 * @param {PostMapQueueStatus} status
 * @param {{ snoozedUntil?: string|null }} [opts]
 */
export async function updatePostMapQueueItemsBulk(ids, status, opts = {}) {
  await requireAuthenticatedSession();
  if (!ids.length) return { ok: true, updated_count: 0 };

  const { data, error } = await getSupabaseClient().rpc("update_post_map_queue_items_bulk", {
    p_ids: ids,
    p_status: status,
    p_snoozed_until: opts.snoozedUntil ?? null,
  });

  if (error) throw new Error(error.message || "Bulk queue update failed");
  return data;
}

/** @param {PostMapQueueWithResolution} item */
export function resolutionBannerText(item) {
  if (item.detectedResolutionStatus !== "appears_completed") return null;
  if (item.underlyingSignal === "reservation_exists") return "Looks complete — reservation exists";
  if (item.underlyingSignal === "audit_accounted_for") return "Looks complete — finalized/accounted for";
  if (item.underlyingSignal === "ledger_found") return "Looks complete — ledger/finalize signal found";
  return "Looks complete — review evidence before marking done";
}
