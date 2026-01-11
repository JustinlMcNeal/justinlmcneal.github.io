// /js/shared/promotions/promoScope.js
import { normalizeUuidArray } from "./promoUtils.js";

function itemKeys(item = {}) {
  const keys = new Set();
  const push = (v) => {
    const s = String(v || "").trim();
    if (s) keys.add(s);
  };

  push(item.product_id);
  push(item.id);
  push(item.sku);
  push(item.slug);

  return Array.from(keys);
}

/**
 * Core scope check: does promo apply to an item?
 *
 * promo.scope_type: all | product | category | tag
 * promo.scope_data: uuid[] (or SKU[] etc)
 */
export function checkPromotionApplies(promo, item = {}) {
  if (!promo) return false;

  const scopeType = promo.scope_type || "all";
  const scopeData = normalizeUuidArray(promo.scope_data);

  const keys = itemKeys(item);

  const categoryIds = normalizeUuidArray(
    item.category_ids || (item.category_id ? [item.category_id] : [])
  );
  const tagIds = normalizeUuidArray(item.tag_ids || item.tags || []);

  switch (scopeType) {
    case "all":
      return true;

    // ✅ product scope: match ANY item identifier
    case "product":
      return scopeData.some((id) => keys.includes(String(id)));

    case "category":
      return scopeData.some((id) => categoryIds.includes(id));

    case "tag":
      return scopeData.some((id) => tagIds.includes(id));

    default:
      return false;
  }
}

/**
 * Returns promos that apply to ANY of the items
 * For BOGO promos, also checks if any cart item matches the REWARD criteria
 */
export function getApplicablePromotions(promos = [], cartItems = []) {
  const out = [];
  for (const promo of promos || []) {
    // Check if any item matches the trigger scope
    const matchesTrigger = (cartItems || []).some((it) => checkPromotionApplies(promo, it));
    
    // For BOGO promos, also check if any item matches the reward
    let matchesReward = false;
    if (promo.type === "bogo" && promo.bogo_reward_type && promo.bogo_reward_id) {
      matchesReward = (cartItems || []).some((it) => {
        const rewardType = promo.bogo_reward_type;
        const rewardId = String(promo.bogo_reward_id);
        
        if (rewardType === "product") {
          const keys = [it.id, it.product_id, it.slug, it.sku].filter(Boolean).map(String);
          return keys.includes(rewardId);
        }
        if (rewardType === "category") {
          const cats = normalizeUuidArray(it.category_ids || (it.category_id ? [it.category_id] : []));
          return cats.includes(rewardId);
        }
        if (rewardType === "tag") {
          const tags = normalizeUuidArray(it.tag_ids || it.tags || []);
          return tags.includes(rewardId);
        }
        return false;
      });
    }
    
    const isGlobal = (promo.scope_type || "all") === "all";
    
    if (matchesTrigger || matchesReward || isGlobal) {
      out.push(promo);
    }
  }
  return out;
}
