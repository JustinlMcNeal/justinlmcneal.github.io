/**
 * eBay variation child candidate loaders (Phase 060A.2).
 * Read-only — queries v_inventory_ebay_variation_sync_candidates only.
 */

export type EbayVariationChildCandidate = {
  product_id: string;
  variant_id: string;
  product_code: string | null;
  variant_sku: string | null;
  option_name: string | null;
  option_value: string | null;
  ebay_item_group_key: string | null;
  parent_ebay_listing_id: string | null;
  expected_ebay_sku: string | null;
  cache_ebay_sku: string | null;
  child_offer_id: string | null;
  child_listing_status: string | null;
  kk_available_qty: number;
  ebay_child_qty: number | null;
  qty_delta: number | null;
  candidate_state: string;
  candidate_reason: string | null;
  is_actionable: boolean;
  requires_cache_refresh: boolean;
  mapping_confidence: string | null;
  cache_last_synced_at: string | null;
  product_active_variant_count: number | null;
};

export type VariationChildValidation = {
  ok: boolean;
  state: string;
  reason: string;
  actionable: boolean;
};

const ACTIONABLE_STATES = new Set(["variation_update_qty", "variation_qty_cache_missing"]);
const MANUAL_STATES = new Set([
  "variation_mapping_missing",
  "variation_mapping_ambiguous",
  "variation_child_offer_missing",
  "variation_parent_inactive",
  "variation_manual",
]);

const SELECT_COLUMNS = [
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

function normalizeRow(row: Record<string, unknown>): EbayVariationChildCandidate {
  return {
    product_id: String(row.product_id),
    variant_id: String(row.variant_id),
    product_code: asString(row.product_code),
    variant_sku: asString(row.variant_sku),
    option_name: asString(row.option_name),
    option_value: asString(row.option_value),
    ebay_item_group_key: asString(row.ebay_item_group_key),
    parent_ebay_listing_id: asString(row.parent_ebay_listing_id),
    expected_ebay_sku: asString(row.expected_ebay_sku),
    cache_ebay_sku: asString(row.cache_ebay_sku),
    child_offer_id: asString(row.child_offer_id),
    child_listing_status: asString(row.child_listing_status),
    kk_available_qty: asInt(row.kk_available_qty) ?? 0,
    ebay_child_qty: asInt(row.ebay_child_qty),
    qty_delta: asInt(row.qty_delta),
    candidate_state: asString(row.candidate_state) || "variation_manual",
    candidate_reason: asString(row.candidate_reason),
    is_actionable: Boolean(row.is_actionable),
    requires_cache_refresh: Boolean(row.requires_cache_refresh),
    mapping_confidence: asString(row.mapping_confidence),
    cache_last_synced_at: asString(row.cache_last_synced_at),
    product_active_variant_count: asInt(row.product_active_variant_count),
  };
}

/**
 * Load one variation child candidate row from the read-only view.
 */
export async function loadEbayVariationChildCandidate({
  supabase,
  productId,
  variantId,
}: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  productId: string;
  variantId: string;
}): Promise<EbayVariationChildCandidate | null> {
  const pid = String(productId || "").trim();
  const vid = String(variantId || "").trim();
  if (!pid || !vid) return null;

  const { data, error } = await supabase
    .from("v_inventory_ebay_variation_sync_candidates")
    .select(SELECT_COLUMNS)
    .eq("product_id", pid)
    .eq("variant_id", vid)
    .maybeSingle();

  if (error) throw new Error("database_error");
  if (!data) return null;
  return normalizeRow(data as Record<string, unknown>);
}

/**
 * Server-side validation for qty sync eligibility (read-only checks).
 */
export function validateVariationChildCandidateForQty(
  candidate: EbayVariationChildCandidate | null,
): VariationChildValidation {
  if (!candidate) {
    return {
      ok: false,
      state: "variation_manual",
      reason: "no_variation_candidate_row",
      actionable: false,
    };
  }

  const state = candidate.candidate_state || "variation_manual";
  const reason = candidate.candidate_reason || state;

  if (MANUAL_STATES.has(state)) {
    return { ok: false, state, reason, actionable: false };
  }

  if (state === "variation_no_change") {
    return { ok: true, state, reason, actionable: false };
  }

  if (!ACTIONABLE_STATES.has(state)) {
    return { ok: false, state, reason: "unsupported_candidate_state", actionable: false };
  }

  if (state === "variation_update_qty") {
    if (candidate.kk_available_qty <= 0) {
      return { ok: false, state: "variation_manual", reason: "kk_available_not_positive", actionable: false };
    }
    if (!candidate.expected_ebay_sku || !candidate.cache_ebay_sku) {
      return { ok: false, state: "variation_mapping_missing", reason: "missing_child_sku", actionable: false };
    }
    if (!candidate.child_offer_id) {
      return { ok: false, state: "variation_child_offer_missing", reason: "missing_child_offer_id", actionable: false };
    }
    if (candidate.ebay_child_qty == null) {
      return { ok: false, state: "variation_qty_cache_missing", reason: "ebay_child_qty_unknown", actionable: true };
    }
    if (candidate.mapping_confidence === "none") {
      return { ok: false, state: "variation_manual", reason: "mapping_confidence_none", actionable: false };
    }
    return { ok: true, state, reason, actionable: true };
  }

  if (state === "variation_qty_cache_missing") {
    if (!candidate.expected_ebay_sku) {
      return { ok: false, state: "variation_mapping_missing", reason: "cannot_derive_expected_sku", actionable: false };
    }
    if (!candidate.parent_ebay_listing_id || !candidate.ebay_item_group_key) {
      return { ok: false, state: "variation_mapping_missing", reason: "missing_parent_group", actionable: false };
    }
    return { ok: true, state, reason, actionable: true };
  }

  return { ok: false, state, reason: "unhandled_state", actionable: false };
}

/** Documented source for child offer ID (060A.2). */
export const EBAY_VARIATION_CHILD_OFFER_ID_SOURCE =
  "ebay_listing_inventory_cache.raw_payload_json.offerId (populated by cache refresh from eBay offer lookup)";
