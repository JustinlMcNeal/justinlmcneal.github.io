/** Bulk listing PATCH orchestration (Listings Items API, sequential). */

import {
  applyLocalListingPatchUpdate,
  buildListingPatchOperations,
  isFbaManagedListing,
  mapPatchIssues,
  patchListingsItemLiveUpdate,
  patchListingsItemValidationPreview,
  patchSubmissionAccepted,
  validateListingPatchInput,
  type ListingPatchInput,
} from "./amazonListingPatchUtils.ts";
import { resolveAmazonCredentials } from "./amazonPtdAuthUtils.ts";
import type { readSyncEnvConfig } from "./amazonSyncAccountUtils.ts";

export const BULK_PATCH_MAX_ITEMS = 50;
export const BULK_PATCH_DELAY_MS = 220;

export type BulkPatchOperation =
  | "set_price"
  | "adjust_price_percent"
  | "adjust_price_amount"
  | "match_kk_price"
  | "set_quantity"
  | "match_kk_stock"
  | "match_kk_price_and_stock";

const VALID_OPERATIONS = new Set<BulkPatchOperation>([
  "set_price",
  "adjust_price_percent",
  "adjust_price_amount",
  "match_kk_price",
  "set_quantity",
  "match_kk_stock",
  "match_kk_price_and_stock",
]);

export type BulkPatchListingRow = {
  amazon_listing_id: string;
  seller_account_id: string | null;
  seller_sku: string | null;
  marketplace_id: string | null;
  product_type: string | null;
  currency: string | null;
  fulfillment_channel: string | null;
  price: number | null;
  fbm_quantity: number | null;
  fba_fulfillable_quantity: number | null;
  kk_price: number | null;
  kk_stock: number | null;
};

export type BulkPatchItemResult = {
  amazonListingId: string;
  sellerSku: string | null;
  status: "success" | "failed" | "skipped";
  error?: string;
  patch?: { price?: number; quantity?: number };
  issues?: ReturnType<typeof mapPatchIssues>;
};

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function currentQuantity(listing: BulkPatchListingRow): number | null {
  const fbm = asNumber(listing.fbm_quantity);
  if (fbm !== null) return fbm;
  const fba = asNumber(listing.fba_fulfillable_quantity);
  return fba;
}

export function parseBulkPatchOperation(value: unknown): BulkPatchOperation | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim() as BulkPatchOperation;
  return VALID_OPERATIONS.has(normalized) ? normalized : null;
}

export function operationNeedsValue(operation: BulkPatchOperation): boolean {
  return operation === "set_price" ||
    operation === "adjust_price_percent" ||
    operation === "adjust_price_amount" ||
    operation === "set_quantity";
}

