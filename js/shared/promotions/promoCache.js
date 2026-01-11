// /js/shared/promotions/promoCache.js

let cachedPromotions = [];
let lastFetchMs = 0;

export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getCache() {
  return { cachedPromotions, lastFetchMs };
}

export function setCache(promos, ms) {
  cachedPromotions = Array.isArray(promos) ? promos : [];
  lastFetchMs = Number(ms || 0);
}

export function clearPromotionCache() {
  cachedPromotions = [];
  lastFetchMs = 0;
}
