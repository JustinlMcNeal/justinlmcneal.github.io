/**
 * reconcileActions.js — eBay listing stale-link reconciliation workflow.
 *
 * Owns:
 *   - reconcileEbayLink(product, relink) — calls edge function reconcile_listing
 *   - auditListingLinks(products)        — background audit of all linked products
 *   - relinkEbayListing(code)            — user-triggered relink action
 *   - clearStaleEbayLink(code)           — user-triggered clear-stale action
 *   - renderEditLinkWarning(check)       — renders stale-link warning in edit modal
 *
 * Does NOT own:
 *   - openEdit / openPush / save handlers
 *   - allProducts state
 *   - product loading or rendering orchestration
 *
 * Dependencies injected from index.js to avoid circular imports.
 * callEdge imported directly from api.js (allowed — no circular path).
 */

import { callEdge } from "./api.js";
import {
  isLinkedOnEbay,
  isLinkWarningCheck,
  isOutOfStockLinkCheck,
  isStaleLinkCheck,
  staleLinkLabel,
  staleLinkMessage,
  currentActiveListingId,
} from "./linkCheck.js";
import { esc, variantSkuFromOption } from "./utils.js";

function expectedVariantSkus(product) {
  return (product?.product_variants || [])
    .filter(v => v?.is_active)
    .map(v => variantSkuFromOption(product.code, v.option_value));
}

function diagnosticSummary(diagnostic) {
  const d = diagnostic || {};
  const mismatched = Array.isArray(d.mismatchedLocalSkus) ? d.mismatchedLocalSkus.filter(Boolean) : [];
  if (mismatched.length) return `Local variants do not match the eBay group variants: ${mismatched.join(", ")}.`;
  const unavailable = Array.isArray(d.unavailableOfferSkus) ? d.unavailableOfferSkus.filter(Boolean) : [];
  if (unavailable.length) return `eBay says these child offers are not available: ${unavailable.join(", ")}.`;
  const missing = Array.isArray(d.missingOfferSkus) ? d.missingOfferSkus.filter(Boolean) : [];
  if (missing.length) return `eBay could not find active child offers for: ${missing.join(", ")}.`;
  const activeListingIds = Array.isArray(d.activeListingIds) ? d.activeListingIds.filter(Boolean) : [];
  if (d.inventoryItemGroupKey && !activeListingIds.length) return "No active eBay listing was found for this variant group.";
  return "Offer mapping could not be verified.";
}

/**
 * Wire up the reconcile action cluster.
 *
 * @param {{ getProducts: () => any[], renderAll: () => void, loadProducts: () => Promise<void>, showStatus: (msg: string, isError?: boolean) => void }} deps
 */
