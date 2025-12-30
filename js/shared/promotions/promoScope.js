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
 */
export function getApplicablePromotions(promos = [], cartItems = []) {
  const out = [];
  for (const promo of promos || []) {
    const applies = (cartItems || []).some((it) => checkPromotionApplies(promo, it));
    if (applies || (promo.scope_type || "all") === "all") out.push(promo);
  }
  return out;
}
