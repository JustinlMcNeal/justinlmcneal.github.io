/**
 * Bundle/component preview API (Phase 10A–10B).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/** @typedef {Object} VariantSearchResult
 * @property {string} variantId
 * @property {string} productTitle
 * @property {string} variantLabel
 * @property {string|null} internalSku
 * @property {number} onHand
 * @property {number} reserved
 * @property {number} available
 * @property {boolean} isActive
 */

/** @typedef {Object} BundleLikeVariant
 * @property {string} variantId
 * @property {string} productLabel
 * @property {string} variantLabel
 * @property {string|null} internalSku
 * @property {number} onHand
 * @property {string} detectionReason
 * @property {boolean} onEbay
 * @property {boolean} onAmazon
 * @property {boolean} hasVirtualRules
 */

/** @typedef {Object} BundleSummaryPreview
 * @property {string} bundleVariantId
 * @property {string} bundleLabel
 * @property {string} bundleSku
 * @property {number} bundleOnHand
 * @property {number} bundleReserved
 * @property {number} bundleAvailable
 * @property {string} currentModel
 * @property {number} componentCount
 * @property {number|null} virtualBundleAvailable
 * @property {string|null} limitingComponentLabel
 * @property {string} previewWarning
 * @property {string} previewStatus
 * @property {boolean} hasIndependentStockWarning
 * @property {number|null} virtualVsStockedDelta
 * @property {string} detectionReason
 * @property {boolean} onEbay
 * @property {boolean} onAmazon
 */

/** @typedef {Object} BundleAvailabilityPreview
 * @property {string} ruleId
 * @property {string} bundleVariantId
 * @property {string} componentVariantId
 * @property {number} componentQty
 * @property {string} previewStatus
 * @property {number|null} virtualBundleAvailable
 * @property {boolean} limitingComponent
 * @property {string} bundleProductLabel
 * @property {string} componentProductLabel
 * @property {number} bundleAvailable
 * @property {number} componentAvailable
 * @property {boolean} isActive
 * @property {string|null} notes
 */

/** @param {Record<string, unknown>} row @returns {VariantSearchResult} */
export function mapVariantSearchRow(row) {
  return {
    variantId: String(row.variant_id ?? ""),
    productTitle: String(row.product_title ?? ""),
    variantLabel: String(row.variant_label ?? ""),
    internalSku: row.internal_sku ? String(row.internal_sku) : null,
    onHand: Number(row.on_hand ?? 0),
    reserved: Number(row.reserved ?? 0),
    available: Number(row.available ?? 0),
    isActive: String(row.status ?? "active") !== "inactive",
  };
}

/** @param {Record<string, unknown>} row @returns {BundleLikeVariant} */
export function mapBundleLikeVariant(row) {
  return {
    variantId: String(row.variant_id ?? ""),
    productLabel: String(row.product_label ?? ""),
    variantLabel: String(row.variant_label ?? ""),
    internalSku: row.internal_sku ? String(row.internal_sku) : null,
    onHand: Number(row.on_hand ?? 0),
    detectionReason: String(row.detection_reason ?? ""),
    onEbay: Boolean(row.on_ebay),
    onAmazon: Boolean(row.on_amazon),
    hasVirtualRules: Boolean(row.has_virtual_rules),
  };
}

/** @param {Record<string, unknown>} row @returns {BundleSummaryPreview} */
export function mapBundleSummaryPreview(row) {
  return {
    bundleVariantId: String(row.bundle_variant_id ?? ""),
    bundleLabel: String(row.bundle_label ?? ""),
    bundleSku: String(row.bundle_sku ?? ""),
    bundleOnHand: Number(row.bundle_on_hand ?? 0),
    bundleReserved: Number(row.bundle_reserved ?? 0),
    bundleAvailable: Number(row.bundle_available ?? 0),
    currentModel: String(row.current_model ?? "model_a_separate_stocked"),
    componentCount: Number(row.component_count ?? 0),
    virtualBundleAvailable:
      row.virtual_bundle_available == null ? null : Number(row.virtual_bundle_available),
    limitingComponentLabel: row.limiting_component_label
      ? String(row.limiting_component_label)
      : null,
    previewWarning: String(row.preview_warning ?? ""),
    previewStatus: String(row.preview_status ?? "no_rules"),
    hasIndependentStockWarning: Boolean(row.has_independent_stock_warning),
    virtualVsStockedDelta:
      row.virtual_vs_stocked_delta == null ? null : Number(row.virtual_vs_stocked_delta),
    detectionReason: String(row.detection_reason ?? ""),
    onEbay: Boolean(row.on_ebay),
    onAmazon: Boolean(row.on_amazon),
  };
}

/** @param {Record<string, unknown>} row @returns {BundleAvailabilityPreview} */
export function mapBundleAvailabilityPreview(row) {
  return {
    ruleId: String(row.rule_id ?? ""),
    bundleVariantId: String(row.bundle_variant_id ?? ""),
    componentVariantId: String(row.component_variant_id ?? ""),
    componentQty: Number(row.component_qty ?? 0),
    previewStatus: String(row.preview_status ?? ""),
    virtualBundleAvailable:
      row.virtual_bundle_available == null ? null : Number(row.virtual_bundle_available),
    limitingComponent: Boolean(row.limiting_component),
    bundleProductLabel: String(row.bundle_product_label ?? ""),
    componentProductLabel: String(row.component_product_label ?? ""),
    bundleAvailable: Number(row.bundle_available ?? 0),
    componentAvailable: Number(row.component_available ?? 0),
    isActive: Boolean(row.is_active),
    notes: row.notes ? String(row.notes) : null,
  };
}

