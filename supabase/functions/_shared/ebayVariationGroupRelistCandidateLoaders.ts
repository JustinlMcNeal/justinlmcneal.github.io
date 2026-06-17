/**
 * eBay variation group relist candidate loaders (Phase 060B.2).
 * Read-only — queries v_inventory_ebay_variation_relist_candidates only.
 */

export type VariationGroupRelistChildPayload = {
  variantId: string;
  sku: string | null;
  optionValue: string | null;
  availableQty: number;
  includeInRelist: boolean;
  previousOfferId: string | null;
  previousEbayQty: number | null;
  mappingState: string;
};

export type EbayVariationGroupRelistCandidate = {
  product_id: string;
  product_code: string | null;
  title: string | null;
  ebay_item_group_key: string | null;
  old_ebay_listing_id: string | null;
  parent_listing_status: string | null;
  ebay_category_id: string | null;
  condition_id: string | null;
  has_images: boolean;
  image_count: number;
  has_category: boolean;
  has_policy_data: boolean;
  has_required_aspects: boolean;
  has_variation_options: boolean;
  variation_option_name: string | null;
  variant_count: number;
  in_stock_child_count: number;
  out_of_stock_child_count: number;
  mapped_child_count: number;
  ambiguous_child_count: number;
  missing_child_count: number;
  child_skus: string[] | null;
  in_stock_child_skus: string[] | null;
  missing_child_skus: string[] | null;
  conflict_child_skus: string[] | null;
  child_payload_json: VariationGroupRelistChildPayload[];
  candidate_state: string;
  candidate_reason: string | null;
  is_actionable: boolean;
  requires_manual_review: boolean;
  mapping_confidence: string | null;
};

export type VariationGroupRelistValidation = {
  ok: boolean;
  state: string;
  reason: string;
  actionable: boolean;
  manual: boolean;
};

const ACTIONABLE_STATES = new Set([
  "variation_group_ready_to_relist",
  "variation_group_relist_dry_run_ready",
]);

const SKIP_STATES = new Set([
  "variation_group_active",
  "variation_group_no_change",
]);

