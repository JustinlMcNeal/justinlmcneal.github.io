/**
 * /js/shared/cart/cartUI.js
 * Cart drawer UI (Tailwind-only markup)
 *
 * Option A:
 * - Promotions list shows ONLY auto-promos (promoBreakdown + bogoBreakdown)
 * - Coupon row shows ALL coupon types (percentage/fixed/bogo)
 */

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

  // Count pill
  const totalCount = (items || []).reduce(
    (sum, it) => sum + Math.max(1, Number(it.qty || 1)),
    0
  );
  if (els.cartCountEl) els.cartCountEl.textContent = String(totalCount);

  // Totals text
  if (els.subtotalEl) els.subtotalEl.textContent = money(subtotal);
  if (els.totalEl) els.totalEl.textContent = money(total);

  // Safety
  if (!els.cartItemsEl) return;

  // Empty state
  if (!items.length) {
    els.cartItemsEl.innerHTML = `
      <div class="border-[4px] border-black bg-white p-5">
        <div class="text-[12px] font-black uppercase tracking-[.14em]">Your cart is empty</div>
        <div class="text-[13px] text-black/60 mt-2">Add something cute to get started.</div>
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

  // Items markup (Tailwind)
  els.cartItemsEl.innerHTML = items
    .map((it) => {
      const id = String(it.id || "");
      const variant = normVariant(it.variant);
      const qty = Math.max(1, Number(it.qty || 1));
      const img = it.image || "/imgs/placeholder.png";
      const name = esc(it.name || "Item");
      const unit = money(it.price);

      return `
<article class="border-2 border-black/15 bg-white p-3 mb-3">
  <div class="flex gap-3 items-start">
    <img
      class="w-16 h-16 border-[4px] border-black bg-black/5 object-cover flex-none"
      src="${esc(img)}"
      alt="${name}"
      loading="lazy"
    />

    <div class="min-w-0 flex-1">
      <div class="font-black uppercase tracking-[.06em] text-[12px] truncate">${name}</div>

      <div class="text-[13px] text-black/60 mt-1">
        <span class="font-black text-black">${unit}</span>
        ${variant ? `<span class="opacity-80"> · ${esc(variant)}</span>` : ""}
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <!-- Qty controls -->
        <div class="inline-flex items-center gap-2">
          <button
            type="button"
            class="w-11 h-11 border-[4px] border-black bg-white font-black text-[16px] leading-none
                   inline-flex items-center justify-center hover:bg-black hover:text-white"
            data-kk-qty-minus
            data-id="${esc(id)}"
            data-variant="${esc(variant)}"
            data-qty="${qty}"
            aria-label="Decrease quantity"
          >−</button>

          <span class="min-w-[28px] text-center font-black tracking-[.06em]">${qty}</span>

          <button
            type="button"
            class="w-11 h-11 border-[4px] border-black bg-white font-black text-[16px] leading-none
                   inline-flex items-center justify-center hover:bg-black hover:text-white"
            data-kk-qty-plus
            data-id="${esc(id)}"
            data-variant="${esc(variant)}"
            data-qty="${qty}"
            aria-label="Increase quantity"
          >+</button>
        </div>

        <!-- Remove -->
        <button
          type="button"
          class="border-[4px] border-black bg-white px-3 py-[10px] font-black uppercase tracking-[.12em] text-[11px]
                 hover:bg-black hover:text-white"
          data-kk-remove
          data-id="${esc(id)}"
          data-variant="${esc(variant)}"
        >Remove</button>
      </div>
    </div>
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
        <div class="border-t-2 border-black/15 pt-3 mt-3">
          ${combined
            .map(({ promo, amount, meta }) => {
              const isBogo = String(promo?.type || "").toLowerCase() === "bogo";
              const label =
                isBogo && meta?.freeCount
                  ? `${promo?.name || "BOGO"} (free x${meta.freeCount})`
                  : promo?.name || "Promotion";

              return `
                <div class="flex justify-between items-baseline gap-3 my-1 text-[13px]">
                  <span class="min-w-0 truncate opacity-90">${esc(label)}</span>
                  <span class="font-black text-green-600 whitespace-nowrap">-${money(amount)}</span>
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

      // Find or create label + amount elements
      let labelEl =
        els.couponDiscountEl.querySelector(".kk-promo-label") ||
        els.couponDiscountEl.querySelector(".kk-coupon-label");

      let amtEl = els.couponDiscountEl.querySelector(".kk-discount-amount");

      // If your HTML is the Tailwind navbar version I gave you, it won’t have those classes,
      // so we inject them once.
      if (!labelEl || !amtEl) {
        els.couponDiscountEl.innerHTML = `
          <span class="kk-promo-label min-w-0 truncate opacity-90"></span>
          <span class="kk-discount-amount font-black text-green-600 whitespace-nowrap"></span>
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
