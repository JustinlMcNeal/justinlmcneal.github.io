// /js/product/promos.js
import { money } from "./render.js";
import { calculatePromotionDiscount } from "/js/shared/promotionLoader.js";

function promoType(p) {
  return String(p?.type || "").toLowerCase();
}

function formatAppliedLine(promo, amount) {
  const name = promo?.name || promo?.title || "Promotion";
  const dollars = Math.max(0, Number(amount || 0));

  return `
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-[10px] font-black uppercase tracking-[.18em] bg-black text-white px-2 py-1">Applied</span>
        <div class="min-w-0">
          <div class="font-black text-xs tracking-[.12em] uppercase truncate">${name}</div>
        </div>
      </div>
      <div class="font-black text-sm whitespace-nowrap">-${money(dollars)}</div>
    </div>
  `;
}

function formatEligibleLine(promo) {
  const type = promoType(promo);
  const name = promo?.name || promo?.title || "Promotion";
  const desc = promo?.description || "";

  let hint = "";
  if (type === "bogo") hint = "Buy-one-get-one deal (applies in cart)";
  else if (type === "free_shipping" || type === "free-shipping") hint = "Free shipping (applies at checkout/cart)";
  else hint = "This promo may apply depending on cart rules.";

  return `
    <div class="flex items-start gap-3">
      <span class="text-[10px] font-black uppercase tracking-[.18em] bg-white px-2 py-1">Eligible</span>
      <div class="min-w-0">
        <div class="font-black text-xs tracking-[.12em] uppercase">${name}</div>
        <div class="text-sm opacity-70 mt-1">${desc || hint}</div>
      </div>
    </div>
  `;
}

/**
 * Sets price HTML + returns { base, discounted, totalDiscount, breakdown }
 * Uses SAME engine as cart (percentage + fixed stack). :contentReference[oaicite:4]{index=4}
 */
export function applyProductPriceWithPromos(priceEl, basePrice, promos = []) {
  const base = Number(basePrice || 0);
  const { totalDiscount, breakdown } = calculatePromotionDiscount(promos, base);
  const discounted = Math.max(0, base - Number(totalDiscount || 0));

  if (priceEl) {
    priceEl.innerHTML =
      totalDiscount > 0
        ? `
          <span class="font-black  text-green-600 text-3xl">${money(discounted)}</span>
          <span class="ml-2 text-sm line-through opacity-60">${money(base)}</span>
        `
        : `<span class="text-base">${money(base)}</span>`;
  }

  return { base, discounted, totalDiscount, breakdown };
}

/**
 * Renders promos box:
 * - Applied = breakdown from engine (only actual price-impact promos)
 * - Eligible = bogo/free shipping (non-price promos)
 */
export function renderProductPromoPanel(els, promos = [], basePrice = 0) {
  if (!els?.promos) return;

  if (!Array.isArray(promos) || promos.length === 0) {
    els.promos.classList.add("hidden");
    return;
  }

  const { breakdown, totalDiscount } = applyProductPriceWithPromos(
    els.price,
    basePrice,
    promos
  );

  // Applied list (from breakdown)
  if (els.promoApplied) {
    els.promoApplied.innerHTML = (breakdown || []).length
      ? breakdown.map(({ promo, amount }) => formatAppliedLine(promo, amount)).join("")
      : `<div class="text-sm opacity-70">No automatic discounts applied.</div>`;
  }

  // Eligible list (non-price promos)
  const eligible = promos.filter((p) => {
    const t = promoType(p);
    return t === "bogo" || t === "free_shipping" || t === "free-shipping";
  });

  if (els.promoEligibleWrap && els.promoEligible) {
    if (eligible.length) {
      els.promoEligible.innerHTML = eligible.map(formatEligibleLine).join("");
      els.promoEligibleWrap.classList.remove("hidden");
    } else {
      els.promoEligibleWrap.classList.add("hidden");
    }
  }

  els.promos.classList.remove("hidden");

  return { totalDiscount, breakdown };
}
