/**
 * eBay variation group relist — structural validation + metadata resolution (Phase 060B.3).
 */

import {
  fetchInventoryItemAspects,
  normalizeProductAspects,
  buildImageUrlsFromProduct,
  wrapDescription,
} from "./ebayListingPublishUtils.ts";
import { loadProductForRelist } from "./ebayRelistCandidateLoaders.ts";
import type {
  EbayVariationGroupRelistCandidate,
  VariationGroupRelistChildPayload,
} from "./ebayVariationGroupRelistCandidateLoaders.ts";

export type EbayBusinessPolicies = {
  fulfillmentPolicyId: string;
  returnPolicyId: string;
  paymentPolicyId: string;
};

export type ResolvedGroupMetadata = {
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  imageUrls: string[];
  groupKey: string;
  variationOptionName: string;
  policies: EbayBusinessPolicies;
  groupAspects: Record<string, unknown>;
  metadataSources: string[];
  warnings: string[];
};

export type ChildRelistPlan = {
  variantId: string;
  sku: string;
  optionValue: string | null;
  quantity: number;
  includeInRelist: boolean;
  aspects: Record<string, unknown>;
  mappingState: string;
  previousOfferId: string | null;
};

export type GroupRelistPlan = {
  productId: string;
  productCode: string;
  groupKey: string;
  oldListingId: string | null;
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  imageUrls: string[];
  priceCents: number;
  variationOptionName: string;
  groupAspects: Record<string, unknown>;
  variesBy: Record<string, unknown>;
  children: ChildRelistPlan[];
  allVariantSkus: string[];
  variantQuantities: Record<string, number>;
  policies: EbayBusinessPolicies;
  metadataSources: string[];
  warnings: string[];
};

const SKIP_STATES = new Set(["variation_group_active", "variation_group_no_change"]);

export function validateStructuralGroupCandidate(
  candidate: EbayVariationGroupRelistCandidate | null,
): { ok: boolean; status: string; reason: string; manual: boolean; skipped: boolean } {
  if (!candidate) {
    return { ok: false, status: "manual", reason: "no_variation_group_relist_candidate_row", manual: true, skipped: false };
  }
  const state = candidate.candidate_state || "variation_group_manual";
  const reason = candidate.candidate_reason || state;

  if (SKIP_STATES.has(state)) {
    return { ok: true, status: "skipped", reason, manual: false, skipped: true };
  }

  if (state === "variation_group_no_in_stock_children" || candidate.in_stock_child_count <= 0) {
    return { ok: false, status: "skipped", reason: "no_child_with_positive_kk_available", manual: false, skipped: true };
  }

  if (candidate.variant_count < 2 || !candidate.ebay_item_group_key) {
    return { ok: false, status: "manual", reason: "requires_multi_variant_group", manual: true, skipped: false };
  }

  if (candidate.ambiguous_child_count > 0) {
    return { ok: false, status: "manual", reason: "ambiguous_child_mappings", manual: true, skipped: false };
  }

  if (candidate.conflict_child_skus?.length) {
    return { ok: false, status: "manual", reason: "child_sku_conflicts", manual: true, skipped: false };
  }

  if (candidate.missing_child_count > 0 || candidate.mapped_child_count < candidate.variant_count) {
    return { ok: false, status: "manual", reason: "not_all_children_mapped_cleanly", manual: true, skipped: false };
  }

  if (!candidate.has_category || !candidate.has_images || !candidate.has_variation_options) {
    return { ok: false, status: "manual", reason: candidate.candidate_reason || "incomplete_group_metadata", manual: true, skipped: false };
  }

  const children = candidate.child_payload_json || [];
  if (!children.length || children.length < candidate.variant_count) {
    return { ok: false, status: "manual", reason: "incomplete_child_payload_json", manual: true, skipped: false };
  }

  for (const child of children) {
    if (!child.sku || child.mappingState !== "clean") {
      return { ok: false, status: "manual", reason: `child_mapping_not_clean:${child.variantId}`, manual: true, skipped: false };
    }
  }

  return { ok: true, status: "validated", reason: "structural_checks_passed", manual: false, skipped: false };
}

export function resolvePoliciesFromEnv(): { policies: EbayBusinessPolicies | null; missing: string[] } {
  const fulfillmentPolicyId = String(Deno.env.get("EBAY_FULFILLMENT_POLICY_ID") || "").trim();
  const returnPolicyId = String(Deno.env.get("EBAY_RETURN_POLICY_ID") || "").trim();
  const paymentPolicyId = String(Deno.env.get("EBAY_PAYMENT_POLICY_ID") || "").trim();
  const missing: string[] = [];
  if (!fulfillmentPolicyId) missing.push("EBAY_FULFILLMENT_POLICY_ID");
  if (!returnPolicyId) missing.push("EBAY_RETURN_POLICY_ID");
  if (!paymentPolicyId) missing.push("EBAY_PAYMENT_POLICY_ID");
  if (missing.length) return { policies: null, missing };
  return { policies: { fulfillmentPolicyId, returnPolicyId, paymentPolicyId }, missing: [] };
}

function resolvePriceCents(product: Record<string, unknown>, candidate: EbayVariationGroupRelistCandidate): number | null {
  const fromProduct = Number(product.ebay_price_cents ?? 0);
  if (Number.isFinite(fromProduct) && fromProduct > 0) return Math.round(fromProduct);
  const fromPrice = Number(product.price ?? 0);
  if (Number.isFinite(fromPrice) && fromPrice > 0) return Math.round(fromPrice * 100);
  return null;
}

function buildVariesBy(optionName: string, children: ChildRelistPlan[]): Record<string, unknown> {
  const values = children.map((c) => c.optionValue).filter((v): v is string => Boolean(v));
  return {
    aspectsImageVariesBy: [optionName],
    specifications: [{ name: optionName, values }],
  };
}