/** @param {string} query @param {number} [limit] */
export async function searchInventoryVariants(query, limit = 20) {
  await requireAuthenticatedSession();
  const q = String(query || "").trim();
  if (q.length < 2) return [];

  const safe = q.replace(/[%_,]/g, " ").trim();
  if (!safe) return [];

  const { data, error } = await getSupabaseClient()
    .from("v_inventory_workspace")
    .select("variant_id, product_title, variant_label, internal_sku, on_hand, reserved, available, status")
    .or(`product_title.ilike.%${safe}%,internal_sku.ilike.%${safe}%,variant_label.ilike.%${safe}%`)
    .order("product_title")
    .limit(Math.min(limit, 25));

  if (error) throw new Error(error.message);
  return (data ?? []).map(mapVariantSearchRow);
}

/** @param {string} variantId */
export async function fetchVariantSearchById(variantId) {
  const { data, error } = await getSupabaseClient()
    .from("v_inventory_workspace")
    .select("variant_id, product_title, variant_label, internal_sku, on_hand, reserved, available, status")
    .eq("variant_id", variantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapVariantSearchRow(data) : null;
}

/** @returns {Promise<{ likeVariants: BundleLikeVariant[], summaries: BundleSummaryPreview[], availability: BundleAvailabilityPreview[] }>} */
export async function fetchBundlePreviewData() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const [likeRes, summaryRes, availRes] = await Promise.all([
    sb.from("v_inventory_bundle_like_variants").select("*").order("product_label").limit(50),
    sb.from("v_inventory_bundle_summary_preview").select("*").order("bundle_label").limit(50),
    sb.from("v_inventory_bundle_availability_preview").select("*").order("bundle_product_label").limit(100),
  ]);

  if (likeRes.error) throw new Error(likeRes.error.message);
  if (summaryRes.error) throw new Error(summaryRes.error.message);
  if (availRes.error) throw new Error(availRes.error.message);

  return {
    likeVariants: (likeRes.data ?? []).map(mapBundleLikeVariant),
    summaries: (summaryRes.data ?? []).map(mapBundleSummaryPreview),
    availability: (availRes.data ?? []).map(mapBundleAvailabilityPreview),
  };
}

/** @param {Object} input */
export async function upsertBundleRule(input) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("upsert_inventory_bundle_rule", {
    p_bundle_variant_id: input.bundleVariantId,
    p_component_variant_id: input.componentVariantId,
    p_component_qty: input.componentQty,
    p_rule_type: input.ruleType ?? "virtual_bundle",
    p_is_active: input.isActive ?? true,
    p_notes: input.notes ?? null,
    p_rule_id: input.ruleId ?? null,
  });
  if (error) throw new Error(error.message || "Failed to save bundle rule");
  return data;
}

/** @param {string} ruleId @param {boolean} isActive */
export async function setBundleRuleActive(ruleId, isActive) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("set_inventory_bundle_rule_active", {
    p_rule_id: ruleId,
    p_is_active: isActive,
  });
  if (error) throw new Error(error.message || "Failed to update rule status");
  return data;
}

/** @param {string} ruleId */
export async function deleteBundleRule(ruleId) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient().rpc("delete_inventory_bundle_rule", {
    p_rule_id: ruleId,
  });
  if (error) throw new Error(error.message || "Failed to delete rule");
  return data;
}

/** @returns {Promise<{ ruleCount: number, likeCount: number, summaryCount: number, virtualCount: number }>} */
export async function fetchBundlePreviewCounts() {
  const data = await fetchBundlePreviewData();
  return {
    ruleCount: data.availability.length,
    likeCount: data.likeVariants.length,
    summaryCount: data.summaries.length,
    virtualCount: data.summaries.filter((s) => s.currentModel === "model_b_virtual_preview").length,
  };
}

/**
 * Client-side validation before save (returns errors; warnings are non-blocking).
 * @param {Object} input
 * @param {import('../ui/bundleVariantPicker.js').VariantPickerSelection|null} bundle
 * @param {import('../ui/bundleVariantPicker.js').VariantPickerSelection|null} component
 */
export function validateBundleRuleInput(input, bundle, component) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  if (!input.bundleVariantId) errors.push("Bundle variant is required.");
  if (!input.componentVariantId) errors.push("Component variant is required.");
  if (!Number.isFinite(input.componentQty) || input.componentQty <= 0) {
    errors.push("Component quantity must be greater than zero.");
  }
  if (
    input.bundleVariantId &&
    input.componentVariantId &&
    input.bundleVariantId === input.componentVariantId
  ) {
    errors.push("Bundle and component must be different variants.");
  }
  if (bundle && bundle.onHand > 0) {
    warnings.push(
      `Bundle variant has ${bundle.onHand} on-hand — Model A stock will remain until Phase 10C cutover.`,
    );
  }
  if (component && !component.isActive) {
    warnings.push("Component variant appears inactive.");
  }
  if (component && component.available <= 0) {
    warnings.push("Component available is zero or negative in preview.");
  }

  return { errors, warnings };
}
