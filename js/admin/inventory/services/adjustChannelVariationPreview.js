/**
 * eBay variation preview resolution for Adjust modal (Phase 060C.2).
 * Read-only — labels, toggle eligibility, candidate priority. No edge calls.
 */

/** @typedef {'success'|'warn'|'muted'|'danger'} PreviewTone */

/** @typedef {import('./adjustChannelPreview.js').ChannelPreviewCard} ChannelPreviewCard */

/** @typedef {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow} ChannelSyncCandidateRow */
/** @typedef {import('../api/channelSyncCandidateApi.js').EbayRelistCandidateRow} EbayRelistCandidateRow */
/** @typedef {import('../api/ebayVariationCandidateApi.js').EbayVariationChildCandidateRow} EbayVariationChildCandidateRow */
/** @typedef {import('../api/ebayVariationRelistCandidateApi.js').EbayVariationGroupRelistCandidateRow} EbayVariationGroupRelistCandidateRow */

const VARIATION_CHILD_MANUAL = new Set([
  "variation_mapping_missing",
  "variation_mapping_ambiguous",
  "variation_child_offer_missing",
  "variation_parent_inactive",
  "variation_manual",
]);

const VARIATION_GROUP_MANUAL = new Set([
  "variation_group_missing_metadata",
  "variation_group_missing_aspects",
  "variation_group_missing_images",
  "variation_group_mapping_missing",
  "variation_group_mapping_ambiguous",
  "variation_group_child_offer_conflict",
  "variation_group_unsupported_structure",
  "variation_group_manual",
]);

const VARIATION_CHILD_ACTIVE = new Set([
  "variation_update_qty",
  "variation_qty_cache_missing",
  "variation_no_change",
]);

const VARIATION_GROUP_RELIST = new Set([
  "variation_group_ready_to_relist",
  "variation_group_relist_dry_run_ready",
]);

/**
 * @param {ChannelSyncCandidateRow|null} candidate
 */
export function isEbayVariationListing(candidate) {
  return Boolean(
    candidate?.ebay_item_group_key &&
    Number(candidate?.product_active_variant_count || 0) > 1,
  );
}

/**
 * Recompute variation child candidate_state using projected KK available qty.
 * @param {EbayVariationChildCandidateRow|null} child
 * @param {number} projectedAvailable
 */
export function resolveProjectedVariationChildState(child, projectedAvailable) {
  if (!child?.candidate_state) return null;
  const state = child.candidate_state;
  const projected = Number(projectedAvailable);
  if (!Number.isFinite(projected)) return state;

  if (VARIATION_CHILD_MANUAL.has(state)) {
    if (state !== "variation_manual" || projected <= 0) return state;
    if (!child.child_offer_id || child.ebay_child_qty == null) return state;
    const qty = Number(child.ebay_child_qty);
    if (!Number.isFinite(qty)) return state;
    return qty !== projected ? "variation_update_qty" : "variation_no_change";
  }

  if (state === "variation_qty_cache_missing") return state;

  const ebayQty = child.ebay_child_qty;
  if (ebayQty == null) return state;

  const qty = Number(ebayQty);
  if (!Number.isFinite(qty)) return state;

  if (state === "variation_update_qty" || state === "variation_no_change") {
    return qty !== projected ? "variation_update_qty" : "variation_no_change";
  }

  return state;
}

/** @param {number} projectedAvailable */
export function isMarketplaceSyncQtyEligible(projectedAvailable) {
  return Number.isFinite(projectedAvailable) && projectedAvailable >= 0;
}

/**
 * @param {ChannelSyncCandidateRow|null} candidate
 * @param {EbayRelistCandidateRow|null} relist
 * @param {number} projectedAvailable
 */
export function isSingleSkuEbayActionable(candidate, relist, projectedAvailable) {
  if (!candidate || !isMarketplaceSyncQtyEligible(projectedAvailable)) return false;
  if (isEbayVariationListing(candidate)) return false;
  const action = candidate.ebay_sync_action;
  if (action === "update_qty" || action === "qty_cache_missing") return true;
  if (action !== "ended_needs_relist") return false;
  if (relist?.relist_action === "unsupported_variation") return false;
  if (relist?.relist_action && relist.relist_action !== "ready_to_relist") return false;
  return true;
}

/**
 * @param {ChannelSyncCandidateRow|null} candidate
 * @param {EbayRelistCandidateRow|null} relist
 */
export function shouldFetchVariationChildCandidate(candidate, relist) {
  if (!candidate?.product_id) return false;
  const action = candidate.ebay_sync_action;
  if (isEbayVariationListing(candidate)) {
    if (
      action === "update_qty" ||
      action === "qty_cache_missing" ||
      action === "unsupported_variation" ||
      action === "no_change"
    ) {
      return true;
    }
  }
  if (action === "update_qty" || action === "qty_cache_missing") return false;
  if (action === "unsupported_variation") return true;
  if (action === "ended_needs_relist" && relist?.relist_action === "unsupported_variation") return true;
  return false;
}

/**
 * @param {ChannelSyncCandidateRow|null} candidate
 * @param {EbayRelistCandidateRow|null} relist
 */
