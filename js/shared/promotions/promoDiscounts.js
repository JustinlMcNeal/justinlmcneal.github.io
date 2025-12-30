// /js/shared/promotions/promoDiscounts.js
import { checkPromotionApplies } from "./promoScope.js";

function normalizeUuidArray(arr) {
  return (arr || []).map((x) => String(x));
}

function itemKeys(it = {}) {
  const keys = new Set();
  const push = (v) => {
    const s = String(v || "").trim();
    if (s) keys.add(s);
  };

  push(it.product_id);
  push(it.id);
  push(it.sku);
  push(it.slug);

  return Array.from(keys);
}


/**
 * Sum discount for subtotal (percentage/fixed only)
 * (BOGO handled separately)
 */
export function calculatePromotionDiscount(applicablePromos = [], subtotal = 0) {
  const sub = Number(subtotal || 0);
  let totalDiscount = 0;
  const breakdown = [];

  for (const promo of applicablePromos || []) {
    if (promo.type === "bogo" || promo.type === "free_shipping") continue;

    let amount = 0;

    if (promo.type === "percentage") {
      amount = (sub * Number(promo.value || 0)) / 100;
    } else if (promo.type === "fixed") {
      amount = Number(promo.value || 0);
    } else {
      amount = 0;
    }

    amount = Math.max(0, Math.min(amount, sub));
    if (amount > 0) {
      totalDiscount += amount;
      breakdown.push({ promo, amount });
    }
  }

  return { totalDiscount, breakdown };
}

/**
 * BOGO discount calculation (per promo)
 *
 * Uses:
 * - promo.scope_type / scope_data => what counts as "buy"
 * - promo.bogo_reward_type + promo.bogo_reward_id => what can be free
 * - promo.max_uses_per_order (optional) => clamps freebies
 *
 * Default behavior if max_uses_per_order is missing:
 * - 1 free per order
 */
export function calculateBogoDiscount(applicablePromos = [], cartItems = []) {
  let totalDiscount = 0;
  const breakdown = [];
  const items = cartItems || [];

  for (const promo of applicablePromos || []) {
    if (promo.type !== "bogo") continue;

    // 1) Count BUY quantity (items that qualify under promo scope)
    const buyQty = items.reduce((sum, it) => {
      const qty = Math.max(0, Number(it.qty || 0));
      return sum + (checkPromotionApplies(promo, it) ? qty : 0);
    }, 0);

    if (buyQty < 2) continue;

    // 2) Determine REWARD-eligible items in cart
    const rewardType = promo.bogo_reward_type; // "product" | "category" | "tag"
    const rewardId = promo.bogo_reward_id ? String(promo.bogo_reward_id) : null;
    if (!rewardType || !rewardId) continue;

    const rewardEligible = items.filter((it) => {
  const keys = itemKeys(it);

  if (rewardType === "product") {
    // ✅ match rewardId against any identifier on the cart item
    return keys.includes(rewardId);
  }

  if (rewardType === "category") {
    const cats = normalizeUuidArray(
      it.category_ids || (it.category_id ? [it.category_id] : [])
    );
    return cats.includes(rewardId);
  }

  if (rewardType === "tag") {
    const tags = normalizeUuidArray(it.tag_ids || it.tags || []);
    return tags.includes(rewardId);
  }

  return false;
});


    const rewardQty = rewardEligible.reduce(
      (sum, it) => sum + Math.max(0, Number(it.qty || 0)),
      0
    );
    if (rewardQty <= 0) continue;

    // 3) Free count logic: floor(buyQty/2), capped by rewardQty
    let freeCount = Math.floor(buyQty / 2);
    freeCount = Math.min(freeCount, rewardQty);

    // ✅ Clamp per order
    const rawMax = Number(promo.max_uses_per_order);
    const maxUses =
      Number.isFinite(rawMax) && rawMax > 0
        ? rawMax
        : 1; // default 1 free per order

    freeCount = Math.min(freeCount, maxUses);
    if (freeCount <= 0) continue;

    // 4) Cheapest reward item price determines discount per free item
    let cheapest = Infinity;
    for (const it of rewardEligible) {
      const p = Number(it.price || 0);
      if (p > 0 && p < cheapest) cheapest = p;
    }
    if (!Number.isFinite(cheapest)) continue;

    const amount = Math.max(0, cheapest * freeCount);

    if (amount > 0) {
      totalDiscount += amount;
      breakdown.push({
        promo,
        amount,
        meta: { freeCount, cheapest },
      });
    }
  }

  return { totalDiscount, breakdown };
}

/**
 * Best discount for displaying a single product price
 * (percentage/fixed only)
 */
export function getBestProductDiscount(applicablePromos = [], basePrice = 0) {
  const price = Number(basePrice || 0);
  let best = { amount: 0, promo: null };

  for (const promo of applicablePromos || []) {
    if (promo.type === "bogo" || promo.type === "free_shipping") continue;

    let amount = 0;

    if (promo.type === "percentage") {
      amount = (price * Number(promo.value || 0)) / 100;
    } else if (promo.type === "fixed") {
      amount = Number(promo.value || 0);
    } else {
      amount = 0;
    }

    amount = Math.max(0, Math.min(amount, price));
    if (amount > best.amount) best = { amount, promo };
  }

  return best;
}
