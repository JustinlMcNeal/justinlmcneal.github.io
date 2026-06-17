/**
 * Read-only eBay variation child candidate API (Phase 060A.2).
 * Does not call eBay APIs, sync edges, or Adjust orchestration.
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

const VARIATION_CANDIDATE_SELECT = [
  "product_id",
  "variant_id",
  "product_code",
  "variant_sku",
  "option_name",
  "option_value",
  "ebay_item_group_key",
  "parent_ebay_listing_id",
  "expected_ebay_sku",
  "cache_ebay_sku",
  "child_offer_id",
  "child_listing_status",
  "kk_available_qty",
  "ebay_child_qty",
  "qty_delta",
  "candidate_state",
  "candidate_reason",
  "is_actionable",
  "requires_cache_refresh",
  "mapping_confidence",
  "cache_last_synced_at",
  "product_active_variant_count",
].join(",");

/**
 * @typedef {Object} EbayVariationChildCandidateRow
 * @property {string} product_id
 * @property {string} variant_id
 * @property {string|null} product_code
 * @property {string|null} variant_sku
 * @property {string|null} option_name
 * @property {string|null} option_value
 * @property {string|null} ebay_item_group_key
 * @property {string|null} parent_ebay_listing_id
 * @property {string|null} expected_ebay_sku
 * @property {string|null} cache_ebay_sku
 * @property {string|null} child_offer_id
 * @property {string|null} child_listing_status
 * @property {number} kk_available_qty
 * @property {number|null} ebay_child_qty
 * @property {number|null} qty_delta
 * @property {string} candidate_state
 * @property {string|null} candidate_reason
 * @property {boolean} is_actionable
 * @property {boolean} requires_cache_refresh
 * @property {string|null} mapping_confidence
 * @property {string|null} cache_last_synced_at
 * @property {number|null} product_active_variant_count
 */

/** Documented child offer ID source for operators/docs. */
export const EBAY_VARIATION_CHILD_OFFER_ID_SOURCE =
  "ebay_listing_inventory_cache.raw_payload_json.offerId";

/**
 * @param {{ productId?: string, variantId?: string }} [params]
 * @returns {Promise<EbayVariationChildCandidateRow|null>}
 */
export async function fetchEbayVariationChildCandidate({ productId, variantId } = {}) {
  const pid = String(productId || "").trim();
  const vid = String(variantId || "").trim();
  if (!pid || !vid) return null;

  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_ebay_variation_sync_candidates")
    .select(VARIATION_CANDIDATE_SELECT)
    .eq("product_id", pid)
    .eq("variant_id", vid)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to load eBay variation candidate");

  return data || null;
}

/**
 * @param {EbayVariationChildCandidateRow|null} candidate
 * @returns {{ ok: boolean, state: string, reason: string, actionable: boolean }}
 */
export function validateVariationChildCandidateForQty(candidate) {
  if (!candidate) {
    return { ok: false, state: "variation_manual", reason: "no_variation_candidate_row", actionable: false };
  }

  const state = candidate.candidate_state || "variation_manual";
  const reason = candidate.candidate_reason || state;
  const manual = new Set([
    "variation_mapping_missing",
    "variation_mapping_ambiguous",
    "variation_child_offer_missing",
    "variation_parent_inactive",
    "variation_manual",
  ]);

  if (manual.has(state)) {
    return { ok: false, state, reason, actionable: false };
  }

  if (state === "variation_no_change") {
    return { ok: true, state, reason, actionable: false };
  }

  if (state === "variation_update_qty") {
    if (candidate.kk_available_qty <= 0) {
      return { ok: false, state: "variation_manual", reason: "kk_available_not_positive", actionable: false };
    }
    if (!candidate.child_offer_id) {
      return { ok: false, state: "variation_child_offer_missing", reason: "missing_child_offer_id", actionable: false };
    }
    return { ok: true, state, reason, actionable: true };
  }

  if (state === "variation_qty_cache_missing") {
    if (!candidate.expected_ebay_sku) {
      return { ok: false, state: "variation_mapping_missing", reason: "cannot_derive_expected_sku", actionable: false };
    }
    return { ok: true, state, reason, actionable: true };
  }

  return { ok: false, state, reason: "unhandled_state", actionable: false };
}