const MANUAL_STATES = new Set([
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

const SELECT_COLUMNS = [
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

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((v) => String(v)).filter(Boolean);
}

function parseChildPayload(value: unknown): VariationGroupRelistChildPayload[] {
  if (!Array.isArray(value)) return [];
  const out: VariationGroupRelistChildPayload[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    out.push({
      variantId: String(o.variantId || ""),
      sku: asString(o.sku),
      optionValue: asString(o.optionValue),
      availableQty: asInt(o.availableQty) ?? 0,
      includeInRelist: Boolean(o.includeInRelist),
      previousOfferId: asString(o.previousOfferId),
      previousEbayQty: asInt(o.previousEbayQty),
      mappingState: asString(o.mappingState) || "missing",
    });
  }
  return out;
}

function normalizeRow(row: Record<string, unknown>): EbayVariationGroupRelistCandidate {
  return {
    product_id: String(row.product_id),
    product_code: asString(row.product_code),
    title: asString(row.title),
    ebay_item_group_key: asString(row.ebay_item_group_key),
    old_ebay_listing_id: asString(row.old_ebay_listing_id),
    parent_listing_status: asString(row.parent_listing_status),
    ebay_category_id: asString(row.ebay_category_id),
    condition_id: asString(row.condition_id),
    has_images: Boolean(row.has_images),
    image_count: asInt(row.image_count) ?? 0,
    has_category: Boolean(row.has_category),
    has_policy_data: Boolean(row.has_policy_data),
    has_required_aspects: Boolean(row.has_required_aspects),
    has_variation_options: Boolean(row.has_variation_options),
    variation_option_name: asString(row.variation_option_name),
    variant_count: asInt(row.variant_count) ?? 0,
    in_stock_child_count: asInt(row.in_stock_child_count) ?? 0,
    out_of_stock_child_count: asInt(row.out_of_stock_child_count) ?? 0,
    mapped_child_count: asInt(row.mapped_child_count) ?? 0,
    ambiguous_child_count: asInt(row.ambiguous_child_count) ?? 0,
    missing_child_count: asInt(row.missing_child_count) ?? 0,
    child_skus: asStringArray(row.child_skus),
    in_stock_child_skus: asStringArray(row.in_stock_child_skus),
    missing_child_skus: asStringArray(row.missing_child_skus),
    conflict_child_skus: asStringArray(row.conflict_child_skus),
    child_payload_json: parseChildPayload(row.child_payload_json),
    candidate_state: asString(row.candidate_state) || "variation_group_manual",
    candidate_reason: asString(row.candidate_reason),
    is_actionable: Boolean(row.is_actionable),
    requires_manual_review: Boolean(row.requires_manual_review),
    mapping_confidence: asString(row.mapping_confidence),
  };
}

/**
 * Load one ended variation group relist candidate (parent product scope).
 */
export async function loadEbayVariationGroupRelistCandidate({
  supabase,
  productId,
}: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  productId: string;
}): Promise<EbayVariationGroupRelistCandidate | null> {
  const pid = String(productId || "").trim();
  if (!pid) return null;

  const { data, error } = await supabase
    .from("v_inventory_ebay_variation_relist_candidates")
    .select(SELECT_COLUMNS)
    .eq("product_id", pid)
    .maybeSingle();

  if (error) throw new Error("database_error");
  if (!data) return null;
  return normalizeRow(data as Record<string, unknown>);
}

/**
 * Server-side validation for ended variation group relist eligibility (read-only).
 */
export function validateVariationGroupRelistCandidate(
  candidate: EbayVariationGroupRelistCandidate | null,
): VariationGroupRelistValidation {
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

  if (SKIP_STATES.has(state)) {
    return { ok: true, state, reason, actionable: false, manual: false };
  }

  if (MANUAL_STATES.has(state) || candidate.requires_manual_review) {
    return { ok: false, state, reason, actionable: false, manual: true };
  }

  if (!ACTIONABLE_STATES.has(state)) {
    return { ok: false, state, reason: "unsupported_candidate_state", actionable: false, manual: true };
  }

  if (candidate.in_stock_child_count <= 0) {
    return {
      ok: false,
      state: "variation_group_no_in_stock_children",
      reason: "no_child_with_positive_kk_available",
      actionable: false,
      manual: true,
    };
  }

  if (!candidate.ebay_item_group_key) {
    return {
      ok: false,
      state: "variation_group_unsupported_structure",
      reason: "missing_ebay_item_group_key",
      actionable: false,
      manual: true,
    };
  }

  if (candidate.variant_count < 2) {
    return {
      ok: false,
      state: "variation_group_unsupported_structure",
      reason: "requires_multi_variant_group",
      actionable: false,
      manual: true,
    };
  }

  if (candidate.mapped_child_count < candidate.variant_count) {
    return {
      ok: false,
      state: "variation_group_mapping_missing",
      reason: "not_all_children_mapped_cleanly",
      actionable: false,
      manual: true,
    };
  }

  if (candidate.ambiguous_child_count > 0) {
    return {
      ok: false,
      state: "variation_group_mapping_ambiguous",
      reason: "ambiguous_child_mappings",
      actionable: false,
      manual: true,
    };
  }

  if (candidate.conflict_child_skus?.length) {
    return {
      ok: false,
      state: "variation_group_child_offer_conflict",
      reason: "child_sku_conflicts",
      actionable: false,
      manual: true,
    };
  }

  if (!candidate.has_category || !candidate.has_images || !candidate.has_variation_options) {
    return {
      ok: false,
      state: "variation_group_missing_metadata",
      reason: "incomplete_group_metadata",
      actionable: false,
      manual: true,
    };
  }

  if (!candidate.has_required_aspects) {
    return {
      ok: false,
      state: "variation_group_missing_aspects",
      reason: "required_ebay_aspects_not_persisted_or_unknown",
      actionable: false,
      manual: true,
    };
  }

  if (!candidate.has_policy_data) {
    return {
      ok: false,
      state: "variation_group_missing_metadata",
      reason: "policy_data_env_only_unknown_in_db",
      actionable: false,
      manual: true,
    };
  }

  const children = candidate.child_payload_json || [];
  if (!children.length || children.length < candidate.variant_count) {
    return {
      ok: false,
      state: "variation_group_unsupported_structure",
      reason: "incomplete_child_payload_json",
      actionable: false,
      manual: true,
    };
  }

  for (const child of children) {
    if (!child.sku || child.mappingState !== "clean") {
      return {
        ok: false,
        state: "variation_group_mapping_missing",
        reason: `child_mapping_not_clean:${child.variantId}`,
        actionable: false,
        manual: true,
      };
    }
  }

  return { ok: true, state, reason, actionable: true, manual: false };
}

/** Documented metadata gaps for 060B.2 (aspects/policies not fully in DB). */
export const EBAY_VARIATION_RELIST_METADATA_GAPS = [
  "has_policy_data is false in view — fulfillment/return/payment policies come from edge env at publish time",
  "has_required_aspects is false in view — full eBay aspect matrix is not persisted on products; edge must validate",
  "condition_id not stored on products today — reserved for future",
];
