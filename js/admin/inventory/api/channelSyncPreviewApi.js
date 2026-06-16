/**
 * Read-only channel sync dry-run aggregates (Phase 7A).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

const SELECT_COLS =
  "variant_id, internal_sku, product_label, available_qty, on_hand_qty, reserved_qty, kk_sync_action, ebay_sync_action, amazon_sync_action, ebay_listing_status, amazon_listing_status, ebay_current_qty, issue_flags";

/**
 * @typedef {Object} ChannelSyncPreviewSummary
 * @property {number} totalVariants
 * @property {number} kkAlign
 * @property {number} amazonUpdate
 * @property {number} amazonAfnSkip
 * @property {number} amazonMissing
 * @property {number} ebayEnded
 * @property {number} ebayQtyCacheMissing
 * @property {number} ebayQtyUnknown
 * @property {number} ebayUpdate
 * @property {number} ebayUnsupported
 * @property {number} ebayCachePresent
 * @property {number} ebayMissing
 * @property {number} negativeAvailable
 * @property {number} zeroQtyCandidates
 * @property {number} readyToSync
 * @property {number} ebayCacheTableRows
 * @property {Object[]} samples
 */

/** @param {Record<string, unknown>[]} rows */
function summarizeRows(rows) {
  const amazonUpdate = rows.filter((r) => r.amazon_sync_action === "update_qty").length;
  const ebayUpdate = rows.filter((r) => r.ebay_sync_action === "update_qty").length;
  const kkAlign = rows.filter((r) => r.kk_sync_action === "align_to_available").length;

  return {
    totalVariants: rows.length,
    kkAlign,
    amazonUpdate,
    amazonAfnSkip: rows.filter((r) => r.amazon_sync_action === "afn_skip").length,
    amazonMissing: rows.filter((r) => r.amazon_sync_action === "missing_mapping").length,
    ebayEnded: rows.filter((r) => r.ebay_sync_action === "ended_needs_relist").length,
    ebayQtyCacheMissing: rows.filter((r) => r.ebay_sync_action === "qty_cache_missing").length,
    ebayQtyUnknown: rows.filter((r) => r.ebay_sync_action === "qty_cache_missing").length,
    ebayUpdate,
    ebayUnsupported: rows.filter((r) => r.ebay_sync_action === "unsupported_variation").length,
    ebayCachePresent: rows.filter((r) => r.ebay_current_qty != null).length,
    ebayMissing: rows.filter((r) => r.ebay_sync_action === "missing_mapping").length,
    ebayCacheTableRows: 0,
    negativeAvailable: rows.filter((r) => r.kk_sync_action === "negative_available").length,
    zeroQtyCandidates: rows.filter(
      (r) =>
        r.available_qty === 0 &&
        (r.amazon_sync_action === "update_qty" ||
          r.ebay_sync_action === "update_qty" ||
          r.kk_sync_action === "align_to_available"),
    ).length,
    readyToSync: amazonUpdate + ebayUpdate + kkAlign,
    samples: rows
      .filter(
        (r) =>
          r.amazon_sync_action === "update_qty" ||
          r.ebay_sync_action === "ended_needs_relist" ||
          r.ebay_sync_action === "qty_cache_missing" ||
          r.ebay_sync_action === "unsupported_variation" ||
          r.ebay_sync_action === "update_qty" ||
          r.kk_sync_action === "align_to_available" ||
          (r.issue_flags?.length ?? 0) > 0,
      )
      .slice(0, 12),
  };
}

/** @returns {Promise<ChannelSyncPreviewSummary>} */
export async function fetchChannelSyncPreview() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const [{ data, error }, cacheCountRes] = await Promise.all([
    sb.from("v_inventory_channel_sync_candidates").select(SELECT_COLS),
    sb.from("ebay_listing_inventory_cache").select("id", { count: "exact", head: true }),
  ]);

  if (error) throw new Error(error.message || "Failed to load sync preview");
  const summary = summarizeRows(data || []);
  summary.ebayCacheTableRows = cacheCountRes.count ?? 0;
  return summary;
}

const AMAZON_PUSH_SELECT =
  "variant_id, product_id, internal_sku, product_label, available_qty, available_qty_nonneg, amazon_listing_id, amazon_seller_sku, amazon_current_qty, amazon_sync_action";

/**
 * @typedef {Object} AmazonPushCandidateRow
 * @property {string} variant_id
 * @property {string} product_id
 * @property {string|null} internal_sku
 * @property {string|null} product_label
 * @property {number} available_qty
 * @property {number} available_qty_nonneg
 * @property {string} amazon_listing_id
 * @property {string|null} amazon_seller_sku
 * @property {number|null} amazon_current_qty
 */

/** Amazon FBM push candidates (update_qty only). @returns {Promise<AmazonPushCandidateRow[]>} */
export async function fetchAmazonPushCandidates() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_channel_sync_candidates")
    .select(AMAZON_PUSH_SELECT)
    .eq("amazon_sync_action", "update_qty")
    .not("amazon_listing_id", "is", null)
    .order("internal_sku", { ascending: true });

  if (error) throw new Error(error.message || "Failed to load Amazon candidates");
  return (data || []).filter((r) => String(r.amazon_seller_sku || "").trim());
}

const EBAY_PUSH_SELECT =
  "variant_id, product_id, internal_sku, product_label, available_qty, available_qty_nonneg, ebay_sku, ebay_offer_id, ebay_listing_id, ebay_current_qty, ebay_listing_status, ebay_sync_action, ebay_item_group_key, product_active_variant_count";

const EBAY_ENDED_STATUSES = new Set(["ended", "out_of_stock", "withdrawn", "inactive"]);

/**
 * @typedef {Object} EbayPushCandidateRow
 * @property {string} variant_id
 * @property {string} product_id
 * @property {string|null} internal_sku
 * @property {string|null} product_label
 * @property {number} available_qty
 * @property {number} available_qty_nonneg
 * @property {string|null} ebay_sku
 * @property {string|null} ebay_offer_id
 * @property {string|null} ebay_listing_id
 * @property {number|null} ebay_current_qty
 * @property {string|null} ebay_listing_status
 */

/** eBay active qty push candidates (update_qty + confident mapping). @returns {Promise<EbayPushCandidateRow[]>} */
export async function fetchEbayPushCandidates() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_channel_sync_candidates")
    .select(EBAY_PUSH_SELECT)
    .eq("ebay_sync_action", "update_qty")
    .not("ebay_current_qty", "is", null)
    .not("ebay_offer_id", "is", null)
    .not("ebay_listing_id", "is", null)
    .order("internal_sku", { ascending: true });

  if (error) throw new Error(error.message || "Failed to load eBay push candidates");

  return (data || []).filter((r) => {
    const sku = String(r.ebay_sku || r.internal_sku || "").trim();
    if (!sku) return false;
    const status = String(r.ebay_listing_status || "").toLowerCase();
    if (EBAY_ENDED_STATUSES.has(status)) return false;
    if (r.ebay_item_group_key && Number(r.product_active_variant_count || 0) > 1) return false;
    return r.ebay_sync_action === "update_qty" && r.ebay_current_qty != null;
  });
}
