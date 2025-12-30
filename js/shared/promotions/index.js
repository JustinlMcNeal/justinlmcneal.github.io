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

/**
 * Product page helper:
 * returns only AUTO promos (i.e., promos that do NOT require a code)
 */
export async function getProductPromotions(productId, categoryIds = [], tagIds = []) {
  const promos = await fetchActivePromotions();

  const item = {
    product_id: productId,
    category_ids: categoryIds,
    tag_ids: tagIds,
  };

  return (promos || [])
    .filter((p) => !effectiveRequiresCode(p)) // auto-only
    .filter((p) => checkPromotionApplies(p, item));
}

/**
 * Cart helper:
 * returns only AUTO promos (i.e., promos that do NOT require a code)
 */
export async function getCartPromotions(cartItems = []) {
  const promos = await fetchActivePromotions();
  const autoPromos = (promos || []).filter((p) => !effectiveRequiresCode(p));
  return getApplicablePromotions(autoPromos, cartItems);
}

/**
 * Re-exports (single public API for promotions/)
 */
export { clearPromotionCache };
export { fetchActivePromotions };

export { checkPromotionApplies, getApplicablePromotions };

export { validateCouponCode };

export { calculatePromotionDiscount, calculateBogoDiscount, getBestProductDiscount };

export { effectiveRequiresCode };
