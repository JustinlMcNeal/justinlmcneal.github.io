/**
 * Stable issue keys for workflow state (Phase 8B).
 * Group keys layer on v_inventory_issues rows; sample keys identify individual affected rows.
 */

/** @param {string} issueType */
export function buildGroupIssueKey(issueType) {
  return `group:${issueType}`;
}

/** @param {string} raw */
function keyPart(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120);
}

/** @param {string} issueType @param {Record<string, string|number|null|undefined>} parts */
export function buildSampleIssueKey(issueType, parts) {
  const segments = Object.entries(parts)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}:${keyPart(v)}`);
  return [issueType, ...segments].join(":");
}

/** @param {string} variantId */
export function negativeAvailableKey(variantId) {
  return buildSampleIssueKey("negative_available", { variant: variantId });
}

/** @param {string} variantId */
export function negativeStockKey(variantId) {
  return buildSampleIssueKey("negative_stock", { variant: variantId });
}

/** @param {string} channel @param {string} orderId @param {string} orderItemId */
export function unmappedOrderLineKey(channel, orderId, orderItemId) {
  return buildSampleIssueKey("unmapped_order_line", {
    channel: channel || "unknown",
    order: orderId,
    item: orderItemId,
  });
}

/** @param {string} productId @param {string} [listingId] */
export function ebayListingEndedKey(productId, listingId) {
  return buildSampleIssueKey("ebay_listing_ended", {
    product: productId,
    listing: listingId,
  });
}

/** @param {string} variantId @param {string} [sellerSku] */
export function amazonMappingMissingKey(variantId, sellerSku) {
  return buildSampleIssueKey("amazon_mapping_missing", {
    variant: variantId,
    sku: sellerSku,
  });
}

/** @param {string} channel @param {string} runId @param {string} sellerSku */
export function channelSyncFailedKey(channel, runId, sellerSku) {
  return buildSampleIssueKey("channel_sync_failed", {
    channel,
    run: runId,
    sku: sellerSku,
  });
}

/** @param {string} parcelImportId @param {string} mappingRowId */
export function parcelMappingMissingKey(parcelImportId, mappingRowId) {
  return buildSampleIssueKey("parcel_mapping_missing", {
    parcel: parcelImportId,
    row: mappingRowId,
  });
}

/** @param {string} variantId */
export function ebayQtyCacheMissingKey(variantId) {
  return buildSampleIssueKey("ebay_qty_cache_missing", { variant: variantId });
}

/** @param {string} productId */
export function ebayUnsupportedVariationKey(productId) {
  return buildSampleIssueKey("ebay_unsupported_variation", { product: productId });
}

/** @param {string} channel @param {string} orderId @param {string} orderItemId */
export function shippedFinalizeAuditKey(channel, orderId, orderItemId) {
  return buildSampleIssueKey("shipped_finalize_audit_needed", {
    channel: channel || "unknown",
    order: orderId,
    item: orderItemId,
  });
}

/** @param {import('../state.js').InventoryIssueRow} issue */
export function groupKeyForIssue(issue) {
  return buildGroupIssueKey(issue.type);
}
