/**
 * Mapping assist API (Phase 8C — read suggestions + admin apply RPC).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/**
 * @typedef {Object} MappingSuggestionRow
 * @property {string} issueType
 * @property {string} sourceChannel
 * @property {string|null} sourceOrderId
 * @property {string|null} sourceOrderItemId
 * @property {string|null} sourceSku
 * @property {string|null} sourceTitle
 * @property {string|null} sourceAsin
 * @property {string|null} sourceListingId
 * @property {string|null} sourceReason
 * @property {string|null} recommendedAction
 * @property {string|null} suggestedProductId
 * @property {string|null} suggestedVariantId
 * @property {string|null} suggestedProductLabel
 * @property {string|null} suggestedInternalSku
 * @property {string|null} matchType
 * @property {string|null} confidence
 * @property {string|null} confidenceReason
 * @property {boolean} isSafeAutoApply
 * @property {boolean} variantPickRequired
 * @property {string|null} evidenceEbayListingId
 * @property {string|null} evidenceEbayOfferId
 * @property {string|null} evidenceEbaySku
 * @property {string|null} evidenceProductCode
 * @property {string|null} evidenceVariantSuffix
 * @property {string|null} evidenceEbayStatus
 * @property {number|null} evidenceEbayCacheQty
 * @property {number} groupSkuCount
 * @property {number} groupTitleCount
 * @property {number} groupListingCount
 */

/**
 * @param {Record<string, unknown>} row
 * @returns {MappingSuggestionRow}
 */
export function mapSuggestionRow(row) {
  return {
    issueType: String(row.issue_type ?? ""),
    sourceChannel: String(row.source_channel ?? ""),
    sourceOrderId: row.source_order_id ? String(row.source_order_id) : null,
    sourceOrderItemId: row.source_order_item_id ? String(row.source_order_item_id) : null,
    sourceSku: row.source_sku ? String(row.source_sku) : null,
    sourceTitle: row.source_title ? String(row.source_title) : null,
    sourceAsin: row.source_asin ? String(row.source_asin) : null,
    sourceListingId: row.source_listing_id ? String(row.source_listing_id) : null,
    sourceReason: row.source_reason ? String(row.source_reason) : null,
    recommendedAction: row.recommended_action ? String(row.recommended_action) : null,
    suggestedProductId: row.suggested_product_id ? String(row.suggested_product_id) : null,
    suggestedVariantId: row.suggested_variant_id ? String(row.suggested_variant_id) : null,
    suggestedProductLabel: row.suggested_product_label ? String(row.suggested_product_label) : null,
    suggestedInternalSku: row.suggested_internal_sku ? String(row.suggested_internal_sku) : null,
    matchType: row.match_type ? String(row.match_type) : null,
    confidence: row.confidence ? String(row.confidence) : null,
    confidenceReason: row.confidence_reason ? String(row.confidence_reason) : null,
    isSafeAutoApply: Boolean(row.is_safe_auto_apply),
    variantPickRequired: Boolean(row.variant_pick_required),
    evidenceEbayListingId: row.evidence_ebay_listing_id ? String(row.evidence_ebay_listing_id) : null,
    evidenceEbayOfferId: row.evidence_ebay_offer_id ? String(row.evidence_ebay_offer_id) : null,
    evidenceEbaySku: row.evidence_ebay_sku ? String(row.evidence_ebay_sku) : null,
    evidenceProductCode: row.evidence_product_code ? String(row.evidence_product_code) : null,
    evidenceVariantSuffix: row.evidence_variant_suffix ? String(row.evidence_variant_suffix) : null,
    evidenceEbayStatus: row.evidence_ebay_status ? String(row.evidence_ebay_status) : null,
    evidenceEbayCacheQty: row.evidence_ebay_cache_qty != null ? Number(row.evidence_ebay_cache_qty) : null,
    groupSkuCount: Number(row.group_sku_count ?? 0),
    groupTitleCount: Number(row.group_title_count ?? 0),
    groupListingCount: Number(row.group_listing_count ?? 0),
  };
}

