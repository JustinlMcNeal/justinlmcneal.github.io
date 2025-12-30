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

    if (!data.is_public) {
      return { valid: false, promo: null, message: "Coupon is not available." };
    }

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
