/**
 * Map v_inventory_workspace DB rows to table renderer shape.
 */

import { formatRelativeTime } from "../utils/formatters.js";

/** @param {Record<string, unknown>} row */
export function mapWorkspaceRow(row) {
  const onHand = Number(row.on_hand ?? 0);
  const reserved = Number(row.reserved ?? 0);
  const available = Number(row.available ?? onHand);
  const threshold = Number(row.low_stock_threshold ?? 3);
  const variantLabel = String(row.variant_label ?? "Default");
  const optionName = row.option_name ? String(row.option_name) : "";
  const optionValue = row.option_value ? String(row.option_value) : variantLabel;
  const variantDetail =
    optionName && optionValue !== optionName
      ? `${optionValue} • ${optionName}`
      : optionValue;
  const updatedAt = row.updated_at ? String(row.updated_at) : "";
  const issueTypes = Array.isArray(row.issue_types)
    ? row.issue_types.map(String)
    : [];

  return {
    id: String(row.variant_id ?? ""),
    title: String(row.product_title ?? "Unknown product"),
    variant: variantLabel,
    variantDetail,
    shortSku: row.short_sku ? String(row.short_sku) : "",
    internalSku: String(row.internal_sku ?? row.variant_sku ?? ""),
    imageUrl: row.image_url ? String(row.image_url) : null,
    thumbClass: "bg-kkpeach/70",
    kkStock: row.kk_stock != null ? Number(row.kk_stock) : onHand,
    ebayStock: row.ebay_stock != null ? Number(row.ebay_stock) : null,
    amazonStock: row.amazon_stock != null ? Number(row.amazon_stock) : null,
    onHand,
    reserved,
    available,
    threshold,
    status: String(row.status ?? "healthy"),
    updated: formatRelativeTime(updatedAt),
    updatedAtMs: updatedAt ? new Date(updatedAt).getTime() : 0,
    category: row.category_slug ? String(row.category_slug) : "",
    unmapped: Boolean(row.is_unmapped),
    hasIssue: Boolean(row.has_issue),
    issueTypes,
    syncState: String(row.sync_state ?? "never"),
    ebaySku: row.ebay_sku ? String(row.ebay_sku) : "",
    ebayListingId: row.ebay_listing_id ? String(row.ebay_listing_id) : "",
    amazonAsin: row.amazon_asin ? String(row.amazon_asin) : "",
    amazonSellerSku: row.amazon_seller_sku ? String(row.amazon_seller_sku) : "",
    ebayListingStatus: row.ebay_listing_status ? String(row.ebay_listing_status) : "",
    amazonListingStatus: row.amazon_listing_status ? String(row.amazon_listing_status) : "",
    ebayStockSource: row.ebay_stock_source ? String(row.ebay_stock_source) : null,
    ebayStockCachedAt: row.ebay_stock_cached_at ? String(row.ebay_stock_cached_at) : null,
    ebayStockIsStale: Boolean(row.ebay_stock_is_stale),
    ebayStockTooltip: row.ebay_stock_tooltip ? String(row.ebay_stock_tooltip) : null,
  };
}

/** @typedef {ReturnType<typeof mapWorkspaceRow>} InventoryRow */
