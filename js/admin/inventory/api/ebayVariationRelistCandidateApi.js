/**
 * Read-only eBay variation group relist candidate API (Phase 060B.2).
 * Does not call eBay APIs, relist edges, or Adjust orchestration.
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

const RELIST_CANDIDATE_SELECT = [
  "product_id",
  "product_code",
  "title",
  "ebay_item_group_key",
  "old_ebay_listing_id",
  "parent_listing_status",
  "ebay_category_id",
  "condition_id",
  "has_images",
  "image_count",
  "has_category",
  "has_policy_data",
  "has_required_aspects",
  "has_variation_options",
  "variation_option_name",
  "variant_count",
  "in_stock_child_count",
  "out_of_stock_child_count",
  "mapped_child_count",
  "ambiguous_child_count",
  "missing_child_count",
  "child_skus",
  "in_stock_child_skus",
  "missing_child_skus",
  "conflict_child_skus",
  "child_payload_json",
  "candidate_state",
  "candidate_reason",
  "is_actionable",
  "requires_manual_review",
  "mapping_confidence",
].join(",");

/**
 * @typedef {Object} VariationGroupRelistChildPayloadRow
 * @property {string} variantId
 * @property {string|null} sku
 * @property {string|null} optionValue
 * @property {number} availableQty
 * @property {boolean} includeInRelist
 * @property {string|null} previousOfferId
 * @property {number|null} previousEbayQty
 * @property {string} mappingState
 */

/**
 * @typedef {Object} EbayVariationGroupRelistCandidateRow
 * @property {string} product_id
 * @property {string|null} product_code
 * @property {string|null} title
 * @property {string|null} ebay_item_group_key
 * @property {string|null} old_ebay_listing_id
 * @property {string|null} parent_listing_status
 * @property {string|null} ebay_category_id
 * @property {string|null} condition_id
 * @property {boolean} has_images
 * @property {number} image_count
 * @property {boolean} has_category
 * @property {boolean} has_policy_data
 * @property {boolean} has_required_aspects
 * @property {boolean} has_variation_options
 * @property {string|null} variation_option_name
 * @property {number} variant_count
 * @property {number} in_stock_child_count
 * @property {number} out_of_stock_child_count
 * @property {number} mapped_child_count
 * @property {number} ambiguous_child_count
 * @property {number} missing_child_count
 * @property {string[]|null} child_skus
 * @property {string[]|null} in_stock_child_skus
 * @property {string[]|null} missing_child_skus
 * @property {string[]|null} conflict_child_skus
 * @property {VariationGroupRelistChildPayloadRow[]} child_payload_json
 * @property {string} candidate_state
 * @property {string|null} candidate_reason
 * @property {boolean} is_actionable
 * @property {boolean} requires_manual_review
 * @property {string|null} mapping_confidence
 */

/** Documented metadata gaps (aspects/policies not fully in DB). */
export const EBAY_VARIATION_RELIST_METADATA_GAPS = [
  "has_policy_data is false in view — policies validated at edge publish time",
  "has_required_aspects is false in view — aspect matrix not persisted on products",
];

/**
 * @param {{ productId?: string }} [params]
 * @returns {Promise<EbayVariationGroupRelistCandidateRow|null>}
 */
export async function fetchEbayVariationRelistCandidate({ productId } = {}) {
  const pid = String(productId || "").trim();
  if (!pid) return null;

  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_ebay_variation_relist_candidates")
    .select(RELIST_CANDIDATE_SELECT)
    .eq("product_id", pid)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to load eBay variation relist candidate");

  return data || null;
}

/**
 * @param {EbayVariationGroupRelistCandidateRow|null} candidate
 * @returns {{ ok: boolean, state: string, reason: string, actionable: boolean, manual: boolean }}
 */
export function validateVariationGroupRelistCandidate(candidate) {
  if (!candidate) {
    return {
      ok: false,
      state: "variation_group_manual",
      reason: "no_variation_group_relist_candidate_row",
      actionable: false,
      manual: true,
    };
  }

  const state = candidate.candidate_state || "variation_group_manual";
  const reason = candidate.candidate_reason || state;
  const skip = new Set(["variation_group_active", "variation_group_no_change"]);
  const manual = new Set([
    "variation_group_missing_metadata",
    "variation_group_missing_aspects",
    "variation_group_missing_images",
    "variation_group_mapping_missing",
    "variation_group_mapping_ambiguous",
    "variation_group_child_offer_conflict",
    "variation_group_no_in_stock_children",
    "variation_group_unsupported_structure",
    "variation_group_manual",
  ]);
  const actionable = new Set([
    "variation_group_ready_to_relist",
    "variation_group_relist_dry_run_ready",
  ]);

  if (skip.has(state)) {
    return { ok: true, state, reason, actionable: false, manual: false };
  }
  if (manual.has(state) || candidate.requires_manual_review) {
    return { ok: false, state, reason, actionable: false, manual: true };
  }
  if (!actionable.has(state)) {
    return { ok: false, state, reason: "unsupported_state", actionable: false, manual: true };
  }
  if (candidate.in_stock_child_count <= 0) {
    return {
      ok: false,
      state: "variation_group_no_in_stock_children",
      reason: "no_in_stock_children",
      actionable: false,
      manual: true,
    };
  }
  if (!candidate.has_required_aspects) {
    return {
      ok: false,
      state: "variation_group_missing_aspects",
      reason: "aspects_unknown_in_db",
      actionable: false,
      manual: true,
    };
  }
  if (!candidate.has_policy_data) {
    return {
      ok: false,
      state: "variation_group_missing_metadata",
      reason: "policy_data_unknown_in_db",
      actionable: false,
      manual: true,
    };
  }
  if (candidate.mapped_child_count < candidate.variant_count) {
    return {
      ok: false,
      state: "variation_group_mapping_missing",
      reason: "incomplete_child_mapping",
      actionable: false,
      manual: true,
    };
  }
  return { ok: true, state, reason, actionable: true, manual: false };
}
