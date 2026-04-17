// js/checkout/summary.js
// Order summary sidebar: totals, promos, coupon, shipping, delivery estimate, free shipping bar

import { renderFreeShippingBar, getFreeShippingSettings } from "../shared/cart/freeShippingBar.js";
import { applyCoupon, removeCoupon, getAppliedCoupon } from "../shared/couponManager.js";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ── Estimated delivery date ── */
function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

function getEstimatedDelivery(hasBackorder) {
  const now = new Date();
  const fmt = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  if (hasBackorder) {
    // Backorder: 3-4 weeks (15-20 business days)
    const from = addBusinessDays(now, 15);
    const to = addBusinessDays(now, 20);
    return `${fmt(from)} – ${fmt(to)}`;
  }

  // Normal: 5-8 business days
  const from = addBusinessDays(now, 5);
  const to = addBusinessDays(now, 8);
  return `${fmt(from)} – ${fmt(to)}`;
}

function getShippingTimeText(hasBackorder) {
  return hasBackorder
    ? "Ships in 3–4 weeks (backorder)"
    : "Ships in 2–5 business days";
}

/* ── Update summary UI ── */
/**
 * @param {Object} totals - from calculateCartTotals
 * @param {Object} [stockInfo] - { cartItems, stockMap } for backorder detection
 */
export async function updateSummary(totals, stockInfo = {}) {
  const {
    subtotal = 0,
    total = 0,
    promoBreakdown = [],
    bogoBreakdown = [],
    couponDiscount = 0,
    coupon = null,
    couponMeta = null,
    autoDiscount = 0,
  } = totals || {};

  // Detect if any cart item is on backorder (stock <= 0) or made-to-order
  const { cartItems = [], stockMap = {}, mtoSet = new Set() } = stockInfo;
  const hasBackorder = cartItems.some((item) => {
    if (mtoSet.has(item.id)) return true;
    const key = `${item.id}::${(item.variant ?? "").toString().trim()}`;
    const stock = stockMap[key];
    return typeof stock === "number" && stock <= 0;
  });

  // Subtotal
  const subtotalEl = document.getElementById("checkoutSubtotal");
  if (subtotalEl) subtotalEl.textContent = money(subtotal);

  // Total
  const totalEl = document.getElementById("checkoutTotal");
  if (totalEl) totalEl.textContent = money(total);

  // Mobile sticky total
  const mobileTotalEl = document.getElementById("mobileStickyTotal");
  if (mobileTotalEl) mobileTotalEl.textContent = money(total);

  // Delivery estimate (backorder-aware)
  const deliveryEl = document.getElementById("checkoutDelivery");
  if (deliveryEl) {
    deliveryEl.textContent = getEstimatedDelivery(hasBackorder);
    if (hasBackorder) {
      deliveryEl.classList.add("text-amber-600");
    } else {
      deliveryEl.classList.remove("text-amber-600");
    }
  }

  // Shipping time friction reducer text (backorder-aware)
  const shipTimeEl = document.getElementById("checkoutShipTime");
  if (shipTimeEl) {
    shipTimeEl.textContent = getShippingTimeText(hasBackorder);
    if (hasBackorder) {
      shipTimeEl.classList.add("text-amber-600");
    } else {
      shipTimeEl.classList.remove("text-amber-600");
    }
  }

  // Free shipping bar
  const freeShipEl = document.getElementById("checkoutFreeShipping");
  if (freeShipEl) await renderFreeShippingBar(total, freeShipEl);

  // Free shipping nudge
  await renderFreeShipNudge(total);

  // Shipping line
  const shippingEl = document.getElementById("checkoutShipping");
  if (shippingEl) {
    const settings = await getFreeShippingSettings();
    const threshold = parseFloat(settings?.threshold) || 50;
    const freeShipCoupon = coupon && String(coupon.type || "").toLowerCase() === "free_shipping";

    if (total >= threshold || freeShipCoupon) {
      shippingEl.textContent = "FREE";
      shippingEl.classList.add("text-green-600");
      shippingEl.classList.remove("text-black/60");
    } else {
      shippingEl.textContent = "From $8.95";
      shippingEl.classList.remove("text-green-600");
      shippingEl.classList.add("text-black/60");
    }
  }

  // Auto promo lines
  const promosEl = document.getElementById("checkoutPromos");
  if (promosEl) {
    const combined = [
      ...(promoBreakdown || []).map(({ promo, amount }) => ({ promo, amount })),
      ...(bogoBreakdown || []).map(({ promo, amount, meta }) => ({ promo, amount, meta })),
    ];

    if (combined.length) {
      promosEl.innerHTML = combined
        .map(({ promo, amount, meta }) => {
          const isBogo = String(promo?.type || "").toLowerCase() === "bogo";
          const label =
            isBogo && meta?.freeCount
              ? `${promo?.name || "BOGO"} (free x${meta.freeCount})`
              : promo?.name || "Promotion";

          return `
            <div class="flex justify-between items-center text-xs">
              <span class="flex items-center gap-1 text-black/60 truncate">
                <span class="text-green-500">🏷️</span> ${esc(label)}
              </span>
              <span class="font-bold text-green-600">-${money(amount)}</span>
            </div>
          `;
        })
        .join("");
    } else {
      promosEl.innerHTML = "";
    }
  }

  // Coupon discount line
  const couponLineEl = document.getElementById("checkoutCouponLine");
  const couponLabelEl = document.getElementById("checkoutCouponLabel");
  const couponAmountEl = document.getElementById("checkoutCouponAmount");

  if (couponLineEl) {
    if (couponDiscount > 0 && coupon) {
      const code = String(coupon.code || "").trim();
      const name = String(coupon.name || "").trim();
      const label = name || code || "Coupon";
      const isBogo = String(coupon.type || "").toLowerCase() === "bogo";

      couponLineEl.classList.remove("hidden");
      couponLineEl.classList.add("flex");
      if (couponLabelEl) {
        couponLabelEl.innerHTML = `
          <span class="flex items-center gap-1 truncate">
            ${esc(isBogo && couponMeta?.freeCount ? `${label} (free x${couponMeta.freeCount})` : label)}
            <button type="button" data-checkout-remove-coupon class="text-red-400 hover:text-red-600 ml-1" aria-label="Remove coupon">✕</button>
          </span>
        `;
      }
      if (couponAmountEl) couponAmountEl.textContent = `-${money(couponDiscount)}`;
    } else {
      couponLineEl.classList.add("hidden");
      couponLineEl.classList.remove("flex");
    }
  }

  // Savings badge
  const totalSavings = autoDiscount + couponDiscount;
  const savingsEl = document.getElementById("checkoutSavings");
  const savingsAmountEl = document.getElementById("checkoutSavingsAmount");
  if (savingsEl) {
    if (totalSavings > 0) {
      savingsEl.classList.remove("hidden");
      if (savingsAmountEl) savingsAmountEl.textContent = money(totalSavings);
    } else {
      savingsEl.classList.add("hidden");
    }
  }
}

