/** eBay inventory quantity sync — candidate loading + patch helpers (Phase 7F). */

import { EBAY_API } from "./ebayUtils.ts";
import {
  ebayInventoryFetch,
  isActiveOffer,
  sleep,
  EBAY_CACHE_DELAY_MS,
} from "./inventoryEbayCacheUtils.ts";
import {
  createInventorySyncRun,
  finalizeInventorySyncRun,
  logInventorySyncResult,
  parseInventorySyncRunContext,
  targetQtyFromAvailable,
} from "./inventoryAmazonSyncUtils.ts";

const INV_API = `${EBAY_API}/sell/inventory/v1`;
export const INVENTORY_EBAY_SYNC_DEFAULT_LIMIT = 25;
export const INVENTORY_EBAY_SYNC_MAX = 50;
export const EBAY_MARKETPLACE_ID = "EBAY_US";

const ENDED_STATUSES = new Set(["ended", "out_of_stock", "withdrawn", "inactive"]);

export type EbaySyncCandidate = {
  variant_id: string;
  product_id: string;
  ebay_sku: string | null;
  ebay_offer_id: string | null;
  ebay_listing_id: string | null;
  ebay_current_qty: number | null;
  ebay_listing_status: string | null;
  available_qty: number;
  available_qty_nonneg: number;
  internal_sku: string | null;
  product_label: string | null;
  ebay_sync_action: string;
  ebay_item_group_key: string | null;
  product_active_variant_count: number | null;
};

export type EbayQuantityPatchItem = {
  variantId: string;
  productId: string;
  ebaySku: string;
  offerId: string | null;
  listingId: string | null;
  targetQty: number;
  previousQty: number | null;
};

export type EbayPatchResult = {
  variantId: string;
  productId: string;
  ebaySku: string;
  offerId: string | null;
  listingId: string | null;
  status: "success" | "failed" | "skipped";
  previousQty: number | null;
  targetQty: number;
  error?: string;
  errorCode?: string;
  responseRef?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveEbaySku(row: EbaySyncCandidate): string | null {
  const sku = String(row.ebay_sku || row.internal_sku || "").trim();
  return sku || null;
}

function isEligibleCandidate(row: EbaySyncCandidate): boolean {
  if (row.ebay_sync_action !== "update_qty") return false;
  if (row.ebay_current_qty == null) return false;
  if (!resolveEbaySku(row)) return false;
  if (!String(row.ebay_offer_id || "").trim()) return false;
  if (!String(row.ebay_listing_id || "").trim()) return false;

  const status = String(row.ebay_listing_status || "").toLowerCase();
  if (ENDED_STATUSES.has(status)) return false;

  if (row.ebay_item_group_key && Number(row.product_active_variant_count || 0) > 1) {
    return false;
  }

  return true;
}

async function enrichCandidatesWithCacheOfferIds(
  // deno-lint-ignore no-explicit-any
  client: any,
  candidates: EbaySyncCandidate[],
): Promise<EbaySyncCandidate[]> {
  const needsOffer = candidates.filter((row) => !String(row.ebay_offer_id || "").trim());
  if (!needsOffer.length) return candidates;

  const productIds = [...new Set(needsOffer.map((row) => row.product_id))];
  const { data: cacheRows, error } = await client
    .from("ebay_listing_inventory_cache")
    .select("product_id, ebay_sku, ebay_item_id, raw_payload_json")
    .in("product_id", productIds);
  if (error) {
    console.warn("[inventoryEbaySync] cache offer lookup failed:", error.message);
    return candidates;
  }

  const offerByKey = new Map<string, string>();
  const listingByKey = new Map<string, string>();
  for (const row of cacheRows || []) {
    const productId = String(row.product_id || "").trim();
    const sku = String(row.ebay_sku || "").trim();
    if (!productId || !sku) continue;
    const key = `${productId}:${sku}`;
    const payload = isRecord(row.raw_payload_json) ? row.raw_payload_json : {};
    const offerId = typeof payload.offerId === "string" ? payload.offerId.trim() : "";
    if (offerId) offerByKey.set(key, offerId);
    const listingId = String(row.ebay_item_id || "").trim();
    if (listingId) listingByKey.set(key, listingId);
  }

  return candidates.map((row) => {
    if (String(row.ebay_offer_id || "").trim()) return row;
    const sku = resolveEbaySku(row);
    if (!sku) return row;
    const key = `${row.product_id}:${sku}`;
    const offerId = offerByKey.get(key) || null;
    const listingId = String(row.ebay_listing_id || "").trim() || listingByKey.get(key) || null;
    if (!offerId && !listingId) return row;
    return {
      ...row,
      ebay_offer_id: offerId,
      ebay_listing_id: listingId,
    };
  });
}

export async function loadEbaySyncCandidates(
  // deno-lint-ignore no-explicit-any
  client: any,
  filters: {
    variantIds?: string[];
    productIds?: string[];
    limit?: number;
  },
): Promise<EbaySyncCandidate[]> {
  let query = client
    .from("v_inventory_channel_sync_candidates")
    .select([
      "variant_id",
      "product_id",
      "ebay_sku",
      "ebay_offer_id",
      "ebay_listing_id",
      "ebay_current_qty",
      "ebay_listing_status",
      "available_qty",
      "available_qty_nonneg",
      "internal_sku",
      "product_label",
      "ebay_sync_action",
      "ebay_item_group_key",
      "product_active_variant_count",
    ].join(","))
    .eq("ebay_sync_action", "update_qty");

  if (filters.variantIds?.length) query = query.in("variant_id", filters.variantIds);
  if (filters.productIds?.length) query = query.in("product_id", filters.productIds);

  const cap = Math.min(
    Math.max(1, filters.limit ?? INVENTORY_EBAY_SYNC_DEFAULT_LIMIT),
    INVENTORY_EBAY_SYNC_MAX,
  );

  const { data, error } = await query.limit(cap * 2);
  if (error) throw new Error("database_error");

  const enriched = await enrichCandidatesWithCacheOfferIds(client, (data || []) as EbaySyncCandidate[]);
  return enriched
    .filter(isEligibleCandidate)
    .slice(0, cap);
}

export function candidatesToEbayPatchItems(candidates: EbaySyncCandidate[]): EbayQuantityPatchItem[] {
  return candidates.map((c) => {
    const sku = resolveEbaySku(c)!;
    return {
      variantId: c.variant_id,
      productId: c.product_id,
      ebaySku: sku,
      offerId: String(c.ebay_offer_id || "").trim() || null,
      listingId: String(c.ebay_listing_id || "").trim() || null,
      targetQty: targetQtyFromAvailable(c.available_qty, c.available_qty_nonneg),
      previousQty: c.ebay_current_qty,
    };
  });
}

async function ebayInventoryFetchWithBody(
  token: string,
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 204) return { ok: true, status: 204, data: null };
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { rawResponse: text.slice(0, 500) };
  }
  return { ok: resp.ok, status: resp.status, data };
}

