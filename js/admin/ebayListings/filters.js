/**
 * filters.js — eBay Listings admin: product filter predicates.
 *
 * Pure filter logic. No DOM writes. No page-state mutation.
 * Depends only on listingHealth.js for computeHealth.
 *
 * Imported by index.js.
 * Must not import index.js (no circular imports).
 */

import { computeHealth } from "./listingHealth.js";

/**
 * Filter a product list by search query, status, and quick-filter value.
 *
 * @param {Array}  products  — full product array (allProducts)
 * @param {string} query     — lowercase trimmed search string
 * @param {string} statusVal — status filter value ("active", "draft", "ended", "not_listed", or "")
 * @param {string} quickVal  — quick filter value ("needs_work", "no_sales_30d", "has_promo",
 *                             "low_score", "draft_stalled", "missing_basics", or "")
 * @returns {Array} filtered product array
 */
export function filterProducts(products, query, statusVal, quickVal) {
  return products.filter(p => {
    // ── Search ──────────────────────────────────────────────
    if (query) {
      const haystack = `${p.name} ${p.code} ${p.ebay_sku || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    // ── Status filter ────────────────────────────────────────
    if (statusVal) {
      const pStatus = p.ebay_status || "not_listed";
      if (pStatus !== statusVal) return false;
    }

    // ── Quick filters ────────────────────────────────────────
    if (quickVal === "needs_work") {
      if (!p._ws || (p._ws.issue_count ?? 0) === 0) return false;
    } else if (quickVal === "no_sales_30d") {
      const st = p.ebay_status || "not_listed";
      if (st !== "active") return false;
      if (p._ws && (p._ws.sold_qty_30d ?? 0) > 0) return false;
    } else if (quickVal === "has_promo") {
      if (!p.ebay_volume_promo_id) return false;
    } else if (quickVal === "low_score") {
      const h = computeHealth(p);
      if (h.score === null || h.score >= 60) return false;
    } else if (quickVal === "draft_stalled") {
      if (p.ebay_status !== "draft" || p.ebay_offer_id) return false;
    } else if (quickVal === "missing_basics") {
      const basicFlags = ["missing_category", "missing_ebay_price", "missing_listing_id"];
      const wsFlags    = p._ws?.issue_flags || {};
      const hasMissing = basicFlags.some(f => !!wsFlags[f]);
      if (!hasMissing) return false;
    }

    return true;
  });
}