/* ── Free shipping nudge ── */
async function renderFreeShipNudge(total) {
  const nudgeEl = document.getElementById("checkoutFreeShipNudge");
  const nudgeAmountEl = document.getElementById("nudgeAmount");
  if (!nudgeEl) return;

  const settings = await getFreeShippingSettings();
  if (!settings?.enabled) {
    nudgeEl.classList.add("hidden");
    return;
  }

  const threshold = parseFloat(settings.threshold) || 50;
  const remaining = threshold - total;

  if (remaining > 0 && remaining < threshold) {
    nudgeEl.classList.remove("hidden");
    if (nudgeAmountEl) nudgeAmountEl.textContent = money(remaining);
  } else {
    nudgeEl.classList.add("hidden");
  }
}

/* ── Coupon UI wiring ── */
export function wireCouponUI(onCartChange) {
  const input = document.getElementById("checkoutCouponInput");
  const applyBtn = document.getElementById("checkoutCouponApply");
  const msgEl = document.getElementById("checkoutCouponMsg");

  if (!applyBtn) return;

  async function handleApply() {
    const code = (input?.value || "").trim();
    if (!code) return;

    applyBtn.disabled = true;
    applyBtn.textContent = "...";

    try {
      const result = await applyCoupon(code);

      if (msgEl) {
        msgEl.classList.remove("hidden", "text-red-500", "text-green-600");
        if (result.valid) {
          msgEl.classList.add("text-green-600");
          msgEl.textContent = `✓ ${result.name || code} applied!`;
        } else {
          msgEl.classList.add("text-red-500");
          msgEl.textContent = result.error || "Invalid coupon code";
        }
      }

      if (result.valid) onCartChange();
    } catch (err) {
      if (msgEl) {
        msgEl.classList.remove("hidden", "text-green-600");
        msgEl.classList.add("text-red-500");
        msgEl.textContent = "Failed to validate coupon";
      }
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = "Apply";
    }
  }

  applyBtn.addEventListener("click", handleApply);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleApply();
    }
  });

  // Remove coupon (delegated)
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-checkout-remove-coupon]")) {
      removeCoupon();
      if (input) input.value = "";
      if (msgEl) {
        msgEl.classList.add("hidden");
        msgEl.textContent = "";
      }
      onCartChange();
    }
  });

  // Pre-fill if coupon was applied in cart drawer (persisted via localStorage)
  const existing = getAppliedCoupon();
  if (existing && input) {
    input.value = existing.code || "";
    if (msgEl) {
      msgEl.classList.remove("hidden", "text-red-500");
      msgEl.classList.add("text-green-600");
      msgEl.textContent = `✓ ${existing.name || existing.code} applied!`;
    }
  }
}

/* ── Review badge (store rating) ── */
export async function loadReviewBadge() {
  try {
    const { getSupabaseClient } = await import("../shared/supabaseClient.js");
    const supabase = getSupabaseClient();
    const { count } = await supabase
      .from("reviews")
      .select("*", { count: "exact", head: true })
      .eq("status", "approved");

    if (count && count > 0) {
      const badge = document.getElementById("checkoutReviewBadge");
      const text = document.getElementById("checkoutReviewText");
      if (badge && text) {
        // Round to nearest 0.1
        const { data: avgData } = await supabase
          .from("reviews")
          .select("rating")
          .eq("status", "approved");

        if (avgData?.length) {
          const avg = (avgData.reduce((s, r) => s + r.rating, 0) / avgData.length).toFixed(1);
          text.textContent = `${avg}★ from ${count}+ customers`;
          badge.classList.remove("hidden");
        }
      }
    }
  } catch {
    // silently skip
  }
}