function childAspects(
  groupAspects: Record<string, unknown>,
  optionName: string,
  optionValue: string | null,
): Record<string, unknown> {
  if (!optionValue) return { ...groupAspects };
  return { ...groupAspects, [optionName]: [optionValue] };
}

export async function resolveGroupRelistMetadata({
  candidate,
  product,
  accessToken,
}: {
  candidate: EbayVariationGroupRelistCandidate;
  product: Record<string, unknown>;
  accessToken: string | null;
}): Promise<{ ok: true; metadata: ResolvedGroupMetadata } | { ok: false; reason: string; missing: string[] }> {
  const warnings: string[] = [];
  const metadataSources: string[] = ["kk_product"];

  const title = String(product.name || candidate.title || "").trim();
  const description = wrapDescription(title, typeof product.description === "string" ? product.description : "");
  const categoryId = String(product.ebay_category_id || candidate.ebay_category_id || "").trim();
  const groupKey = String(candidate.ebay_item_group_key || product.ebay_item_group_key || "").trim();
  const variationOptionName = String(candidate.variation_option_name || "Color").trim();
  const imageUrls = buildImageUrlsFromProduct(product);

  if (!title) return { ok: false, reason: "missing_title", missing: ["title"] };
  if (!categoryId) return { ok: false, reason: "missing_ebay_category_id", missing: ["ebay_category_id"] };
  if (!groupKey) return { ok: false, reason: "missing_ebay_item_group_key", missing: ["ebay_item_group_key"] };
  if (!imageUrls.length) return { ok: false, reason: "missing_product_images", missing: ["images"] };
  if (!variationOptionName) return { ok: false, reason: "missing_variation_option_name", missing: ["variation_option_name"] };

  const policyResult = resolvePoliciesFromEnv();
  if (!policyResult.policies) {
    return { ok: false, reason: "policy_data_env_only_unknown_in_db", missing: policyResult.missing };
  }
  metadataSources.push("env_policies");

  let groupAspects = normalizeProductAspects(null, title);
  metadataSources.push("default_aspects_push_modal_pattern");

  if (accessToken) {
    const firstSku = candidate.child_payload_json?.find((c) => c.sku)?.sku;
    if (firstSku) {
      const cachedAspects = await fetchInventoryItemAspects(accessToken, firstSku);
      if (cachedAspects && Object.keys(cachedAspects).length) {
        groupAspects = normalizeProductAspects(cachedAspects, title);
        metadataSources.push(`ebay_inventory_item_read:${firstSku}`);
      } else {
        warnings.push(`Could not read aspects from eBay inventory item ${firstSku}; using default aspects.`);
      }
    }
  } else {
    warnings.push("No eBay token — aspects use push-modal default pattern until live publish.");
  }

  const condition = String(candidate.condition_id || "NEW").trim() || "NEW";
  if (!candidate.condition_id) {
    warnings.push("condition_id not stored on product — defaulting to NEW.");
    metadataSources.push("condition_default_new");
  }

  return {
    ok: true,
    metadata: {
      title,
      description,
      categoryId,
      condition,
      imageUrls,
      groupKey,
      variationOptionName,
      policies: policyResult.policies,
      groupAspects,
      metadataSources,
      warnings,
    },
  };
}

export async function buildGroupRelistPlan({
  candidate,
  product,
  metadata,
}: {
  candidate: EbayVariationGroupRelistCandidate;
  product: Record<string, unknown>;
  metadata: ResolvedGroupMetadata;
}): Promise<{ ok: true; plan: GroupRelistPlan } | { ok: false; reason: string }> {
  const priceCents = resolvePriceCents(product, candidate);
  if (!priceCents) return { ok: false, reason: "missing_price_cents" };

  const children: ChildRelistPlan[] = (candidate.child_payload_json || []).map(
    (child: VariationGroupRelistChildPayload) => ({
      variantId: child.variantId,
      sku: child.sku || "",
      optionValue: child.optionValue,
      quantity: Math.max(0, child.availableQty ?? 0),
      includeInRelist: Boolean(child.includeInRelist && (child.availableQty ?? 0) > 0),
      aspects: childAspects(metadata.groupAspects, metadata.variationOptionName, child.optionValue),
      mappingState: child.mappingState,
      previousOfferId: child.previousOfferId,
    }),
  );

  if (!children.every((c) => c.sku)) return { ok: false, reason: "child_sku_missing" };
  if (!children.some((c) => c.quantity > 0)) return { ok: false, reason: "no_child_with_positive_kk_available" };

  const allVariantSkus = children.map((c) => c.sku);
  const variantQuantities: Record<string, number> = {};
  for (const child of children) variantQuantities[child.sku] = child.quantity;

  return {
    ok: true,
    plan: {
      productId: candidate.product_id,
      productCode: String(candidate.product_code || product.code || "").trim(),
      groupKey: metadata.groupKey,
      oldListingId: candidate.old_ebay_listing_id,
      title: metadata.title,
      description: metadata.description,
      categoryId: metadata.categoryId,
      condition: metadata.condition,
      imageUrls: metadata.imageUrls,
      priceCents,
      variationOptionName: metadata.variationOptionName,
      groupAspects: metadata.groupAspects,
      variesBy: buildVariesBy(metadata.variationOptionName, children),
      children,
      allVariantSkus,
      variantQuantities,
      policies: metadata.policies,
      metadataSources: metadata.metadataSources,
      warnings: metadata.warnings,
    },
  };
}

export async function loadProductForGroupRelist(
  // deno-lint-ignore no-explicit-any
  client: any,
  productId: string,
): Promise<Record<string, unknown> | null> {
  return loadProductForRelist(client, productId);
}
