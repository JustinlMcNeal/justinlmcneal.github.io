/**
 * cartTotals.js
 * ALL math lives here
 *
 * Option A:
 * - Promotions section shows ONLY auto-promos
 * - Coupon line shows ALL coupon types (percentage/fixed/bogo)
 */

import {
  getCartPromotions,
  calculatePromotionDiscount,
  calculateBogoDiscount,
} from "../promotions/index.js";

import {
  getAppliedCoupon,
  calculateCouponDiscount,
} from "../couponManager.js";

function toCents(n) {
  return Math.max(0, Math.round(Number(n || 0) * 100));
}

function pickCouponCode(coupon) {
  if (!coupon) return "";
  return String(coupon.code || coupon.coupon_code || coupon.couponCode || "").trim();
}

export async function calculateCartTotals(items) {
  const safeItems = items || [];

  const subtotal = safeItems.reduce(
    (s, it) => s + Number(it.price) * Math.max(1, Number(it.qty || 1)),
    0
  );

  // 1) AUTO promos only
  const autoPromos = await getCartPromotions(safeItems);

  // 2) Auto %/fixed promos
  const { totalDiscount: autoPromoDiscount, breakdown: promoBreakdown } =
    calculatePromotionDiscount(autoPromos, subtotal);

  // 3) Auto BOGO promos
  const { totalDiscount: autoBogoDiscount, breakdown: bogoBreakdown } =
    calculateBogoDiscount(autoPromos, safeItems);

  const autoDiscount = autoPromoDiscount + autoBogoDiscount;

  // 4) Coupon (any type)
  const coupon = getAppliedCoupon();

  let couponAmount = 0;
  let couponMeta = null;

  if (coupon) {
    const t = String(coupon.type || "").toLowerCase();

    // % / fixed coupon
    if (t === "percentage" || t === "fixed") {
      couponAmount = calculateCouponDiscount(subtotal - autoDiscount);
    }

    // BOGO coupon
    else if (t === "bogo") {
      const res = calculateBogoDiscount([coupon], safeItems);
      couponAmount = Number(res.totalDiscount || 0);
      couponMeta = res.breakdown?.[0]?.meta || null;
    }
  }

  const total = Math.max(0, subtotal - autoDiscount - couponAmount);

  return {
    subtotal,
    total,

    // promos section = auto promos only
    promoBreakdown,
    bogoBreakdown,

    // coupon line = all coupon types
    coupon,
    couponDiscount: couponAmount,
    couponMeta,

    // ✅ expose this so checkout can compute promo payload
    autoDiscount,
  };
}

/**
 * ✅ Build metadata payload for Supabase create-checkout-session.
 * Supports double-discount (auto + code).
 */
export async function buildCheckoutPromoPayload(items) {
  const totals = await calculateCartTotals(items);

  const code = pickCouponCode(totals.coupon);

  const autoSavingsCents = toCents(totals.autoDiscount);
  const codeSavingsCents = toCents(totals.couponDiscount);
  const totalSavingsCents = autoSavingsCents + codeSavingsCents;

  // Optional: promo ids (helps debug)
  const appliedIds = [];

  for (const row of totals.promoBreakdown || []) {
    const id = row?.promo?.id || row?.promo?.uuid || row?.promo?.promo_id;
    if (id) appliedIds.push(String(id));
  }
  for (const row of totals.bogoBreakdown || []) {
    const id = row?.promo?.id || row?.promo?.uuid || row?.promo?.promo_id;
    if (id) appliedIds.push(String(id));
  }
  const couponId = totals.coupon?.id || totals.coupon?.uuid;
  if (couponId) appliedIds.push(String(couponId));

  return {
    code, // only 1 manual code
    savings_cents: totalSavingsCents,       // ✅ auto + code
    savings_code_cents: codeSavingsCents,   // ✅ code only
    savings_auto_cents: autoSavingsCents,   // ✅ auto only
    applied_ids: Array.from(new Set(appliedIds)).slice(0, 20),
  };
}
