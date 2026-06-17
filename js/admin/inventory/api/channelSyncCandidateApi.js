/**
 * Single-variant channel sync candidate reads (Phase 059A.2).
 * Lightweight — one row per variant; no full-table preview.
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

const VARIANT_CANDIDATE_SELECT =
  "variant_id, product_id, available_qty, on_hand_qty, reserved_qty, kk_sync_action, amazon_sync_action, amazon_listing_status, amazon_current_qty, ebay_sync_action, ebay_listing_status, ebay_current_qty, issue_flags";

const RELIST_SELECT = "variant_id, relist_action, suggested_qty, available_qty, old_status";

/**
 * @typedef {Object} ChannelSyncCandidateRow
 * @property {string} variant_id
 * @property {string} product_id
 * @property {number|null} available_qty
 * @property {number|null} on_hand_qty
 * @property {number|null} reserved_qty
 * @property {string|null} kk_sync_action
 * @property {string|null} amazon_sync_action
 * @property {string|null} amazon_listing_status
 * @property {number|null} amazon_current_qty
 * @property {string|null} ebay_sync_action
 * @property {string|null} ebay_listing_status
 * @property {number|null} ebay_current_qty
 * @property {string[]|null} issue_flags
 */

/**
 * @typedef {Object} EbayRelistCandidateRow
 * @property {string} variant_id
 * @property {string|null} relist_action
 * @property {number|null} suggested_qty
 * @property {number|null} available_qty
 * @property {string|null} old_status
 */

/**
 * @typedef {{ candidate: ChannelSyncCandidateRow|null, relist: EbayRelistCandidateRow|null }} VariantChannelBundle
 */

/**
 * @param {string} variantId
 * @returns {Promise<VariantChannelBundle>}
 */
export async function fetchChannelSyncCandidateForVariant(variantId) {
  const id = String(variantId || "").trim();
  if (!id) return { candidate: null, relist: null };

  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_channel_sync_candidates")
    .select(VARIANT_CANDIDATE_SELECT)
    .eq("variant_id", id)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to load channel preview");

  /** @type {ChannelSyncCandidateRow|null} */
  const candidate = data || null;

  if (!candidate || candidate.ebay_sync_action !== "ended_needs_relist") {
    return { candidate, relist: null };
  }

  const { data: relistRow, error: relistErr } = await sb
    .from("v_inventory_ebay_relist_candidates")
    .select(RELIST_SELECT)
    .eq("variant_id", id)
    .limit(1)
    .maybeSingle();

  if (relistErr) {
    console.warn("[channelSyncCandidateApi] relist row:", relistErr.message);
    return { candidate, relist: null };
  }

  return { candidate, relist: relistRow || null };
}
