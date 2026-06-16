/**
 * eBay listing inventory cache refresh API (Phase 7D).
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

async function getAccessToken() {
  const session = await requireAuthenticatedSession();
  return session.access_token;
}

/** @param {{ productIds?: string[], limit?: number }} [payload] */
export async function refreshEbayListingCache(payload = {}) {
  const token = await getAccessToken();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-ebay-listing-inventory-cache`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (!resp.ok || data.ok === false) {
    const err = new Error(data.error || "eBay cache refresh failed");
    err.code = data.error || "cache_refresh_failed";
    throw err;
  }

  return data;
}
