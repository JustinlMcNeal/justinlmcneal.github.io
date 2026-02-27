// /js/shared/reviewStats.js
// Fetches cached aggregate review stats from product_review_stats table.
// The DB table is maintained by a trigger on the reviews table so stats
// are always up-to-date without computing on-the-fly.

import { getSupabaseClient } from "./supabaseClient.js";

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch review stats for all products in one query.
 * Returns Map<product_id, { avg_rating: number, review_count: number }>
 */
export async function fetchAllReviewStats() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("product_review_stats")
    .select("product_id, avg_rating, review_count");

  if (error) {
    console.warn("[reviewStats] Failed to fetch stats:", error.message);
    return new Map();
  }

  const result = new Map();
  for (const row of data || []) {
    result.set(row.product_id, {
      avg_rating: Number(row.avg_rating),
      review_count: Number(row.review_count),
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