/**
 * @param {{ issueType?: string, limit?: number }} [opts]
 * @returns {Promise<MappingSuggestionRow[]>}
 */
export async function fetchMappingSuggestions(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

  let query = sb
    .from("v_inventory_mapping_suggestions")
    .select("*")
    .limit(limit);

  if (opts.issueType) query = query.eq("issue_type", opts.issueType);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapSuggestionRow);
}

/**
 * @param {string} issueType
 * @param {string} sourceOrderId
 * @param {string} sourceOrderItemId
 */
export async function fetchMappingSuggestionForSource(issueType, sourceOrderId, sourceOrderItemId) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  let query = sb.from("v_inventory_mapping_suggestions").select("*").eq("issue_type", issueType);

  if (issueType === "unmapped_order_line") {
    query = query
      .eq("source_order_id", sourceOrderId)
      .eq("source_order_item_id", sourceOrderItemId);
  } else if (issueType === "amazon_mapping_missing") {
    query = query.eq("source_order_item_id", sourceOrderItemId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapSuggestionRow(data) : null;
}

/** @param {{ limit?: number }} [opts] */
export async function fetchEbayUnmappedGroupCounts(opts = {}) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);

  const { data, error } = await sb
    .from("v_inventory_ebay_unmapped_group_counts")
    .select("*")
    .order("line_count", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * @param {string} query
 * @returns {Promise<Array<{ id: string, name: string, code: string, imageUrl: string|null }>>}
 */
export async function searchProductsForMappingAssist(query) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();
  const trimmed = String(query || "").trim();
  if (trimmed.length < 2) return [];

  const safe = trimmed.replace(/[%_,]/g, " ").trim();
  if (!safe) return [];

  const { data, error } = await sb
    .from("products")
    .select("id, name, code, primary_image_url, catalog_image_url")
    .eq("is_active", true)
    .or(`name.ilike.%${safe}%,code.ilike.%${safe}%`)
    .order("name")
    .limit(20);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    code: String(row.code ?? ""),
    imageUrl: row.primary_image_url || row.catalog_image_url || null,
  }));
}

/**
 * @param {string} productId
 */
export async function fetchProductVariantsForMappingAssist(productId) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("product_variants")
    .select("id, product_id, sku, title, option_name, option_value, stock, is_active")
    .eq("product_id", productId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((v) => ({
    id: String(v.id),
    productId: String(v.product_id),
    sku: v.sku ? String(v.sku) : "",
    label: [v.option_name, v.option_value].filter(Boolean).join(" · ") || v.title || v.sku || "Variant",
    stock: Number(v.stock ?? 0),
  }));
}

/**
 * @param {Object} params
 * @param {'order_line_variant'|'amazon_variant_mapping'} params.actionType
 * @param {string} params.issueType
 * @param {string|null} [params.sourceOrderId]
 * @param {string|null} [params.sourceOrderItemId]
 * @param {string|null} [params.amazonListingId]
 * @param {string} params.selectedProductId
 * @param {string} params.selectedVariantId
 * @param {string|null} [params.confidence]
 * @param {string|null} [params.note]
 */
export async function applyMappingAssist(params) {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const selectedProductId = params.selectedProductId || null;

  const { data, error } = await sb.rpc("apply_inventory_mapping_assist", {
    p_action_type: params.actionType,
    p_issue_type: params.issueType,
    p_source_order_id: params.sourceOrderId ?? null,
    p_source_order_item_id: params.sourceOrderItemId ?? null,
    p_amazon_listing_id: params.amazonListingId ?? null,
    p_selected_product_id: selectedProductId,
    p_selected_variant_id: params.selectedVariantId,
    p_confidence: params.confidence ?? null,
    p_note: params.note ?? null,
  });

  if (error) throw new Error(error.message || "Mapping assist apply failed");
  if (!data?.ok) throw new Error("Mapping assist apply failed");
  return data;
}
