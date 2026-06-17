/**
 * eBay active listing quantity sync push API (Phase 7F).
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

async function getAccessToken() {
  const session = await requireAuthenticatedSession();
  return session.access_token;
}

/**
 * @param {{ preview?: boolean, variantIds?: string[], productIds?: string[], limit?: number, syncContext?: Record<string, string>|null }} payload
 */
export async function pushEbayInventoryQuantity(payload = {}) {
  const token = await getAccessToken();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-ebay-inventory-quantity`, {
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
    const err = new Error(data.error || data.message || "eBay sync failed");
    err.code = data.error || "sync_failed";
    err.hint = data.hint;
    err.status = resp.status;
    if (data.error === "live_patch_disabled") {
      err.message =
        "Live eBay quantity push is disabled (EBAY_ENABLE_LIVE_QUANTITY_PATCH is not true).";
    }
    throw err;
  }

  return data;
}
