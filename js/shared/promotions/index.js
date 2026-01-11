// /js/shared/promotions/index.js

import { fetchActivePromotions } from "./promoFetch.js";
import { clearPromotionCache } from "./promoCache.js";
import { checkPromotionApplies, getApplicablePromotions } from "./promoScope.js";
import {
  calculatePromotionDiscount,
  calculateBogoDiscount,
  getBestProductDiscount,
} from "./promoDiscounts.js";
import { validateCouponCode } from "./promoCoupons.js";
import { effectiveRequiresCode } from "./promoUtils.js";

/* =========================
   INTERNAL HELPERS
========================= */

function toArr(x) {
  return Array.isArray(x) ? x : [];
}

async function getAllPromotions() {
  return toArr(await fetchActivePromotions());
}

async function getAutoPromotions() {
  const promos = await getAllPromotions();
  return promos.filter((p) => !effectiveRequiresCode(p));
}

/* =========================
   PUBLIC HELPERS
========================= */

/**
 * Product page helper:
 * returns only AUTO promos (i.e., promos that do NOT require a code)
 */
export async function getProductPromotions(productId, categoryIds = [], tagIds = []) {
  const promos = await getAutoPromotions();

  const item = {
    product_id: productId,
    category_ids: toArr(categoryIds),
    tag_ids: toArr(tagIds),
  };

  return promos.filter((p) => checkPromotionApplies(p, item));
}

/**
 * Cart helper:
 * returns only AUTO promos (i.e., promos that do NOT require a code)
 */
export async function getCartPromotions(cartItems = []) {
  const promos = await getAutoPromotions();
  return getApplicablePromotions(promos, toArr(cartItems));
}

/**
 * Optional helper (for admin/debug):
 * returns ALL active promotions (auto + code-required)
 */
export async function getAllActivePromotions() {
  return await getAllPromotions();
}

/**
 * Optional helper:
 * If you have a coupon code, resolve it to a promo (if valid) and return it.
 * - Does NOT apply it; just validates/returns the promo object (or null).
 * - Useful for cartTotals when user enters a coupon code.
 */
export async function resolveCouponPromotion(code) {
  const c = String(code || "").trim();
  if (!c) return { promo: null, error: "Missing code" };

  // validateCouponCode should be the single source of truth for coupon rules
  const result = await validateCouponCode(c);

  // Support both shapes:
  // - { ok: true, promo }
  // - { promo } with no ok
  // - { error: "..." }
  const promo = result?.promo || null;
  const ok = result?.ok ?? !!promo;

  if (!ok || !promo) {
    return { promo: null, error: result?.error || "Invalid code" };
  }

  return { promo, error: null };
}

/* =========================
   RE-EXPORTS (single API)
========================= */

export { clearPromotionCache };
export { fetchActivePromotions };

export { checkPromotionApplies, getApplicablePromotions };

export { validateCouponCode };

export {
  calculatePromotionDiscount,
  calculateBogoDiscount,
  getBestProductDiscount,
};

export { effectiveRequiresCode };
