/**
 * editFetch.js — Transient eBay fetch helpers for edit-session hydration.
 *
 * Exports:
 *   shortDelay(ms)                           — Promise-based delay
 *   ebayErrorIds(payload)                    — extract numeric error IDs from edge result
 *   isTransientGetItemFailure(result)        — detect 5xx / known transient eBay errors
 *   getItemForEdit(sku)                      — get_item with one retry on transient failure
 *   getOffersForEdit(cache, sku, context)    — get_offers with per-session Map cache
 *   getOffersByGroupForEdit(cache, groupKey, variantSKUs, context, localExpectedSkus) — group get_offers, cached + fanned out by SKU
 *   offerMappingDiagnosticMessage(result, fallback) — summarize group mapping diagnostics
 *   offerUpdateErrorMessage(result, fallback) — normalize offer update error message
 *
 * Does NOT own:
 *   editOfferLookupCache — stays in index.js (passed as a parameter to getOffersForEdit)
 *   openEdit / renderEditVariantImageControls — stay in index.js
 *   edit save handler — stays in index.js
 *   DOM rendering — stays in index.js
 *   showStatus / page state — stay in index.js
 */

import { callEdge } from "./api.js";

// ── Delay helper ──────────────────────────────────────────────

export function shortDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── eBay error ID extraction ──────────────────────────────────

export function ebayErrorIds(payload) {
  const errors = payload?.errors || payload?.upstream?.errors || payload?.upstreamData?.errors || [];
  return Array.isArray(errors) ? errors.map(e => Number(e?.errorId)).filter(Number.isFinite) : [];
}

// ── Transient failure detection ───────────────────────────────

export function isTransientGetItemFailure(result) {
  const status = Number(result?.upstreamStatus || result?.status || 0);
  const ids    = ebayErrorIds(result);
  const detail = `${result?.error || ""} ${JSON.stringify(result?.upstream || result?.upstreamData || {})}`;
  return status >= 500 || ids.includes(25001) || /system error|api_inventory|25001/i.test(detail);
}

// ── get_item with retry-once ──────────────────────────────────

/**
 * Fetches an eBay inventory item by SKU for edit hydration.
 * Retries once on transient (5xx / known transient) failures.
 * Returns result with { success, retried, fallback? } shape.
 *
 * @param {string} sku
 * @returns {Promise<object>}
 */
export async function getItemForEdit(sku) {
  try {
    const first = await callEdge("ebay-manage-listing", { action: "get_item", sku });
    if (first.success) return { ...first, retried: false };
    if (!isTransientGetItemFailure(first)) {
      console.warn(`[edit] get_item failed for ${sku}; using fallback:`, first.error || first);
      return { ...first, success: false, retried: false, fallback: true };
    }

    console.warn(`[edit] get_item failed for ${sku}; retrying once:`, first.error || first);
    await shortDelay(600);
    const second = await callEdge("ebay-manage-listing", { action: "get_item", sku });
    if (second.success) return { ...second, retried: true };

    console.warn(`[edit] get_item failed for ${sku} after retry; using fallback:`, second.error || second);
    return { ...second, success: false, retried: true, fallback: true };
  } catch (e) {
    console.warn(`[edit] get_item error for ${sku}; retrying once:`, e.message);
    await shortDelay(600);
    try {
      const retry = await callEdge("ebay-manage-listing", { action: "get_item", sku });
      if (retry.success) return { ...retry, retried: true };
      console.warn(`[edit] get_item failed for ${sku} after retry; using fallback:`, retry.error || retry);
      return { ...retry, success: false, retried: true, fallback: true };
    } catch (retryErr) {
      console.warn(`[edit] get_item error for ${sku} after retry; using fallback:`, retryErr.message);
      return { success: false, error: retryErr.message, retried: true, fallback: true };
    }
  }
}

// ── get_offers with per-session cache ─────────────────────────

/**
 * Fetches eBay offers for a SKU, memoizing results in a per-session Map.
 * The caller owns and resets the cache (typically `editOfferLookupCache` in index.js).
 *
 * @param {Map}    cache   — per-session Map passed from index.js
 * @param {string} sku
 * @param {string} [context="edit"] — label for console warning
 * @returns {Promise<object>}
 */
function normalizeOfferLookupResult(result, cacheKey) {
  return result?.success
    ? { ...result, cached: false }
    : {
        ...result,
        success: false,
        offers: [],
        cached: false,
        cacheKey,
        error: result?.message || result?.error || "Offer lookup failed",
      };
}

export async function getOffersForEdit(cache, sku, context = "edit") {
  const key = String(sku || "").trim();
  if (!key) return { success: false, offers: [], error: "sku is required", cached: false };
  if (cache.has(key)) {
    return { ...cache.get(key), cached: true };
  }

  const result = await callEdge("ebay-manage-listing", { action: "get_offers", sku: key });
  const normalized = normalizeOfferLookupResult(result, key);

  cache.set(key, normalized);
  if (!normalized.success) {
    console.warn(`[edit:${context}] get_offers failed for ${key}; cached failure to avoid repeated requests`, normalized);
  }
  return normalized;
}

/**
 * Fetches offers for a variant inventory item group, caches the group result,
 * and fans out each returned offer under its SKU for later save-time reuse.
 * Save code must not re-query failed SKU lookups from the same modal session.
 *
 * @param {Map} cache
 * @param {string} inventoryItemGroupKey
 * @param {string[]} [variantSKUs]
 * @param {string} [context="edit"]
 * @param {string[]} [localExpectedSkus]
 * @returns {Promise<object>}
 */
