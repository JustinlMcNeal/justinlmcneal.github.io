/**
 * eBay ended variation group relist API (Phase 060C.3).
 * Invokes relist-ebay-variation-group edge only.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function getAccessToken() {
  const session = await requireAuthenticatedSession();
  return session.access_token;
}

/** @param {string} value @param {string} label */
function requireUuid(value, label) {
  const id = String(value || "").trim();
  if (!UUID_RE.test(id)) throw new Error(`${label} must be a valid UUID.`);
  return id;
}

/** @param {string|null|undefined} value */
function optionalUuid(value) {
  const id = String(value || "").trim();
  if (!id) return null;
  if (!UUID_RE.test(id)) throw new Error("triggeringVariantId must be a valid UUID when provided.");
  return id;
}

/**
 * @param {{
 *   productId?: string,
 *   triggeringVariantId?: string|null,
 *   preview?: boolean,
 *   syncContext?: Record<string, string>|null,
 * }} [params]
 */
export async function relistEbayVariationGroup({
  productId,
  triggeringVariantId = null,
  preview = false,
  syncContext = null,
} = {}) {
  const pid = requireUuid(productId, "productId");
  const vid = optionalUuid(triggeringVariantId);

  const token = await getAccessToken();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/relist-ebay-variation-group`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productId: pid,
      triggeringVariantId: vid || undefined,
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
    const err = new Error(data.error || data.message || "eBay variation group relist failed");
    err.code = data.error || "variation_group_relist_failed";
    err.status = resp.status;
    throw err;
  }

  return data;
}
