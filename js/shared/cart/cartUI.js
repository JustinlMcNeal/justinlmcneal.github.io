/**
 * /js/shared/cart/cartUI.js
 * Cart drawer UI (HTML + styling hooks only)
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

  // Empty / safety
  if (!els.cartItemsEl) return;

  // Empty state
  if (!items.length) {
    els.cartItemsEl.innerHTML = `
      <div class="kk-cart-empty">
        <div class="kk-cart-empty-title">Your cart is empty</div>
        <div class="kk-cart-empty-sub">Add something cute to get started.</div>
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
      els.couponMsg.style.display = "none";
      els.couponMsg.textContent = "";
    }
    return;
  }

  // Items markup (KK-styled)
  els.cartItemsEl.innerHTML = items
    .map((it) => {
      const id = String(it.id || "");
      const variant = normVariant(it.variant);
      const qty = Math.max(1, Number(it.qty || 1));
      const img = it.image || "/imgs/placeholder.png";
      const name = esc(it.name || "Item");
      const unit = money(it.price);

      return `
  <article class="kk-cart-item">
    <div class="kk-cart-item-top">
      <img
        class="kk-cart-img"
        src="${esc(img)}"
        alt="${name}"
        loading="lazy"
      />

      <div style="min-width:0; flex:1;">
        <div class="kk-cart-name">${name}</div>

        <div class="kk-cart-sub">
          <span style="font-weight:900;">${unit}</span>
          ${variant ? `<span style="opacity:.75;"> · ${esc(variant)}</span>` : ""}
        </div>

        <div class="kk-cart-actions">
          <div class="kk-qty">
            <button
              type="button"
              class="kk-qty-btn"
              data-kk-qty-minus
              data-id="${esc(id)}"
              data-variant="${esc(variant)}"
              data-qty="${qty}"
              aria-label="Decrease quantity"
            >−</button>

            <span class="kk-qty-num">${qty}</span>

            <button
              type="button"
              class="kk-qty-btn"
              data-kk-qty-plus
              data-id="${esc(id)}"
              data-variant="${esc(variant)}"
              data-qty="${qty}"
              aria-label="Increase quantity"
            >+</button>
          </div>

          <button
            type="button"
            class="kk-cart-remove"
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
      ...(bogoBreakdown || []).map(({ promo, amount, meta }) => ({
        promo,
        amount,
        meta,
      })),
    ];

    if (combined.length) {
      els.promotionsEl.style.display = "block";
      els.promotionsEl.innerHTML = `
        <div class="kk-cart-promos">
          ${combined
            .map(({ promo, amount, meta }) => {
              const isBogo = String(promo?.type || "").toLowerCase() === "bogo";
              const label =
                isBogo && meta?.freeCount
                  ? `${promo?.name || "BOGO"} (free x${meta.freeCount})`
                  : promo?.name || "Promotion";

              return `
                <div class="kk-promo-line">
                  <span class="kk-promo-label">${esc(label)}</span>
                  <span class="kk-discount-amount">-${money(amount)}</span>
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

      // label element (try both common class names)
      const labelEl =
        els.couponDiscountEl.querySelector(".kk-promo-label") ||
        els.couponDiscountEl.querySelector(".kk-coupon-label");

      const amtEl = els.couponDiscountEl.querySelector(".kk-discount-amount");

      if (labelEl) labelEl.textContent = formatCouponLabel(coupon, couponMeta);
      if (amtEl) amtEl.textContent = `-${money(amt)}`;
    } else {
      els.couponDiscountEl.style.display = "none";
    }
  }
}
