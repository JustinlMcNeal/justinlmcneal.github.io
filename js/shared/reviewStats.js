// /js/shared/reviewStats.js
// Fetches and caches aggregate review stats (avg_rating, review_count) per product.

import { getSupabaseClient } from "./supabaseClient.js";

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch review stats for all products in one query.
 * Returns Map<product_id, { avg_rating: number, review_count: number }>
 */
export async function fetchAllReviewStats() {
  // Return cache if fresh
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  const sb = getSupabaseClient();

  // Only count approved reviews
  const { data, error } = await sb
    .from("reviews")
    .select("product_id, rating")
    .eq("status", "approved");

  if (error) {
    console.warn("[reviewStats] Failed to fetch reviews:", error.message);
    return new Map();
  }

  // Aggregate per product
  const map = new Map();
  for (const row of data || []) {
    const pid = row.product_id;
    if (!pid) continue;
    if (!map.has(pid)) map.set(pid, { total: 0, count: 0 });
    const entry = map.get(pid);
    entry.total += Number(row.rating || 0);
    entry.count += 1;
  }

  // Convert to avg_rating + review_count 
  const result = new Map();
  for (const [pid, { total, count }] of map) {
    result.set(pid, {
      avg_rating: Math.round((total / count) * 10) / 10, // 1 decimal
      review_count: count,
    });
  }

  _cache = result;
  _cacheTime = Date.now();
  return result;
}

/**
 * Fetch review stats for a single product by code.
 * Returns { avg_rating: number, review_count: number } or null
 */
export async function fetchProductReviewStats(productCode) {
  const all = await fetchAllReviewStats();
  return all.get(productCode) || null;
}
