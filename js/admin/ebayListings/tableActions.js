/**
 * tableActions.js — Product-list mutation action implementations.
 *
 * Owns:
 *   - discardDraft(code, offerId, itemGroupKey)
 *   - doWithdraw(code, offerId, itemGroupKey)
 *   - doPublish(code, offerId, itemGroupKey)
 *
 * Does NOT own:
 *   - handleProductAction dispatcher
 *   - product action button markup
 *   - Push / Edit modal logic
 *   - product loading state
 *
 * callEdge imported directly from api.js (no circular path).
 * Page state and callbacks injected from index.js.
 */

import { callEdge } from "./api.js";
import { isEffectiveGroupListing, publishQuantityForProduct } from "./utils.js";

/**
 * @param {{ getProducts: () => any[], loadProducts: () => Promise<void>, showStatus: (msg: string, isError?: boolean) => void }} deps
 */
export function createTableActions({ getProducts, loadProducts, showStatus }) {
  async function discardDraft(code, offerId, itemGroupKey) {
    const product = getProducts().find(p => p.code === code);
    if (!product || product.ebay_status !== "draft") {
      showStatus("❌ Only draft listings can be discarded here.", true);
      return;
    }
    if (!confirm(`Discard the eBay draft attempt for ${code}? This deletes the unpublished eBay draft resources and resets the product to Not Listed.`)) return;
    showStatus("Discarding draft…");
    try {
      const result = await callEdge("ebay-manage-listing", {
        action: "discard_draft",
        productCode: code,
        sku: product.ebay_sku || code,
        offerId: offerId && String(offerId).trim() ? String(offerId).trim() : product.ebay_offer_id,
        inventoryItemGroupKey: itemGroupKey && String(itemGroupKey).trim() ? String(itemGroupKey).trim() : product.ebay_item_group_key,
      });
      if (result.success) {
        showStatus(`✅ Draft discarded for ${code}. You can Push again when ready.`);
        await loadProducts();
      } else {
        showStatus("❌ " + (result.error || "Discard draft failed"), true);
      }
    } catch (e) {
      showStatus("❌ " + e.message, true);
    }
  }

  async function doWithdraw(code, offerId, itemGroupKey) {
    if (!confirm(`End eBay listing for ${code}?`)) return;
    showStatus("Withdrawing…");
    try {
      const product = getProducts().find(p => p.code === code);
      const hasGroup = isEffectiveGroupListing(product) && itemGroupKey && String(itemGroupKey).trim();
      const hasOffer = offerId && String(offerId).trim();
      if (!hasGroup && !hasOffer) {
        showStatus("❌ Cannot end listing: missing offer ID/group key", true);
        return;
      }
      const result = hasGroup
        ? await callEdge("ebay-manage-listing", { action: "withdraw_group", inventoryItemGroupKey: String(itemGroupKey).trim(), sku: code })
        : await callEdge("ebay-manage-listing", { action: "withdraw", offerId: String(offerId).trim(), sku: code });
      if (result.success) { showStatus("✅ Listing ended"); loadProducts(); }
      else showStatus("❌ " + (result.error || "Withdraw failed"), true);
    } catch (e) { showStatus("❌ " + e.message, true); }
  }

  async function doPublish(code, offerId, itemGroupKey) {
    showStatus("Publishing…");
    try {
      const product = getProducts().find(p => p.code === code);
      const hasGroup = isEffectiveGroupListing(product) && itemGroupKey && String(itemGroupKey).trim();
      const hasOffer = offerId && String(offerId).trim();
      if (!hasGroup && !hasOffer) {
        showStatus("❌ Cannot publish: missing offer ID. Use Resume Push to rebuild the offer.", true);
        return;
      }
      const variantQuantities = Object.fromEntries((product?.product_variants || [])
        .filter(v => v.is_active && (parseInt(v.stock, 10) || 0) > 0)
        .map(v => {
          const suffix = v.option_value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
          return [`${code}-${suffix}`, parseInt(v.stock, 10) || 0];
        }));
      variantQuantities[code] = publishQuantityForProduct(product);
      const result   = hasGroup
        ? await callEdge("ebay-manage-listing", { action: "publish_group", inventoryItemGroupKey: String(itemGroupKey).trim(), sku: code, variantQuantities })
        : await callEdge("ebay-manage-listing", { action: "publish", offerId: String(offerId).trim(), sku: code, quantity: publishQuantityForProduct(product) });
      if (result.success) {
        showStatus(`✅ Published! Listing ID: ${result.listingId}`);
        loadProducts();
      } else {
        showStatus("❌ " + (result.error || "Publish failed"), true);
      }
    } catch (e) { showStatus("❌ " + e.message, true); }
  }

  return { discardDraft, doWithdraw, doPublish };
}
