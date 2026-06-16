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

  return ((data || []) as EbaySyncCandidate[])
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

async function validateOfferActive(
  accessToken: string,
  item: EbayQuantityPatchItem,
): Promise<{ ok: boolean; error?: string; errorCode?: string }> {
  if (!item.offerId) {
    return { ok: false, error: "missing_offer_id", errorCode: "missing_offer_id" };
  }

  const offerRes = await ebayInventoryFetch(
    accessToken,
    "GET",
    `${INV_API}/offer/${encodeURIComponent(item.offerId)}`,
  );

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

async function patchEbayQuantityLive(
  accessToken: string,
  item: EbayQuantityPatchItem,
): Promise<{ ok: boolean; error?: string; errorCode?: string; responseRef?: string }> {
  const request: Record<string, unknown> = {
    sku: item.ebaySku,
    shipToLocationAvailability: { quantity: item.targetQty },
  };

  if (item.offerId) {
    request.offers = [{ offerId: item.offerId, availableQuantity: item.targetQty }];
  }

  const result = await ebayInventoryFetchWithBody(
    accessToken,
    "POST",
    `${INV_API}/bulk_update_price_quantity`,
    { requests: [request] },
  );

  if (!result.ok) {
    const errText = JSON.stringify(result.data || {}).slice(0, 500);
    return {
      ok: false,
      error: `bulk_update_failed_${result.status}: ${errText}`,
      errorCode: String(result.status),
    };
  }

  const payload = isRecord(result.data) ? result.data : {};
  const responses = Array.isArray(payload.responses) ? payload.responses : [];
  const first = isRecord(responses[0]) ? responses[0] : null;
  const statusCode = first?.statusCode ?? first?.status;

  if (statusCode != null && Number(statusCode) >= 400) {
    const errors = Array.isArray(first?.errors) ? first.errors : [];
    const msg = errors.length
      ? JSON.stringify(errors[0]).slice(0, 300)
      : JSON.stringify(first).slice(0, 300);
    return { ok: false, error: msg, errorCode: String(statusCode) };
  }

  const responseRef = typeof first?.offerId === "string"
    ? first.offerId
    : item.offerId || item.ebaySku;

  return { ok: true, responseRef };
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
};