export function createReconcileActions({ getProducts, renderAll, loadProducts, showStatus }) {
  let linkAuditRunId = 0;

  async function reconcileEbayLink(product, relink = false) {
    const sku = product.ebay_sku || product.code;
    const result = await callEdge("ebay-manage-listing", {
      action: "reconcile_listing",
      productCode: product.code,
      sku,
      inventoryItemGroupKey: product.ebay_item_group_key || undefined,
      expectedSkus: product.ebay_item_group_key ? expectedVariantSkus(product) : undefined,
      localOfferId: product.ebay_offer_id || undefined,
      localListingId: product.ebay_listing_id || undefined,
      relink,
    });
    if (!result?.success && result?.code === "RECONCILE_OFFERS_FAILED") {
      result.state = result.state || "offer_mapping_unresolved";
      result.stale = true;
      result.safeRelink = false;
      result.message = result.message || "This listing's active eBay offer mapping could not be verified. Refresh/relink before editing.";
    }
    if (result?.state === "no_active_match" && product.ebay_status !== "active") {
      result.state = "no_active_match_non_active";
      result.stale = false;
    }
    product._linkCheck = result;
    return result;
  }

  async function auditListingLinks(products) {
    const list = products ?? getProducts();
    const runId = ++linkAuditRunId;
    const candidates = list.filter(isLinkedOnEbay);
    if (!candidates.length) return;
    let staleCount = 0;
    for (const product of candidates) {
      if (runId !== linkAuditRunId) return;
      try {
        const check = await reconcileEbayLink(product, false);
        if (isLinkWarningCheck(check)) staleCount++;
      } catch (err) {
        console.warn("eBay link audit failed", product.code, err);
        product._linkCheck = { success: false, error: err.message || String(err) };
      }
    }
    if (runId !== linkAuditRunId) return;
    renderAll();
    if (staleCount) showStatus(`⚠️ ${staleCount} eBay listing${staleCount === 1 ? "" : "s"} need attention. Some may be stale or sold out on eBay.`, true);
  }

  async function relinkEbayListing(code) {
    const product = getProducts().find(p => p.code === code);
    if (!product) return;
    if (!confirm(`Relink ${product.code} to the single active eBay match found for this SKU? No new listing will be created.`)) return;
    showStatus(`Relinking ${product.code} to current active eBay listing…`);
    try {
      const result = await reconcileEbayLink(product, true);
      if (!result.success || !result.relinked) {
        showStatus(`❌ ${result.message || result.error || "Relink was not safe"}`, true);
        renderAll();
        return;
      }
      showStatus(`✅ Relinked ${product.code} to active eBay listing ${result.activeMatch?.listingId || ""}`);
      await loadProducts();
    } catch (err) {
      showStatus(`❌ ${err.message || String(err)}`, true);
    }
  }

  async function clearStaleEbayLink(code) {
    const product = getProducts().find(p => p.code === code);
    if (!product) return;
    if (!confirm(`Clear stale local eBay link for ${product.code}? This only updates the website record; it will not create, edit, or end anything on eBay.`)) return;
    showStatus(`Clearing stale local eBay link for ${product.code}…`);
    try {
      const result = await callEdge("ebay-manage-listing", {
        action: "clear_stale_listing_link",
        productCode: product.code,
      });
      if (!result.success) {
        showStatus(`❌ ${result.message || result.error || "Clear stale link failed"}`, true);
        return;
      }
      showStatus(`✅ Cleared stale eBay link for ${product.code}. Use Re-list to push it again when ready.`);
      await loadProducts();
    } catch (err) {
      showStatus(`❌ ${err.message || String(err)}`, true);
    }
  }

  function renderEditLinkWarning(check) {
    const box = document.getElementById("editLinkWarning");
    const text = document.getElementById("editLinkWarningText");
    const meta = document.getElementById("editLinkWarningMeta");
    const btn = document.getElementById("btnEditRelink");
    if (!box || !text || !meta || !btn) return;
    if (!isLinkWarningCheck(check)) {
      box.classList.add("hidden");
      btn.classList.add("hidden");
      return;
    }
    const activeId = currentActiveListingId(check);
    text.textContent = staleLinkMessage(check);
    if (isOutOfStockLinkCheck(check)) {
      const oq = check.activeMatch?.offerQuantity ?? "?";
      const iq = check.activeMatch?.inventoryQuantity ?? "?";
      meta.innerHTML = `Offer qty: ${esc(String(oq))} · Inventory qty: ${esc(String(iq))}. Use Restock/Edit to set quantity above 0.`;
    } else if (check.state === "offer_mapping_unresolved" || check.state === "ebay_api_failure") {
      meta.textContent = `${diagnosticSummary(check.diagnostic)} Save is blocked until the listing is refreshed/relinked or marked ended.`;
    } else {
      meta.innerHTML = activeId
      ? `Current active match found: <a href="https://www.ebay.com/itm/${esc(activeId)}" target="_blank" class="underline font-bold">${esc(activeId)} ↗</a>`
      : staleLinkLabel(check);
    }
    btn.classList.toggle("hidden", !check.safeRelink);
    box.classList.remove("hidden");
  }

  return { reconcileEbayLink, auditListingLinks, relinkEbayListing, clearStaleEbayLink, renderEditLinkWarning };
}