export function shouldFetchVariationRelistCandidate(candidate, relist) {
  if (!candidate?.product_id) return false;
  if (candidate.ebay_sync_action !== "ended_needs_relist") return false;
  if (relist?.relist_action === "ready_to_relist") return false;
  return true;
}

/**
 * @param {EbayVariationChildCandidateRow|null} child
 */
export function isVariationChildPreviewRelevant(child) {
  if (!child?.candidate_state) return false;
  return VARIATION_CHILD_ACTIVE.has(child.candidate_state) || VARIATION_CHILD_MANUAL.has(child.candidate_state);
}

/**
 * @param {EbayVariationGroupRelistCandidateRow|null} group
 */
export function isVariationGroupRelistPreviewRelevant(group) {
  if (!group?.candidate_state) return false;
  if (group.candidate_state === "variation_group_active") return false;
  return VARIATION_GROUP_RELIST.has(group.candidate_state) || VARIATION_GROUP_MANUAL.has(group.candidate_state)
    || group.candidate_state === "variation_group_no_in_stock_children";
}

/**
 * @param {EbayVariationChildCandidateRow|null} child
 * @param {number} projectedAvailable
 */
export function isVariationChildToggleSafe(child, projectedAvailable) {
  if (!child || !isMarketplaceSyncQtyEligible(projectedAvailable)) return false;
  const state =
    resolveProjectedVariationChildState(child, projectedAvailable) ?? child.candidate_state;
  return state === "variation_update_qty" || state === "variation_qty_cache_missing";
}

/**
 * @param {EbayVariationGroupRelistCandidateRow|null} group
 * @param {number} projectedAvailable
 */
export function isVariationGroupRelistToggleSafe(group, projectedAvailable) {
  if (!group || projectedAvailable <= 0) return false;
  const state = group.candidate_state;
  if (state === "variation_group_active" || state === "variation_group_no_in_stock_children") return false;
  return VARIATION_GROUP_RELIST.has(state);
}

/**
 * @param {Object} opts
 * @param {ChannelSyncCandidateRow|null} opts.candidate
 * @param {EbayRelistCandidateRow|null} opts.relist
 * @param {EbayVariationChildCandidateRow|null} opts.variationChild
 * @param {EbayVariationGroupRelistCandidateRow|null} opts.variationRelist
 * @param {number} opts.projectedAvailable
 * @returns {'single_sku'|'variation_child'|'variation_group_relist'|'channel_fallback'}
 */
export function resolveEbayPreviewPath({
  candidate,
  relist,
  variationChild,
  variationRelist,
  projectedAvailable,
}) {
  if (isSingleSkuEbayActionable(candidate, relist, projectedAvailable)) {
    return "single_sku";
  }

  const groupActive = variationRelist?.candidate_state === "variation_group_active";
  if (!groupActive && isVariationGroupRelistPreviewRelevant(variationRelist)) {
    const state = variationRelist.candidate_state;
    if (VARIATION_GROUP_RELIST.has(state) && projectedAvailable > 0) {
      return "variation_group_relist";
    }
    if (VARIATION_GROUP_MANUAL.has(state) || state === "variation_group_no_in_stock_children") {
      return "variation_group_relist";
    }
  }

  if (isVariationChildPreviewRelevant(variationChild)) {
    return "variation_child";
  }

  if (!groupActive && variationRelist && VARIATION_GROUP_RELIST.has(variationRelist.candidate_state)) {
    return "variation_group_relist";
  }

  return "channel_fallback";
}

/**
 * @param {EbayVariationChildCandidateRow|null} child
 * @param {{ projectedAvailable?: number }} [opts]
 * @returns {ChannelPreviewCard}
 */
export function mapVariationChildPreviewStatus(child, opts = {}) {
  const projectedAvailable = Number(opts.projectedAvailable ?? 0);
  const state = child?.candidate_state || "variation_manual";
  const detail = formatVariationChildDetail(child, projectedAvailable);

  if (VARIATION_CHILD_MANUAL.has(state)) {
    return card(
      "eBay",
      "eBay variation requires manual mapping review.",
      detail || humanizeReason(child?.candidate_reason) || "Mapping or offer data needs review before sync.",
      "warn",
    );
  }

  switch (state) {
    case "variation_update_qty":
      if (projectedAvailable < 0) {
        return card(
          "eBay",
          "eBay variation quantity can update.",
          "Projected available quantity is negative after adjust.",
          "muted",
        );
      }
      return card(
        "eBay",
        projectedAvailable === 0 ? "eBay variation quantity will zero" : "eBay variation quantity can update.",
        projectedAvailable === 0
          ? (detail || "Child variation qty can sync to zero after KK stock is saved when marketplace sync is on.")
          : (detail || "Child variation qty can sync after KK stock is saved when marketplace sync is on."),
        "success",
      );
    case "variation_qty_cache_missing":
      if (projectedAvailable < 0) {
        return card(
          "eBay",
          "eBay variation cache will refresh before sync.",
          "Projected available quantity is negative after adjust.",
          "muted",
        );
      }
      return card(
        "eBay",
        "eBay variation cache will refresh before sync.",
        detail || "Cache refresh runs before variation qty sync when marketplace sync is on.",
        "warn",
      );
    case "variation_no_change":
      return card(
        "eBay",
        "eBay variation already matches.",
        detail || "Marketplace child qty already matches available stock.",
        "muted",
      );
    default:
      return card(
        "eBay",
        "eBay variation requires manual mapping review.",
        detail || "Variation path unavailable for this variant.",
        "warn",
      );
  }
}

