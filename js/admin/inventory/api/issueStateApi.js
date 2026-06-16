/**
 * Inventory issue workflow state API (Phase 8B — writes issue state only).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";
import { buildGroupIssueKey } from "../services/issueKeys.js";

/** @typedef {'open'|'reviewed'|'snoozed'|'resolved'|'ignored'} IssueWorkflowStatus */

/**
 * @typedef {Object} IssueStateRow
 * @property {string} id
 * @property {string} issueKey
 * @property {string} issueType
 * @property {IssueWorkflowStatus} status
 * @property {string|null} snoozedUntil
 * @property {string|null} resolutionNote
 */

/**
 * @param {Record<string, unknown>} row
 * @returns {IssueStateRow}
 */
export function mapIssueStateRow(row) {
  return {
    id: String(row.id ?? ""),
    issueKey: String(row.issue_key ?? ""),
    issueType: String(row.issue_type ?? ""),
    status: /** @type {IssueWorkflowStatus} */ (String(row.status ?? "open")),
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : null,
    resolutionNote: row.resolution_note ? String(row.resolution_note) : null,
  };
}

/** @returns {Promise<string|null>} */
async function currentUserId() {
  const session = await requireAuthenticatedSession();
  return session.user?.id ?? null;
}

/**
 * @param {string} issueKey
 * @returns {Promise<IssueStateRow|null>}
 */
export async function fetchIssueStateByKey(issueKey) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("inventory_issue_states")
    .select("id, issue_key, issue_type, status, snoozed_until, resolution_note")
    .eq("issue_key", issueKey)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapIssueStateRow(data) : null;
}

/**
 * @param {Object} opts
 * @param {string} opts.issueKey
 * @param {string} opts.issueType
 * @param {IssueWorkflowStatus} opts.status
 * @param {string|null} [opts.snoozedUntil]
 * @param {string|null} [opts.resolutionNote]
 * @param {string|null} [opts.source]
 * @returns {Promise<IssueStateRow>}
 */
export async function upsertIssueState(opts) {
  const userId = await currentUserId();
  const sb = getSupabaseClient();

  const existing = await fetchIssueStateByKey(opts.issueKey);

  const payload = {
    issue_key: opts.issueKey,
    issue_type: opts.issueType,
    status: opts.status,
    snoozed_until: opts.snoozedUntil ?? null,
    resolution_note: opts.resolutionNote ?? null,
    source: opts.source ?? null,
    updated_by: userId,
  };

  if (existing?.id) {
    const { data, error } = await sb
      .from("inventory_issue_states")
      .update(payload)
      .eq("id", existing.id)
      .select("id, issue_key, issue_type, status, snoozed_until, resolution_note")
      .single();
    if (error) throw new Error(error.message);
    return mapIssueStateRow(data);
  }

  const { data, error } = await sb
    .from("inventory_issue_states")
    .insert({ ...payload, created_by: userId })
    .select("id, issue_key, issue_type, status, snoozed_until, resolution_note")
    .single();

  if (error) throw new Error(error.message);
  return mapIssueStateRow(data);
}

/**
 * @param {import('../state.js').InventoryIssueRow} issue
 * @param {IssueWorkflowStatus} status
 * @param {{ snoozedUntil?: string|null, resolutionNote?: string|null }} [extra]
 */
export async function setGroupIssueWorkflow(issue, status, extra = {}) {
  const issueKey = buildGroupIssueKey(issue.type);
  return upsertIssueState({
    issueKey,
    issueType: issue.type,
    status,
    snoozedUntil: extra.snoozedUntil ?? null,
    resolutionNote: extra.resolutionNote ?? null,
    source: issue.source || null,
  });
}

/** @param {import('../state.js').InventoryIssueRow} issue */
export async function markIssueReviewed(issue) {
  return setGroupIssueWorkflow(issue, "reviewed", { snoozedUntil: null });
}

/**
 * @param {import('../state.js').InventoryIssueRow} issue
 * @param {Date|string} until
 */
export async function snoozeIssue(issue, until) {
  const iso = until instanceof Date ? until.toISOString() : String(until);
  return setGroupIssueWorkflow(issue, "snoozed", { snoozedUntil: iso });
}

/** @param {import('../state.js').InventoryIssueRow} issue @param {string} [note] */
export async function resolveIssue(issue, note) {
  return setGroupIssueWorkflow(issue, "resolved", {
    snoozedUntil: null,
    resolutionNote: note || null,
  });
}

/** @param {import('../state.js').InventoryIssueRow} issue @param {string} [note] */
export async function ignoreIssue(issue, note) {
  return setGroupIssueWorkflow(issue, "ignored", {
    snoozedUntil: null,
    resolutionNote: note || null,
  });
}

/** @param {import('../state.js').InventoryIssueRow} issue */
export async function reopenIssue(issue) {
  return setGroupIssueWorkflow(issue, "open", { snoozedUntil: null });
}

/** @param {number} days */
export function snoozeUntilDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
