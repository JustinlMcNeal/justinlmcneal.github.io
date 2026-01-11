// /js/shared/promotions/promoFetch.js
import { getSupabaseClient } from "../supabaseClient.js";
import { getCache, setCache, CACHE_TTL_MS } from "./promoCache.js";
import { isWithinDateWindow } from "./promoUtils.js";

const supabase = getSupabaseClient();

/**
 * Fetch all active + public promotions (cached)
 * NOTE: This returns BOTH auto-promos and code-promos.
 * Filtering happens in getProductPromotions/getCartPromotions.
 */
export async function fetchActivePromotions() {
  const { cachedPromotions, lastFetchMs } = getCache();
  const nowMs = Date.now();

  if (cachedPromotions.length && nowMs - lastFetchMs < CACHE_TTL_MS) {
    return cachedPromotions;
  }

  try {
    const { data, error } = await supabase
      .from("promotions")
      .select("*")
      .eq("is_active", true)
      .eq("is_public", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const filtered = (data || []).filter(isWithinDateWindow);
    setCache(filtered, nowMs);
    return filtered;
  } catch (e) {
    console.error("[Promotions] fetchActivePromotions error:", e);
    setCache([], nowMs);
    return [];
  }
}