/**
 * @param {EbayVariationGroupRelistCandidateRow|null} group
 * @param {{ projectedAvailable?: number }} [opts]
 * @returns {ChannelPreviewCard}
 */
export function mapVariationGroupRelistPreviewStatus(group, opts = {}) {
  const projectedAvailable = Number(opts.projectedAvailable ?? 0);
  const state = group?.candidate_state || "variation_group_manual";
  const detail = formatVariationGroupRelistDetail(group);

  if (state === "variation_group_no_in_stock_children") {
    return card(
      "eBay",
      "No in-stock eBay variation children to relist.",
      detail || "No children with positive KK available qty for group relist.",
      "muted",
    );
  }

  if (VARIATION_GROUP_MANUAL.has(state) || group?.requires_manual_review) {
    return card(
      "eBay",
      "eBay variation group relist requires manual review.",
      detail || humanizeReason(group?.candidate_reason) || "Metadata, mapping, or policy data needs review.",
      "warn",
    );
  }

  switch (state) {
    case "variation_group_ready_to_relist":
      if (projectedAvailable <= 0) {
        return card(
          "eBay",
          "eBay variation group can be relisted.",
          "Projected available quantity is negative after adjust.",
          "muted",
        );
      }
      return card(
        "eBay",
        "eBay variation group can be relisted.",
        detail || "Will attempt group relist when marketplace sync is on. Success depends on eBay.",
        "warn",
      );
    case "variation_group_relist_dry_run_ready":
      if (projectedAvailable <= 0) {
        return card(
          "eBay",
          "eBay variation group relist can be previewed.",
          "Projected available quantity is negative after adjust.",
          "muted",
        );
      }
      return card(
        "eBay",
        "eBay variation group relist can be previewed.",
        detail || "Dry-run relist path available when marketplace sync is on.",
        "warn",
      );
    default:
      return card(
        "eBay",
        "eBay variation group relist requires manual review.",
        detail || "Group relist path unavailable.",
        "warn",
      );
  }
}

/**
 * @param {EbayVariationChildCandidateRow|null} child
 * @param {EbayVariationGroupRelistCandidateRow|null} group
 * @param {number} projectedAvailable
 */
export function computeVariationSyncToggleContribution(child, group, projectedAvailable) {
  if (!isMarketplaceSyncQtyEligible(projectedAvailable)) return false;
  if (group?.candidate_state === "variation_group_active") {
    return isVariationChildToggleSafe(child, projectedAvailable);
  }
  return (
    isVariationChildToggleSafe(child, projectedAvailable) ||
    isVariationGroupRelistToggleSafe(group, projectedAvailable)
  );
}

/**
 * @param {EbayVariationChildCandidateRow|null} child
 * @param {number} projectedAvailable
 */
function formatVariationChildDetail(child, projectedAvailable) {
  if (!child) return "";
  const parts = [];
  const sku = child.cache_ebay_sku || child.expected_ebay_sku;
  if (sku) parts.push(`Child SKU ${sku}`);
  if (child.ebay_child_qty != null) parts.push(`eBay qty ${child.ebay_child_qty}`);
  if (projectedAvailable >= 0) parts.push(`projected KK available ${projectedAvailable}`);
  if (child.requires_cache_refresh || child.candidate_state === "variation_qty_cache_missing") {
    parts.push("cache refresh required");
  }
  if (child.candidate_reason && VARIATION_CHILD_MANUAL.has(child.candidate_state)) {
    parts.push(humanizeReason(child.candidate_reason));
  }
  return parts.join(" · ");
}

/** @param {EbayVariationGroupRelistCandidateRow|null} group */
function formatVariationGroupRelistDetail(group) {
  if (!group) return "";
  const parts = [];
  if (group.ebay_item_group_key) parts.push(`Group ${group.ebay_item_group_key}`);
  if (group.variant_count != null) parts.push(`${group.variant_count} variants`);
  if (group.in_stock_child_count != null) parts.push(`${group.in_stock_child_count} in stock`);
  if (group.out_of_stock_child_count > 0) {
    parts.push(`${group.out_of_stock_child_count} qty-0 siblings`);
  }
  if (group.candidate_reason && (VARIATION_GROUP_MANUAL.has(group.candidate_state) || group.requires_manual_review)) {
    parts.push(humanizeReason(group.candidate_reason));
  }
  return parts.join(" · ");
}

/** @param {string|null|undefined} reason */
function humanizeReason(reason) {
  if (!reason) return "";
  return String(reason).replace(/_/g, " ");
}

/** @param {string} channel @param {string} label @param {string} description @param {PreviewTone} tone */
function card(channel, label, description, tone) {
  return { channel, label, description, tone };
}
