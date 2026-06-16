/**
 * eBay ended-listing relist assist (Phase 7E) — read candidates + audit log only.
 * No eBay publish/relist edge calls from this module.
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

const SELECT_COLS =
  "variant_id, product_id, product_label, internal_sku, product_code, ebay_sku, old_ebay_listing_id, old_ebay_offer_id, old_status, available_qty, on_hand, reserved, suggested_qty, last_seen_status, last_cache_sync_at, relist_action, required_fields_missing, ebay_item_group_key, ebay_category_id, ebay_price_cents, product_active_variant_count";

/**
 * @typedef {Object} EbayRelistCandidateRow
 * @property {string} variant_id
 * @property {string} product_id
 * @property {string|null} product_label
 * @property {string|null} internal_sku
 * @property {string|null} product_code
 * @property {string|null} ebay_sku
 * @property {string|null} old_ebay_listing_id
 * @property {string|null} old_ebay_offer_id
 * @property {string|null} old_status
 * @property {number} available_qty
 * @property {number} on_hand
 * @property {number} reserved
 * @property {number} suggested_qty
 * @property {string|null} last_seen_status
 * @property {string|null} last_cache_sync_at
 * @property {string} relist_action
 * @property {string[]|null} required_fields_missing
 */

/**
 * @typedef {Object} EbayRelistSummary
 * @property {number} total
 * @property {number} readyToRelist
 * @property {number} noAvailableStock
 * @property {number} unsupportedVariation
 * @property {number} needsMapping
 * @property {number} missingData
 * @property {number} manualReview
 */

/** @param {EbayRelistCandidateRow[]} rows @returns {EbayRelistSummary} */
export function summarizeRelistCandidates(rows) {
  const count = (action) => rows.filter((r) => r.relist_action === action).length;
  return {
    total: rows.length,
    readyToRelist: count("ready_to_relist"),
    noAvailableStock: count("no_available_stock"),
    unsupportedVariation: count("unsupported_variation"),
    needsMapping: count("needs_mapping"),
    missingData: count("missing_required_listing_data"),
    manualReview: count("manual_review"),
  };
}

/** @returns {Promise<EbayRelistCandidateRow[]>} */
export async function fetchEbayRelistCandidates() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_ebay_relist_candidates")
    .select(SELECT_COLS)
    .order("relist_action", { ascending: true })
    .order("internal_sku", { ascending: true });

  if (error) throw new Error(error.message || "Failed to load eBay relist candidates");
  return data || [];
}

/**
 * Log an assist action (audit only).
 * @param {Object} payload
 * @param {string} payload.productId
 * @param {string} [payload.variantId]
 * @param {string|null} [payload.oldEbayListingId]
 * @param {'opened_admin'|'marked_review'|'draft_created'|'relist_attempted'} payload.actionType
 * @param {string} [payload.status]
 * @param {string} [payload.notes]
 */
export async function logEbayRelistAssistAction(payload) {
  const session = await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const row = {
    product_id: payload.productId,
    variant_id: payload.variantId || null,
    old_ebay_listing_id: payload.oldEbayListingId || null,
    action_type: payload.actionType,
    status: payload.status || "logged",
    notes: payload.notes || null,
    created_by: session.user?.id || null,
  };

  const { error } = await sb.from("ebay_relist_assist_actions").insert(row);
  if (error) throw new Error(error.message || "Failed to log relist assist action");
}

/** @param {string|null|undefined} listingId */
export function ebayPublicListingUrl(listingId) {
  const id = String(listingId || "").trim();
  return id ? `https://www.ebay.com/itm/${encodeURIComponent(id)}` : null;
}

/** @param {string|null|undefined} listingId */
export function ebaySellSimilarUrl(listingId) {
  const id = String(listingId || "").trim();
  return id ? `https://www.ebay.com/sl/list?mode=SellLikeItem&itemId=${encodeURIComponent(id)}` : null;
}

/** @param {string|null|undefined} productCode */
export function kkEbayListingsAdminUrl(productCode) {
  const code = String(productCode || "").trim();
  const base = "/pages/admin/ebay-listings.html";
  return code ? `${base}?relist=${encodeURIComponent(code)}` : base;
}