export function computeBulkPatchInput(
  listing: BulkPatchListingRow,
  operation: BulkPatchOperation,
  value?: number | null,
): { ok: true; patch: ListingPatchInput } | { ok: false; error: string } {
  /** @type {ListingPatchInput} */
  const patch: ListingPatchInput = {};
  const currentPrice = asNumber(listing.price);
  const qty = currentQuantity(listing);
  const kkPrice = asNumber(listing.kk_price);
  const kkStock = asNumber(listing.kk_stock);
  const fba = isFbaManagedListing(listing as Record<string, unknown>);

  switch (operation) {
    case "set_price": {
      if (value === undefined || value === null || !Number.isFinite(Number(value))) {
        return { ok: false, error: "invalid_price" };
      }
      patch.price = roundPrice(Number(value));
      break;
    }
    case "adjust_price_percent": {
      if (currentPrice === null) return { ok: false, error: "missing_current_price" };
      if (value === undefined || value === null || !Number.isFinite(Number(value))) {
        return { ok: false, error: "invalid_price" };
      }
      patch.price = roundPrice(currentPrice * (1 + Number(value) / 100));
      break;
    }
    case "adjust_price_amount": {
      if (currentPrice === null) return { ok: false, error: "missing_current_price" };
      if (value === undefined || value === null || !Number.isFinite(Number(value))) {
        return { ok: false, error: "invalid_price" };
      }
      patch.price = roundPrice(currentPrice + Number(value));
      break;
    }
    case "match_kk_price": {
      if (kkPrice === null || kkPrice <= 0) return { ok: false, error: "missing_kk_price" };
      patch.price = roundPrice(kkPrice);
      break;
    }
    case "set_quantity": {
      if (fba) return { ok: false, error: "fba_quantity_not_supported" };
      if (value === undefined || value === null || !Number.isFinite(Number(value))) {
        return { ok: false, error: "invalid_quantity" };
      }
      patch.quantity = Math.max(0, Math.trunc(Number(value)));
      break;
    }
    case "match_kk_stock": {
      if (fba) return { ok: false, error: "fba_quantity_not_supported" };
      if (kkStock === null || kkStock < 0) return { ok: false, error: "missing_kk_stock" };
      patch.quantity = Math.max(0, Math.trunc(kkStock));
      break;
    }
    case "match_kk_price_and_stock": {
      if (kkPrice === null || kkPrice <= 0) return { ok: false, error: "missing_kk_price" };
      patch.price = roundPrice(kkPrice);
      if (fba) return { ok: true, patch };
      if (kkStock === null || kkStock < 0) return { ok: false, error: "missing_kk_stock" };
      patch.quantity = Math.max(0, Math.trunc(kkStock));
      break;
    }
    default:
      return { ok: false, error: "invalid_operation" };
  }

  if (patch.price !== undefined && patch.price !== null && patch.price < 0) {
    return { ok: false, error: "invalid_price" };
  }

  const hasPriceChange = patch.price !== undefined &&
    (currentPrice === null || roundPrice(currentPrice) !== patch.price);
  const hasQtyChange = patch.quantity !== undefined &&
    (qty === null || qty !== patch.quantity);

  if (!hasPriceChange && !hasQtyChange) {
    return { ok: false, error: "no_change" };
  }

  if (patch.price === undefined && patch.quantity === undefined) {
    return { ok: false, error: "invalid_request" };
  }

  const validated = validateListingPatchInput(patch);
  if (!validated.ok) return validated;

  return { ok: true, patch: validated };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processBulkListingPatches(params: {
  // deno-lint-ignore no-explicit-any
  client: any;
  listingIds: string[];
  operation: BulkPatchOperation;
  value?: number | null;
  preview: boolean;
  syncEnv: ReturnType<typeof readSyncEnvConfig>;
  now: string;
}): Promise<{
  results: BulkPatchItemResult[];
  summary: { total: number; succeeded: number; failed: number; skipped: number };
}> {
  const uniqueIds = [...new Set(params.listingIds.map((id) => id.trim()).filter(Boolean))];
  const results: BulkPatchItemResult[] = [];

  if (!uniqueIds.length) {
    return {
      results,
      summary: { total: 0, succeeded: 0, failed: 0, skipped: 0 },
    };
  }

  const { data: rows, error } = await params.client
    .from("v_amazon_listing_workspace")
    .select([
      "amazon_listing_id",
      "seller_account_id",
      "seller_sku",
      "marketplace_id",
      "product_type",
      "currency",
      "fulfillment_channel",
      "price",
      "fbm_quantity",
      "fba_fulfillable_quantity",
      "kk_price",
      "kk_stock",
    ].join(","))
    .in("amazon_listing_id", uniqueIds);

  if (error) throw new Error("database_error");

  const rowById = new Map<string, BulkPatchListingRow>();
  for (const row of (rows || []) as BulkPatchListingRow[]) {
    rowById.set(String(row.amazon_listing_id), row);
  }

  /** @type {Map<string, Awaited<ReturnType<typeof resolveAmazonCredentials>> & { ok: true }>} */
  const credsCache = new Map();

  for (let index = 0; index < uniqueIds.length; index++) {
    const listingId = uniqueIds[index];
    const listing = rowById.get(listingId);

    if (!listing) {
      results.push({
        amazonListingId: listingId,
        sellerSku: null,
        status: "failed",
        error: "listing_not_found",
      });
      continue;
    }

    const sellerSku = String(listing.seller_sku || "").trim() || null;
    const productType = String(listing.product_type || "").trim();
    const marketplaceId = String(listing.marketplace_id || "").trim();
    const sellerAccountId = String(listing.seller_account_id || "").trim();

    if (!sellerSku || !productType || !marketplaceId) {
      results.push({
        amazonListingId: listingId,
        sellerSku,
        status: "failed",
        error: "listing_not_patchable",
      });
      continue;
    }

    const computed = computeBulkPatchInput(listing, params.operation, params.value);
    if (!computed.ok) {
      results.push({
        amazonListingId: listingId,
        sellerSku,
        status: computed.error === "no_change" ? "skipped" : "failed",
        error: computed.error,
      });
      continue;
    }

    let credsResult = credsCache.get(sellerAccountId);
    if (!credsResult) {
      credsResult = await resolveAmazonCredentials(
        params.client,
        sellerAccountId,
        params.syncEnv,
      );
      if (!credsResult.ok) {
        results.push({
          amazonListingId: listingId,
          sellerSku,
          status: "failed",
          error: credsResult.error,
        });
        continue;
      }
      credsCache.set(sellerAccountId, credsResult);
    }

    const patches = buildListingPatchOperations(
      marketplaceId,
      String(listing.currency || "USD"),
      computed.patch,
      String(listing.fulfillment_channel || "DEFAULT") || "DEFAULT",
    );

    const patchParams = {
      creds: credsResult.creds,
      sellerId: credsResult.creds.account.seller_id,
      sellerSku,
      marketplaceId,
      productType,
      patches,
    };

    const patchResult = params.preview
      ? await patchListingsItemValidationPreview(patchParams)
      : await patchListingsItemLiveUpdate(patchParams);

    if (!patchResult.ok) {
      results.push({
        amazonListingId: listingId,
        sellerSku,
        status: "failed",
        error: patchResult.error,
      });
      if (index < uniqueIds.length - 1) await sleep(BULK_PATCH_DELAY_MS);
      continue;
    }

    const issues = mapPatchIssues(patchResult.issues);
    if (!patchSubmissionAccepted(patchResult.submissionStatus)) {
      results.push({
        amazonListingId: listingId,
        sellerSku,
        status: "failed",
        error: "patch_rejected",
        patch: computed.patch,
        issues,
      });
      if (index < uniqueIds.length - 1) await sleep(BULK_PATCH_DELAY_MS);
      continue;
    }

    if (!params.preview) {
      await applyLocalListingPatchUpdate(
        params.client,
        listingId,
        computed.patch,
        params.now,
      );
    }

    results.push({
      amazonListingId: listingId,
      sellerSku,
      status: "success",
      patch: computed.patch,
      issues,
    });

    if (index < uniqueIds.length - 1) await sleep(BULK_PATCH_DELAY_MS);
  }

  const summary = {
    total: results.length,
    succeeded: results.filter((row) => row.status === "success").length,
    failed: results.filter((row) => row.status === "failed").length,
    skipped: results.filter((row) => row.status === "skipped").length,
  };

  return { results, summary };
}