const GROUP_OFFER_RETRY_REASONS = new Set([
  "GROUP_CHILD_OFFERS_MISSING",
  "NO_ACTIVE_EBAY_MATCH",
  "GROUP_CHILD_OFFER_LOOKUP_FAILED",
]);

function groupOfferLookupRetryable(result) {
  const reason = result?.reasonCode || result?.diagnostic?.reasonCode || "";
  return !result?.success && GROUP_OFFER_RETRY_REASONS.has(reason);
}

export async function getOffersByGroupForEdit(cache, inventoryItemGroupKey, variantSKUs = [], context = "edit", localExpectedSkus = [], productCode = "") {
  const key = String(inventoryItemGroupKey || "").trim();
  if (!key) return { success: false, offers: [], error: "inventoryItemGroupKey is required", cached: false };
  const cacheKey = `group:${key}`;
  if (cache.has(cacheKey)) {
    return { ...cache.get(cacheKey), cached: true };
  }

  let result = await callEdge("ebay-manage-listing", { action: "get_offers", productCode, inventoryItemGroupKey: key, variantSKUs, localExpectedSkus });
  if (groupOfferLookupRetryable(result)) {
    console.info(`[edit:${context}] group offer mapping not ready for ${key}; retrying once after short delay`);
    await shortDelay(1500);
    const retry = await callEdge("ebay-manage-listing", { action: "get_offers", productCode, inventoryItemGroupKey: key, variantSKUs, localExpectedSkus });
    if (retry?.success) result = retry;
  }
  const normalized = normalizeOfferLookupResult(result, cacheKey);
  cache.set(cacheKey, normalized);

  if (normalized.success) {
    for (const offer of normalized.offers || []) {
      const offerSku = typeof offer?.sku === "string" ? offer.sku.trim() : "";
      if (offerSku) cache.set(offerSku, { ...normalized, offers: [offer], cached: false, cacheKey: offerSku });
    }
  } else {
    const log = normalized.state === "offer_mapping_unresolved" ? console.info : console.warn;
    log(`[edit:${context}] group get_offers diagnostic for ${key}; cached result to avoid repeated requests`, normalized);
  }

  return normalized;
}

// ── Offer update error message normalization ──────────────────

export function offerMappingDiagnosticMessage(result, fallback) {
  const d = result?.diagnostic || {};
  const mismatched = Array.isArray(d.mismatchedLocalSkus) ? d.mismatchedLocalSkus.filter(Boolean) : [];
  if (mismatched.length) return "Local variant SKUs do not match eBay’s variant SKUs. Review/relink before saving.";
  const unavailable = Array.isArray(d.unavailableOfferSkus) ? d.unavailableOfferSkus.filter(Boolean) : [];
  if (unavailable.length) return `eBay could not find active child offers for: ${unavailable.join(", ")}. These variants may be ended, sold out, removed, or renamed.`;
  const missing = Array.isArray(d.missingOfferSkus) ? d.missingOfferSkus.filter(Boolean) : [];
  if (missing.length) return `eBay could not find active child offers for: ${missing.join(", ")}. These variants may be ended, sold out, removed, or renamed.`;
  if (d.reasonCode === "ACTIVE_ZERO_QUANTITY") return "Sold out on eBay — quantity is 0. Restock to make this listing purchasable again.";
  if (d.reasonCode === "GROUP_CHILD_OFFERS_MISSING" && !missing.length && !unavailable.length) {
    return "eBay child offers are still syncing after publish. Close and reopen Edit in a moment, or use Refresh/relink if this persists.";
  }
  if (d.reasonCode === "STALE_LOCAL_GROUP_KEY") return "Saved local eBay group key is stale or missing on eBay. Clear stale link or relink before saving.";
  if (d.reasonCode === "EBAY_API_FAILURE") return "eBay verification failed due to an upstream API error. Try again later before saving edits.";
  const activeListingIds = Array.isArray(d.activeListingIds) ? d.activeListingIds.filter(Boolean) : [];
  if (d.inventoryItemGroupKey && !activeListingIds.length) return "No active eBay group listing found. Clear stale link or relist later after your account restriction is resolved.";
  return result?.message || result?.error || fallback;
}

/**
 * Returns a human-readable error message for a failed offer update result.
 * Handles known structured error codes with specific messaging.
 *
 * @param {object} result
 * @param {string} fallback
 * @returns {string}
 */
export function offerUpdateErrorMessage(result, fallback) {
  if (["OFFER_NOT_AVAILABLE", "GROUP_OFFER_NOT_AVAILABLE", "STALE_OFFER_MAPPING", "RELINK_REQUIRED"].includes(result?.code)) {
    return result.message || "This eBay offer mapping could not be verified. Refresh/relink this listing before editing.";
  }
  if (result?.code === "STALE_OFFER_RELINK_REQUIRED") {
    return result.message || "This eBay offer appears to be stale after manual relist activity. Refresh/relink this listing before editing.";
  }
  if (result?.code === "OFFER_LOCATION_RELINK_REQUIRED") {
    return result.message || "Location data for this eBay offer is missing or invalid. Rebuild/relink the offer from the current eBay state before editing.";
  }
  return result?.message || result?.error || fallback;
}
