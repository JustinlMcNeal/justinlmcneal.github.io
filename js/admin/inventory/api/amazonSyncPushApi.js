/**
 * Amazon FBM inventory sync push API (Phase 7C).
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

async function getAccessToken() {
  const session = await requireAuthenticatedSession();
  return session.access_token;
}

/**
 * @param {{ preview?: boolean, variantIds?: string[], amazonListingIds?: string[], limit?: number }} payload
 */
export async function pushAmazonFbmInventory(payload = {}) {
  const token = await getAccessToken();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-amazon-inventory-quantity`, {
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
    const err = new Error(data.error || data.message || "Amazon sync failed");
    err.code = data.error || "sync_failed";
    err.hint = data.hint;
    err.status = resp.status;
    throw err;
  }

  return data;
}