function responsesHaveSalePriceLock(responses: unknown[]): boolean {
  for (const raw of responses) {
    if (!isRecord(raw)) continue;
    const errors = Array.isArray(raw.errors) ? raw.errors : [];
    for (const err of errors) {
      if (!isRecord(err)) continue;
      if (Number(err.errorId) === 25019) return true;
      const msg = String(err.message || "");
      if (/part of a sale|cannot revise listing|price updates/i.test(msg)) return true;
    }
  }
  return false;
}

function bestBulkResponseStatus(responses: unknown[]): {
  anyOk: boolean;
  worstStatus: number | null;
  firstErrorMsg: string | null;
} {
  let anyOk = false;
  let worstStatus: number | null = null;
  let firstErrorMsg: string | null = null;
  for (const raw of responses) {
    if (!isRecord(raw)) continue;
    const statusCode = Number(raw.statusCode ?? raw.status ?? NaN);
    if (!Number.isFinite(statusCode)) continue;
    if (statusCode < 400) {
      anyOk = true;
      continue;
    }
    if (worstStatus == null || statusCode > worstStatus) worstStatus = statusCode;
    if (!firstErrorMsg) {
      const errors = Array.isArray(raw.errors) ? raw.errors : [];
      const firstErr = isRecord(errors[0]) ? errors[0] : null;
      firstErrorMsg = firstErr
        ? JSON.stringify(firstErr).slice(0, 300)
        : JSON.stringify(raw).slice(0, 300);
    }
  }
  return { anyOk, worstStatus, firstErrorMsg };
}

async function validateOfferActive(
  accessToken: string,
  item: EbayQuantityPatchItem,
): Promise<{ ok: boolean; error?: string; errorCode?: string }> {
  if (!item.offerId) {
    return { ok: false, error: "missing_offer_id", errorCode: "missing_offer_id" };
  }

  let offerRes = await ebayInventoryFetch(
    accessToken,
    "GET",
    `${INV_API}/offer/${encodeURIComponent(item.offerId)}`,
  );

  // eBay occasionally returns 5xx on offer GET — one short retry before failing the push.
  if (!offerRes.ok && offerRes.status >= 500) {
    await sleep(EBAY_CACHE_DELAY_MS);
    offerRes = await ebayInventoryFetch(
      accessToken,
      "GET",
      `${INV_API}/offer/${encodeURIComponent(item.offerId)}`,
    );
  }

  if (!offerRes.ok) {
    return {
      ok: false,
      error: `offer_lookup_failed_${offerRes.status}`,
      errorCode: "offer_lookup_failed",
    };
  }

  if (!isRecord(offerRes.data)) {
    return { ok: false, error: "invalid_offer_payload", errorCode: "invalid_offer" };
  }

  if (!isActiveOffer(offerRes.data)) {
    return { ok: false, error: "offer_not_active", errorCode: "ended_listing" };
  }

  const liveSku = typeof offerRes.data.sku === "string" ? offerRes.data.sku.trim() : "";
  if (liveSku && liveSku !== item.ebaySku) {
    return { ok: false, error: "sku_mismatch", errorCode: "stale_mapping" };
  }

  return { ok: true };
}

