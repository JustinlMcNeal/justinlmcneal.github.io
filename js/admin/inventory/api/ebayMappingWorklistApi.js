/**
 * eBay mapping worklist API (Phase 8H — read + selected batch apply).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/**
 * @typedef {Object} EbayMappingWorklistGroup
 * @property {string} groupKey
 * @property {string} groupType
 * @property {string} sourceChannel
 * @property {string|null} sourceSku
 * @property {string|null} sourceTitle
 * @property {string|null} ebayListingId
 * @property {number} rowCount
 * @property {number} shippedCount
 * @property {number} unshippedCount
 * @property {number} totalQty
 * @property {number} highConfidenceCount
 * @property {number} mediumConfidenceCount
 * @property {number} manualVariantPickCount
 * @property {number} noSuggestionCount
 * @property {string|null} suggestedProductId
 * @property {string|null} suggestedVariantId
 * @property {string|null} suggestedProductLabel
 * @property {string|null} suggestedInternalSku
 * @property {string|null} confidence
 * @property {string|null} confidenceReason
 * @property {boolean} variantPickRequired
 * @property {string} recommendedAction
 */

/**
 * @typedef {Object} EbayMappingWorklistLine
 * @property {string} groupType
 * @property {string} groupKey
 * @property {string} sourceOrderId
 * @property {string} sourceOrderItemId
 * @property {string|null} sourceSku
 * @property {string|null} sourceTitle
 * @property {number} quantity
 * @property {string|null} matchType
 * @property {string|null} confidence
 * @property {string|null} confidenceReason
 * @property {boolean} variantPickRequired
 * @property {string|null} suggestedProductId
 * @property {string|null} suggestedVariantId
 * @property {string|null} suggestedProductLabel
 * @property {string|null} suggestedInternalSku
 * @property {string|null} fulfillmentStatus
 * @property {boolean} isShipped
 */

/** @param {Record<string, unknown>} row @returns {EbayMappingWorklistGroup} */
export function mapWorklistGroup(row) {
  return {
    groupKey: String(row.group_key ?? ""),
    groupType: String(row.group_type ?? ""),
    sourceChannel: String(row.source_channel ?? "ebay"),
    sourceSku: row.source_sku ? String(row.source_sku) : null,
    sourceTitle: row.source_title ? String(row.source_title) : null,
    ebayListingId: row.ebay_listing_id ? String(row.ebay_listing_id) : null,
    rowCount: Number(row.row_count ?? 0),
    shippedCount: Number(row.shipped_count ?? 0),
    unshippedCount: Number(row.unshipped_count ?? 0),
    totalQty: Number(row.total_qty ?? 0),
    highConfidenceCount: Number(row.high_confidence_count ?? 0),
    mediumConfidenceCount: Number(row.medium_confidence_count ?? 0),
    manualVariantPickCount: Number(row.manual_variant_pick_count ?? 0),
    noSuggestionCount: Number(row.no_suggestion_count ?? 0),
    suggestedProductId: row.suggested_product_id ? String(row.suggested_product_id) : null,
    suggestedVariantId: row.suggested_variant_id ? String(row.suggested_variant_id) : null,
    suggestedProductLabel: row.suggested_product_label ? String(row.suggested_product_label) : null,
    suggestedInternalSku: row.suggested_internal_sku ? String(row.suggested_internal_sku) : null,
    confidence: row.confidence ? String(row.confidence) : null,
    confidenceReason: row.confidence_reason ? String(row.confidence_reason) : null,
    variantPickRequired: Boolean(row.variant_pick_required),
    recommendedAction: String(row.recommended_action ?? "manual_search"),
  };
}

/** @param {Record<string, unknown>} row @returns {EbayMappingWorklistLine} */
export function mapWorklistLine(row) {
  return {
    groupType: String(row.group_type ?? ""),
    groupKey: String(row.group_key ?? ""),
    sourceOrderId: String(row.source_order_id ?? ""),
    sourceOrderItemId: String(row.source_order_item_id ?? ""),
    sourceSku: row.source_sku ? String(row.source_sku) : null,
    sourceTitle: row.source_title ? String(row.source_title) : null,
    quantity: Number(row.quantity ?? 0),
    matchType: row.match_type ? String(row.match_type) : null,
    confidence: row.confidence ? String(row.confidence) : null,
    confidenceReason: row.confidence_reason ? String(row.confidence_reason) : null,
    variantPickRequired: Boolean(row.variant_pick_required),
    suggestedProductId: row.suggested_product_id ? String(row.suggested_product_id) : null,
    suggestedVariantId: row.suggested_variant_id ? String(row.suggested_variant_id) : null,
    suggestedProductLabel: row.suggested_product_label ? String(row.suggested_product_label) : null,
    suggestedInternalSku: row.suggested_internal_sku ? String(row.suggested_internal_sku) : null,
    fulfillmentStatus: row.fulfillment_status ? String(row.fulfillment_status) : null,
    isShipped: Boolean(row.is_shipped),
  };
}

/** @param {{ limit?: number }} [opts] */
export async function fetchEbayMappingWorklist(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

  const { data, error } = await sb
    .from("v_inventory_ebay_mapping_worklist")
    .select("*")
    .order("row_count", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapWorklistGroup);
}

/** @param {string} groupType @param {string} groupKey */
export async function fetchEbayMappingWorklistLines(groupType, groupKey) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_ebay_mapping_worklist_lines")
    .select("*")
    .eq("group_type", groupType)
    .eq("group_key", groupKey)
    .order("source_order_id", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapWorklistLine);
}

/**
 * @param {Object} params
 * @param {Array<{ sourceOrderId: string, sourceOrderItemId: string }>} params.lines
 * @param {string|null} [params.groupType]
 * @param {string|null} [params.groupKey]
 * @param {string} params.selectedProductId
 * @param {string} params.selectedVariantId
 * @param {string|null} [params.confidence]
 * @param {string|null} [params.note]
 */
export async function applyEbayMappingBatch(params) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const payload = params.lines.map((l) => ({
    source_order_id: l.sourceOrderId,
    source_order_item_id: l.sourceOrderItemId,
  }));

  const { data, error } = await sb.rpc("apply_inventory_mapping_assist_batch", {
    p_lines: payload,
    p_group_type: params.groupType ?? null,
    p_group_key: params.groupKey ?? null,
    p_selected_product_id: params.selectedProductId,
    p_selected_variant_id: params.selectedVariantId,
    p_confidence: params.confidence ?? "manual",
    p_note: params.note ?? null,
  });

  if (error) throw new Error(error.message || "Batch mapping failed");
  if (!data?.ok) throw new Error("Batch mapping failed");
  return data;
}

/** @returns {Promise<number>} */
export async function countEbayMappingWorklistGroups() {
  const rows = await fetchEbayMappingWorklist({ limit: 100 });
  return rows.length;
}
