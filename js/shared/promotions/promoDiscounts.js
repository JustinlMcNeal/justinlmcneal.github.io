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
 * 
 * For "fixed" type promos:
 * - Discount is applied PER qualifying item
 * - usage_limit = max items that can receive the discount per order
 * 
 * For "percentage" type promos:
 * - Discount is calculated on the subtotal of qualifying items
 */
export function calculatePromotionDiscount(applicablePromos = [], subtotalOrItems = 0, cartItems = null) {
  let totalDiscount = 0;
  const breakdown = [];

  // Handle both old signature (subtotal) and new signature (items array)
  const isSubtotalMode = typeof subtotalOrItems === 'number' && !cartItems;
  
  for (const promo of applicablePromos || []) {
    if (promo.type === "bogo" || promo.type === "free_shipping") continue;

    let amount = 0;

    if (promo.type === "percentage") {
      // Percentage discount on subtotal
      const sub = isSubtotalMode ? subtotalOrItems : Number(subtotalOrItems || 0);
      amount = (sub * Number(promo.value || 0)) / 100;
      amount = Math.max(0, Math.min(amount, sub));
      
    } else if (promo.type === "fixed") {
      // Fixed discount PER ITEM
      const fixedAmount = Number(promo.value || 0);
      
      if (isSubtotalMode) {
        // Old mode: single item/product view - just apply once
        amount = fixedAmount;
      } else if (cartItems && Array.isArray(cartItems)) {
        // Cart mode: apply to each qualifying item, respecting usage_limit
        const usageLimit = Number(promo.usage_limit);
        const hasLimit = Number.isFinite(usageLimit) && usageLimit > 0;
        
        let itemsDiscounted = 0;
        
        for (const item of cartItems) {
          // Check if this item qualifies for this promo
          if (!checkPromotionApplies(promo, item)) continue;
          
          const qty = Math.max(1, Number(item.qty || 1));
          const itemPrice = Number(item.price || 0);
          
          for (let i = 0; i < qty; i++) {
            // Check usage limit
            if (hasLimit && itemsDiscounted >= usageLimit) break;
            
            // Discount per item (can't exceed item price)
            const itemDiscount = Math.min(fixedAmount, itemPrice);
            amount += itemDiscount;
            itemsDiscounted++;
          }
          
          // If we've hit the limit, stop processing more items
          if (hasLimit && itemsDiscounted >= usageLimit) break;
        }
      } else {
        // Fallback
        amount = fixedAmount;
      }
    }

    // Round to avoid floating point issues
    amount = Math.round(amount * 100) / 100;
    
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
 * - promo.scope_type / scope_data => what counts as "buy" (trigger items)
 * - promo.bogo_reward_type + promo.bogo_reward_id => what can be free (reward items)
 * - promo.max_uses_per_order (optional) => clamps freebies
 *
 * Logic:
 * - For each trigger item, you can get 1 reward item free
 * - If trigger and reward are DIFFERENT categories: 1 trigger = 1 free reward
 * - If trigger and reward are the SAME: need 2 to get 1 free (buy 2 get 1 free style)
 */
export function calculateBogoDiscount(applicablePromos = [], cartItems = []) {
  let totalDiscount = 0;
  const breakdown = [];
  const items = cartItems || [];

  for (const promo of applicablePromos || []) {
    if (promo.type !== "bogo") continue;

    const rewardType = promo.bogo_reward_type; // "product" | "category" | "tag"
    const rewardId = promo.bogo_reward_id ? String(promo.bogo_reward_id) : null;
    if (!rewardType || !rewardId) continue;

    // 1) Find trigger items (items that qualify under promo scope)
    const triggerItems = items.filter((it) => checkPromotionApplies(promo, it));
    const triggerQty = triggerItems.reduce((sum, it) => sum + Math.max(0, Number(it.qty || 0)), 0);

    if (triggerQty <= 0) continue;

    // 2) Find reward-eligible items in cart
    const rewardEligible = items.filter((it) => {
      const keys = itemKeys(it);

      if (rewardType === "product") {
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

    // 3) Check if trigger and reward overlap (same items qualify for both)
    const triggerIsReward = triggerItems.some((triggerItem) => {
      return rewardEligible.some((rewardItem) => {
        const triggerKeys = itemKeys(triggerItem);
        const rewardKeys = itemKeys(rewardItem);
        return [...triggerKeys].some((k) => rewardKeys.has ? rewardKeys.has(k) : rewardKeys.includes(k));
      });
    });

    // 4) Calculate free count based on whether trigger/reward overlap
    let freeCount;
    if (triggerIsReward) {
      // Same category BOGO: need 2 to get 1 free (e.g., buy 2 hats get 1 hat free)
      freeCount = Math.floor(triggerQty / 2);
    } else {
      // Different category BOGO: each trigger gets 1 reward free (e.g., buy 1 hat get 1 charm free)
      freeCount = Math.min(triggerQty, rewardQty);
    }

    // 5) Clamp by max_uses_per_order
    const rawMax = Number(promo.max_uses_per_order);
    const maxUses = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 1;
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
