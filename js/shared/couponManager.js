/**
 * Coupon Manager
 * Handles coupon code validation and application
 */

import { validateCouponCode, checkPromotionApplies } from "./promotionLoader.js";
import { getCart } from "./cartStore.js";

// Global coupon state — persisted to localStorage for cross-page navigation
const COUPON_KEY = "kk_applied_coupon";
let appliedCoupon = loadPersistedCoupon();

function loadPersistedCoupon() {
  try {
    const raw = localStorage.getItem(COUPON_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistCoupon(coupon) {
  try {
    if (coupon) {
      localStorage.setItem(COUPON_KEY, JSON.stringify(coupon));
    } else {
      localStorage.removeItem(COUPON_KEY);
    }
  } catch {
    // localStorage full — skip
  }
}

/**
 * Apply a coupon code
 * @param {string} code - Coupon code to apply
 * @returns {Promise<{valid: boolean, message: string, promo: object|null}>}
 */
export async function applyCoupon(code) {
  const cart = getCart();
  if (cart.length === 0) {
    return { valid: false, message: "Cart is empty", promo: null };
  }

  const result = await validateCouponCode(code, cart);
  
  if (result.valid) {
    appliedCoupon = result.promo;
    persistCoupon(appliedCoupon);
    console.log("[Coupon] Applied:", appliedCoupon.code);
  } else {
    appliedCoupon = null;
    persistCoupon(null);
  }

  return result;
}

/**
 * Remove the currently applied coupon
 */
export function removeCoupon() {
  appliedCoupon = null;
  persistCoupon(null);
  console.log("[Coupon] Removed");
}

/**
 * Get the currently applied coupon
 * @returns {object|null}
 */
export function getAppliedCoupon() {
  return appliedCoupon;
}

/**
 * Calculate discount from applied coupon (scope-aware)
 * @param {number} subtotal - Cart subtotal (used for scope_type="all")
 * @param {Array} items - Cart items (used for scoped coupons)
 * @returns {number} - Coupon discount amount
 */
export function calculateCouponDiscount(subtotal = 0, items = []) {
  if (!appliedCoupon) return 0;

  const sub = Number(subtotal || 0);
  const scopeType = appliedCoupon.scope_type || "all";

  // Determine the eligible subtotal based on scope
  let eligibleSubtotal = sub;

  if (scopeType !== "all" && items && items.length > 0) {
    // Only count items matching the coupon's scope
    eligibleSubtotal = items.reduce((sum, it) => {
      if (checkPromotionApplies(appliedCoupon, it)) {
        return sum + Number(it.price || 0) * Math.max(1, Number(it.qty || 1));
      }
      return sum;
    }, 0);

    // Don't exceed the overall subtotal passed in (which may have auto-discounts removed)
    eligibleSubtotal = Math.min(eligibleSubtotal, sub);
  }

  let discount = 0;

  switch (appliedCoupon.type) {
    case "percentage":
      discount = (eligibleSubtotal * Number(appliedCoupon.value || 0)) / 100;
      break;
    case "fixed":
      discount = Number(appliedCoupon.value || 0);
      break;
    default:
      discount = 0;
  }

  // Coupon discount can't exceed the eligible subtotal
  return Math.max(0, Math.min(discount, eligibleSubtotal));
}

/**
 * Get coupon display info
 * @returns {object} - { code, name, discount_amount }
 */
export function getCouponDisplayInfo(subtotal = 0) {
  if (!appliedCoupon) return null;

  const discount = calculateCouponDiscount(subtotal);
  return {
    code: appliedCoupon.code,
    name: appliedCoupon.name,
    type: appliedCoupon.type,
    value: appliedCoupon.value,
    discount_amount: discount,
  };
}
