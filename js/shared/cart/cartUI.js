/**
 * /js/shared/cart/cartUI.js
 * Cart drawer UI (Tailwind-only markup)
 *
 * Option A:
 * - Promotions list shows ONLY auto-promos (promoBreakdown + bogoBreakdown)
 * - Coupon row shows ALL coupon types (percentage/fixed/bogo)
 */

import { renderFreeShippingBar } from "./freeShippingBar.js";
import { getCartRecommendations, renderRecommendations } from "./cartRecommendations.js";

function money(n) {
  const x = Number(n || 0);
  return `$${x.toFixed(2)}`;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normVariant(v) {
  const s = (v ?? "").toString().trim();
  return s.length ? s : "";
}

export function getCartEls() {
  return {
    cartItemsEl: document.querySelector("[data-kk-cart-items]"),
    cartCountEl: document.querySelector("[data-kk-cart-count]"),
    subtotalEl: document.querySelector("[data-kk-cart-subtotal]"),
    promotionsEl: document.querySelector("#cart-promotions"),
    couponDiscountEl: document.querySelector("#cart-coupon-discount"),
    totalEl: document.querySelector("#cart-total"),
    freeShippingEl: document.getElementById("kk-free-shipping-bar"),
    recommendationsEl: document.getElementById("kk-cart-recommendations"),

    couponInput: document.getElementById("kk-coupon-input"),
    couponApplyBtn: document.getElementById("kk-coupon-apply"),
    couponMsg: document.getElementById("kk-coupon-message"),
  };
}

function formatCouponLabel(coupon, couponMeta) {
  if (!coupon) return "Coupon";

  const code = String(coupon.code || "").trim();
  const name = String(coupon.name || "").trim();
  const base = name || code || "Coupon";

  const type = String(coupon.type || "").toLowerCase();
  if (type === "bogo" && couponMeta?.freeCount) {
    return `${base} (free x${couponMeta.freeCount})`;
  }

  return base;
}

/**
 * Render cart line-items + totals UI.
 *
 * @param {Array} items - cart items
 * @param {Object} totals - from cartTotals.js
 * @param {Object} els - from getCartEls()
 */
export function renderCartItems(items = [], totals = {}, els = {}) {
  const {
    subtotal = 0,
    total = 0,

    // auto promos only
    promoBreakdown = [],
    bogoBreakdown = [],

    // coupon line (all types)
    couponDiscount = 0,
    coupon = null,
    couponMeta = null,
  } = totals || {};

  // Count pill - update ALL count elements in the DOM
  const totalCount = (items || []).reduce(
    (sum, it) => sum + Math.max(1, Number(it.qty || 1)),
    0
  );
  // Update all cart count badges (navbar, drawer, etc.)
  document.querySelectorAll("[data-kk-cart-count]").forEach((el) => {
    el.textContent = String(totalCount);
  });

  // Totals text
  if (els.subtotalEl) els.subtotalEl.textContent = money(subtotal);
  if (els.totalEl) els.totalEl.textContent = money(total);

  // Free shipping progress bar - use total (after discounts) for accurate threshold check
  if (els.freeShippingEl) {
    renderFreeShippingBar(total, els.freeShippingEl);
  }

  // Safety
  if (!els.cartItemsEl) return;

  // Empty state
  if (!items.length) {
    els.cartItemsEl.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <div class="w-16 h-16 rounded-full bg-black/5 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-black/30" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
          </svg>
        </div>
        <p class="font-bold text-sm text-black/70">Your cart is empty</p>
        <p class="text-xs text-black/40 mt-1">Add something to get started</p>
      </div>
    `;

    // Hide promo/coupon rows
    if (els.promotionsEl) {
      els.promotionsEl.style.display = "none";
      els.promotionsEl.innerHTML = "";
    }
    if (els.couponDiscountEl) {
      els.couponDiscountEl.style.display = "none";
    }
    if (els.couponMsg) {
      els.couponMsg.classList.add("hidden");
      els.couponMsg.textContent = "";
    }
    return;
  }

  // Items markup - Clean minimalistic design
  els.cartItemsEl.innerHTML = items
    .map((it) => {
      const id = String(it.id || "");
      const variant = normVariant(it.variant);
      const qty = Math.max(1, Number(it.qty || 1));
      const img = it.image || "/imgs/placeholder.png";
      const name = esc(it.name || "Item");
      const unit = money(it.price);
      const lineTotal = money(it.price * qty);

      return `
<article class="bg-white rounded-lg p-3 mb-2 shadow-sm">
  <div class="flex gap-3">
    <!-- Image -->
    <div class="w-20 h-20 rounded-md overflow-hidden bg-black/5 flex-shrink-0">
      <img
        class="w-full h-full object-cover"
        src="${esc(img)}"
        alt="${name}"
        loading="lazy"
      />
    </div>

    <!-- Content -->
    <div class="flex-1 min-w-0 flex flex-col justify-between">
      <div>
        <h4 class="font-bold text-sm leading-tight line-clamp-2">${name}</h4>
        ${variant ? `<p class="text-xs text-black/50 mt-0.5">${esc(variant)}</p>` : ""}
      </div>
      
      <div class="flex items-center justify-between mt-2">
        <!-- Qty controls -->
        <div class="inline-flex items-center bg-black/5 rounded-full">
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center text-black/60 hover:text-black transition-colors"
            data-kk-qty-minus
            data-id="${esc(id)}"
            data-variant="${esc(variant)}"
            data-qty="${qty}"
            aria-label="Decrease quantity"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4"/>
            </svg>
          </button>
          <span class="w-8 text-center text-sm font-bold">${qty}</span>
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center text-black/60 hover:text-black transition-colors"
            data-kk-qty-plus
            data-id="${esc(id)}"
            data-variant="${esc(variant)}"
            data-qty="${qty}"
            aria-label="Increase quantity"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
          </button>
        </div>

        <!-- Price -->
        <div class="text-right">
          <span class="font-bold text-sm">${lineTotal}</span>
          ${qty > 1 ? `<span class="text-xs text-black/40 block">${unit} each</span>` : ""}
        </div>
      </div>
    </div>

    <!-- Remove button -->
    <button
      type="button"
      class="w-6 h-6 flex items-center justify-center text-black/30 hover:text-red-500 transition-colors self-start"
      data-kk-remove
      data-id="${esc(id)}"
      data-variant="${esc(variant)}"
      aria-label="Remove item"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  </div>
</article>
`;
    })
    .join("");

  // ✅ Promotions breakdown UI — AUTO ONLY (no coupon included here)
  if (els.promotionsEl) {
    const combined = [
      ...(promoBreakdown || []).map(({ promo, amount }) => ({ promo, amount })),
      ...(bogoBreakdown || []).map(({ promo, amount, meta }) => ({ promo, amount, meta })),
    ];

    if (combined.length) {
      els.promotionsEl.style.display = "block";
      els.promotionsEl.innerHTML = `
        <div class="space-y-1">
          ${combined
            .map(({ promo, amount, meta }) => {
              const isBogo = String(promo?.type || "").toLowerCase() === "bogo";
              const label =
                isBogo && meta?.freeCount
                  ? `${promo?.name || "BOGO"} (free x${meta.freeCount})`
                  : promo?.name || "Promotion";

              return `
                <div class="flex justify-between items-center text-xs">
                  <span class="text-black/60 truncate">${esc(label)}</span>
                  <span class="font-bold text-green-600">-${money(amount)}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    } else {
      els.promotionsEl.style.display = "none";
      els.promotionsEl.innerHTML = "";
    }
  }

  // ✅ Coupon row — ALL COUPON TYPES live here (percentage/fixed/bogo)
  if (els.couponDiscountEl) {
    const amt = Number(couponDiscount || 0);

    if (coupon && amt > 0) {
      els.couponDiscountEl.style.display = "flex";
      els.couponDiscountEl.className = "flex justify-between items-center text-xs";

      // Find or create label + amount elements
      let labelEl =
        els.couponDiscountEl.querySelector(".kk-promo-label") ||
        els.couponDiscountEl.querySelector(".kk-coupon-label");

      let amtEl = els.couponDiscountEl.querySelector(".kk-discount-amount");

      // Inject with minimalistic styling
      if (!labelEl || !amtEl) {
        els.couponDiscountEl.innerHTML = `
          <span class="kk-promo-label text-black/60 truncate"></span>
          <span class="kk-discount-amount font-bold text-green-600"></span>
        `;
        labelEl = els.couponDiscountEl.querySelector(".kk-promo-label");
        amtEl = els.couponDiscountEl.querySelector(".kk-discount-amount");
      }

      if (labelEl) labelEl.textContent = formatCouponLabel(coupon, couponMeta);
      if (amtEl) amtEl.textContent = `-${money(amt)}`;
    } else {
      els.couponDiscountEl.style.display = "none";
    }
  }

  // Coupon message element: keep it hidden unless couponUI shows it
  // (couponUI should manage its own visibility)
}

/**
 * Update cart recommendations asynchronously
 * Called after renderCartItems to show BOGO hints, pairs well, etc.
 */
export async function updateCartRecommendations(items = [], activePromos = [], els = {}) {
  const recommendationsEl = els.recommendationsEl || document.getElementById("kk-cart-recommendations");
  if (!recommendationsEl) return;

  try {
    const recommendations = await getCartRecommendations(items, activePromos);
    renderRecommendations(recommendations, recommendationsEl);
  } catch (err) {
    console.warn("Failed to load cart recommendations:", err);
    recommendationsEl.innerHTML = "";
    recommendationsEl.style.display = "none";
  }
}