async function postBulkQtyUpdate(
  accessToken: string,
  request: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: unknown; responses: unknown[] }> {
  const result = await ebayInventoryFetchWithBody(
    accessToken,
    "POST",
    `${INV_API}/bulk_update_price_quantity`,
    { requests: [request] },
  );
  const payload = isRecord(result.data) ? result.data : {};
  const responses = Array.isArray(payload.responses) ? payload.responses : [];
  return { ok: result.ok, status: result.status, data: result.data, responses };
}

async function patchEbayQuantityLive(
  accessToken: string,
  item: EbayQuantityPatchItem,
): Promise<{ ok: boolean; error?: string; errorCode?: string; responseRef?: string }> {
  const locationOnlyRequest: Record<string, unknown> = {
    sku: item.ebaySku,
    shipToLocationAvailability: { quantity: item.targetQty },
  };
  const withOfferRequest: Record<string, unknown> = {
    ...locationOnlyRequest,
  };
  if (item.offerId) {
    withOfferRequest.offers = [{ offerId: item.offerId, availableQuantity: item.targetQty }];
  }

  // Prefer offer+location when we have an offerId; fall back to location-only on sale price lock (25019).
  let result = await postBulkQtyUpdate(
    accessToken,
    item.offerId ? withOfferRequest : locationOnlyRequest,
  );

  if (
    item.offerId &&
    (responsesHaveSalePriceLock(result.responses) ||
      (!result.ok && /part of a sale|25019/i.test(JSON.stringify(result.data || {}))))
  ) {
    console.warn(
      `[inventoryEbaySync] sale price lock on ${item.ebaySku}; retrying quantity-only update`,
    );
    result = await postBulkQtyUpdate(accessToken, locationOnlyRequest);
  }

  const parsed = bestBulkResponseStatus(result.responses);
  if (parsed.anyOk || (result.ok && result.responses.length === 0)) {
    return {
      ok: true,
      responseRef: item.offerId || item.ebaySku,
    };
  }

  if (!result.ok && result.responses.length === 0) {
    const errText = JSON.stringify(result.data || {}).slice(0, 500);
    return {
      ok: false,
      error: `bulk_update_failed_${result.status}: ${errText}`,
      errorCode: String(result.status),
    };
  }

  return {
    ok: false,
    error: parsed.firstErrorMsg || `bulk_update_failed_${parsed.worstStatus ?? result.status}`,
    errorCode: String(parsed.worstStatus ?? result.status),
  };
}

export async function updateEbayCacheQtyAfterPush(
  // deno-lint-ignore no-explicit-any
  client: any,
  item: EbayQuantityPatchItem,
  now: string,
): Promise<void> {
  const { error } = await client
    .from("ebay_listing_inventory_cache")
    .update({
      current_qty: item.targetQty,
      available_qty: item.targetQty,
      last_synced_at: now,
      updated_at: now,
    })
    .eq("product_id", item.productId)
    .eq("ebay_sku", item.ebaySku);

  if (error) {
    console.warn("[inventoryEbaySync] cache update failed:", error.message);
  }
}

export async function processEbayQuantityPatches(params: {
  // deno-lint-ignore no-explicit-any
  client: any;
  accessToken: string;
  items: EbayQuantityPatchItem[];
  preview: boolean;
  now: string;
}): Promise<{ results: EbayPatchResult[]; summary: { succeeded: number; failed: number; skipped: number } }> {
  const results: EbayPatchResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i];
    const base: EbayPatchResult = {
      variantId: item.variantId,
      productId: item.productId,
      ebaySku: item.ebaySku,
      offerId: item.offerId,
      listingId: item.listingId,
      status: "failed",
      previousQty: item.previousQty,
      targetQty: item.targetQty,
    };

    if (item.targetQty === item.previousQty) {
      skipped += 1;
      results.push({ ...base, status: "skipped", error: "already_matched" });
      continue;
    }

    const validation = await validateOfferActive(params.accessToken, item);
    if (!validation.ok) {
      failed += 1;
      results.push({
        ...base,
        status: "failed",
        error: validation.error,
        errorCode: validation.errorCode,
      });
      if (i < params.items.length - 1) await sleep(EBAY_CACHE_DELAY_MS);
      continue;
    }

    if (params.preview) {
      succeeded += 1;
      results.push({ ...base, status: "success", responseRef: "preview" });
      if (i < params.items.length - 1) await sleep(EBAY_CACHE_DELAY_MS);
      continue;
    }

    const patch = await patchEbayQuantityLive(params.accessToken, item);
    if (!patch.ok) {
      failed += 1;
      results.push({
        ...base,
        status: "failed",
        error: patch.error,
        errorCode: patch.errorCode,
      });
    } else {
      await updateEbayCacheQtyAfterPush(params.client, item, params.now);
      succeeded += 1;
      results.push({
        ...base,
        status: "success",
        responseRef: patch.responseRef ?? null,
      });
    }

    if (i < params.items.length - 1) await sleep(EBAY_CACHE_DELAY_MS);
  }

  return { results, summary: { succeeded, failed, skipped } };
}

export {
  createInventorySyncRun,
  finalizeInventorySyncRun,
  logInventorySyncResult,
  parseInventorySyncRunContext,
};
