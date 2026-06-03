import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { isParentShellRow } from "./readyToPushNormalize.js";

/** @typedef {Record<string, unknown>} ReadyRow */

/**
 * Same rules as amazon-submit-draft `isParentSubmissionReady`.
 * @param {ReadyRow | null | undefined} draft
 */
export function isParentListingReady(draft) {
  if (!draft) return false;
  const status = String(draft.draft_status || "");
  const submissionStatus = String(draft.submission_status || "").toUpperCase();
  if (status === "published" || draft.published_amazon_listing_id) return true;
  if (!["submitted", "published"].includes(status)) return false;
  return submissionStatus === "ACCEPTED" || submissionStatus === "VALID";
}

/**
 * Loads parent draft acceptance from `amazon_listing_drafts` (not exposed on legacy Ready view columns).
 * @param {ReadyRow[]} rows
 */
export async function enrichReadyToPushParentStatus(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const productIds = [
    ...new Set(
      rows
        .filter((row) => Number(row.variants_total || 0) > 1)
        .map((row) => String(row.kk_product_id || "").trim())
        .filter(Boolean),
    ),
  ];
  if (!productIds.length) return rows;

  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from("amazon_listing_drafts")
    .select("id, kk_product_id, draft_status, submission_status, published_amazon_listing_id, updated_at")
    .in("kk_product_id", productIds)
    .eq("variation_role", "parent")
    .neq("draft_status", "archived")
    .order("updated_at", { ascending: false });

  if (error) return rows;

  /** @type {Map<string, ReadyRow>} */
  const latestParentByProduct = new Map();
  for (const draft of data || []) {
    const productId = String(draft.kk_product_id || "").trim();
    if (!productId || latestParentByProduct.has(productId)) continue;
    latestParentByProduct.set(productId, draft);
  }

  const enriched = rows.map((row) => {
    const productId = String(row.kk_product_id || "").trim();
    const parentDraft = latestParentByProduct.get(productId);
    if (!parentDraft) return row;

    const ready = isParentListingReady(parentDraft);
    const next = { ...row, parent_listing_ready: ready };

    if (!isParentShellRow(row)) return next;

    return {
      ...next,
      draft_id: ready ? null : parentDraft.id,
      draft_status: parentDraft.draft_status,
      has_active_draft: !ready,
      last_draft_updated_at: parentDraft.updated_at,
      draft_variation_role: "parent",
    };
  });

  return enriched.filter((row) => !(isParentShellRow(row) && row.parent_listing_ready));
}
