/**
 * eBay ended single-SKU relist from product API (Phase 059D.3).
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function getAccessToken() {
  const session = await requireAuthenticatedSession();
  return session.access_token;
}

/**
 * @param {string} value
 */
function requireUuid(value, label) {
  const id = String(value || "").trim();
  if (!UUID_RE.test(id)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
  return id;
}

/**
 * @param {number} value
 */
function requirePositiveQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("quantity must be a positive number.");
  }
  return Math.floor(n);
}

/**
 * @param {{
 *   productId?: string,
 *   variantId?: string,
 *   quantity?: number,
 *   preview?: boolean,
 *   syncContext?: Record<string, string>|null,
 * }} [params]
 * @returns {Promise<{
 *   ok?: boolean,
 *   status?: string,
 *   mode?: string,
 *   message?: string,
 *   listingId?: string,
 *   offerId?: string,
 *   sellerSku?: string,
 *   runId?: string|null,
 *   errors?: string[],
 *   warnings?: string[],
 *   syncContext?: Record<string, string>|null,
 * }>}
 */
export async function relistEbayFromProduct({
  productId,
  variantId,
  quantity,
  preview = false,
  syncContext = null,
} = {}) {
  const pid = requireUuid(productId, "productId");
  const vid = requireUuid(variantId, "variantId");
  const qty = requirePositiveQty(quantity);

  const token = await getAccessToken();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/relist-ebay-from-product`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productId: pid,
      variantId: vid,
      quantity: qty,
      preview: preview === true,
      syncContext: syncContext || undefined,
    }),
  });

  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }

  if (!resp.ok && !data.status) {
    const err = new Error(data.error || data.message || "eBay relist request failed");
    err.code = data.error || "relist_failed";
    err.status = resp.status;
    throw err;
  }

  return data;
}
