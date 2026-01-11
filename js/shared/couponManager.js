/**
 * Coupon Manager
 * Handles coupon code validation and application
 */

import { validateCouponCode } from "./promotionLoader.js";
import { getCart } from "./cartStore.js";

// Global coupon state
let appliedCoupon = null;

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
    console.log("[Coupon] Applied:", appliedCoupon.code);
  } else {
    appliedCoupon = null;
  }

  return result;
}

/**
 * Remove the currently applied coupon
 */
export function removeCoupon() {
  appliedCoupon = null;
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
 * Calculate discount from applied coupon
 * @param {number} subtotal - Cart subtotal
 * @returns {number} - Coupon discount amount
 */
export function calculateCouponDiscount(subtotal = 0) {
  if (!appliedCoupon) return 0;

  let discount = 0;
  const sub = Number(subtotal || 0);

  switch (appliedCoupon.type) {
    case "percentage":
      discount = (sub * Number(appliedCoupon.value || 0)) / 100;
      break;
    case "fixed":
      discount = Number(appliedCoupon.value || 0);
      break;
    default:
      discount = 0;
  }

  return Math.max(0, Math.min(discount, sub));
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
