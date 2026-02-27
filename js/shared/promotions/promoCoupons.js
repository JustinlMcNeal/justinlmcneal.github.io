// /js/shared/promotions/promoCoupons.js
import { getSupabaseClient } from "../supabaseClient.js";
import { isWithinDateWindow, effectiveRequiresCode } from "./promoUtils.js";
import { getApplicablePromotions } from "./promoScope.js";

const supabase = getSupabaseClient();

/**
 * Coupon validation by code
 * Only promos that effectively require a code are valid coupons.
 */
export async function validateCouponCode(code = "", cartItems = []) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return { valid: false, promo: null, message: "Coupon code is required." };

  // ── Review coupon (THANKS-XXXXXX) ──────────────────────────
  if (c.startsWith("THANKS-")) {
    return validateReviewCoupon(c, cartItems);
  }

  // ── Regular promotion coupon ───────────────────────────────
  try {
    const { data, error } = await supabase
      .from("promotions")
      .select("*")
      .eq("code", c)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { valid: false, promo: null, message: "Coupon not found." };

    // Must require a code to be treated as a coupon
    if (!effectiveRequiresCode(data)) {
      return { valid: false, promo: null, message: "This promotion does not accept a code." };
    }

    // Note: is_public check removed - code-based coupons work regardless of is_public
    // since the user needs the secret code to apply them anyway.

    if (!isWithinDateWindow(data)) {
      return { valid: false, promo: null, message: "Coupon is not active." };
    }

    // Optional scope validation against cart
    const applicable = getApplicablePromotions([data], cartItems);
    if ((data.scope_type || "all") !== "all" && applicable.length === 0) {
      return { valid: false, promo: null, message: "Coupon does not apply to your cart." };
    }

    return { valid: true, promo: data, message: "Coupon applied!" };
  } catch (e) {
    console.error("[Coupon] validateCouponCode error:", e);
    return { valid: false, promo: null, message: "Error validating coupon." };
  }
}

/**
 * Validate a review coupon (THANKS-XXXXXX) against the review_coupons table.
 * Returns a "promo-like" object so the existing coupon pipeline works seamlessly.
 */
async function validateReviewCoupon(code, cartItems = []) {
  try {
    const { data, error } = await supabase
      .from("review_coupons")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { valid: false, promo: null, message: "Coupon not found." };

    // Already used?
    if (data.used_at) {
      return { valid: false, promo: null, message: "This coupon has already been used." };
    }

    // Expired?
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { valid: false, promo: null, message: "This coupon has expired." };
    }

    // Minimum order check
    if (data.min_order && Number(data.min_order) > 0) {
      const subtotal = cartItems.reduce(
        (sum, it) => sum + Number(it.price || 0) * Number(it.qty || 1),
        0
      );
      if (subtotal < Number(data.min_order)) {
        return {
          valid: false,
          promo: null,
          message: `Minimum order of $${Number(data.min_order).toFixed(2)} required.`,
        };
      }
    }

    // Build a promo-like object for the coupon pipeline
    const promoLike = {
      id: `review_coupon:${data.id}`,
      code: data.code,
      name: "Review Thank-You Discount",
      type: data.discount_type,          // "percentage" or "fixed"
      value: Number(data.discount_value), // e.g. 5 (percent) or dollar amount
      scope_type: "all",
      requires_code: true,
      is_active: true,
      _review_coupon_id: data.id,         // flag so checkout can mark it used
      _is_review_coupon: true,
    };

    return { valid: true, promo: promoLike, message: "Review coupon applied!" };
  } catch (e) {
    console.error("[Coupon] validateReviewCoupon error:", e);
    return { valid: false, promo: null, message: "Error validating coupon." };
  }
}
