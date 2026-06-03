// patchListingsItem helpers for price/qty updates on existing Amazon listings.

import { signSpApiRequest, spApiHintForHttpStatus } from "./amazonSigV4Utils.ts";
import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";
import { mapAmazonListingIssues } from "./amazonListingPayloadUtils.ts";
import type { ListingsItemRequestBody } from "./amazonListingPayloadUtils.ts";
import { extractLiveOfferPrice } from "./amazonSpApiUtils.ts";

export type ListingCopyPatchInput = {
  title?: string;
  description?: string;
  bulletPoints?: string[];
};

export type ListingPatchInput = {
  price?: number | null;
  quantity?: number | null;
  imageUrls?: string[] | null;
} & ListingCopyPatchInput;

export type PatchOperation = {
  op: "replace" | "delete";
  path: string;
  value?: unknown;
};

export type PatchListingsResult =
  | {
    ok: true;
    httpStatus: number;
    submissionId: string | null;
    submissionStatus: string;
    issues: Record<string, unknown>[];
    rawResponse: Record<string, unknown>;
  }
  | { ok: false; error: string; httpStatus?: number; hint?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasCopyPatchInput(input: ListingCopyPatchInput): boolean {
  if (input.title !== undefined) return true;
  if (input.description !== undefined) return true;
  if (input.bulletPoints !== undefined) return true;
  return false;
}

export function validateListingPatchInput(input: ListingPatchInput): {
  ok: true;
  price?: number;
  quantity?: number;
  imageUrls?: string[];
  title?: string;
  description?: string;
  bulletPoints?: string[];
} | { ok: false; error: string } {
  const hasPrice = input.price !== undefined && input.price !== null;
  const hasQty = input.quantity !== undefined && input.quantity !== null;
  const hasImages = input.imageUrls !== undefined && input.imageUrls !== null;
  const hasCopy = hasCopyPatchInput(input);

  if (!hasPrice && !hasQty && !hasImages && !hasCopy) {
    return { ok: false, error: "invalid_request" };
  }

  const result: {
    ok: true;
    price?: number;
    quantity?: number;
    imageUrls?: string[];
    title?: string;
    description?: string;
    bulletPoints?: string[];
  } = { ok: true };

  if (hasPrice) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price < 0) {
      return { ok: false, error: "invalid_price" };
    }
    result.price = Math.round(price * 100) / 100;
  }

  if (hasQty) {
    const quantity = Number(input.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return { ok: false, error: "invalid_quantity" };
    }
    result.quantity = quantity;
  }

  if (hasImages) {
    const urls = (input.imageUrls || [])
      .map((entry) => String(entry || "").trim())
      .filter((entry) => entry.startsWith("http"))
      .slice(0, 9);
    if (!urls.length) {
      return { ok: false, error: "invalid_image_urls" };
    }
    result.imageUrls = urls;
  }

  if (input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title) return { ok: false, error: "invalid_title" };
    result.title = title;
  }

  if (input.description !== undefined) {
    result.description = String(input.description).trim();
  }

  if (input.bulletPoints !== undefined) {
    const bullets = input.bulletPoints
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!bullets.length) return { ok: false, error: "invalid_bullet_points" };
    result.bulletPoints = bullets;
  }

  return result;
}

/** PATCH operations for listing copy (title, description, bullets). */
export function buildListingCopyPatchOperations(
  marketplaceId: string,
  copy: ListingCopyPatchInput,
  languageTag = "en_US",
): PatchOperation[] {
  const patches: PatchOperation[] = [];

  if (copy.title !== undefined) {
    patches.push({
      op: "replace",
      path: "/attributes/item_name",
      value: [{
        marketplace_id: marketplaceId,
        language_tag: languageTag,
        value: copy.title,
      }],
    });
  }

  if (copy.description !== undefined) {
    patches.push({
      op: "replace",
      path: "/attributes/product_description",
      value: [{
        marketplace_id: marketplaceId,
        language_tag: languageTag,
        value: copy.description,
      }],
    });
  }

  if (copy.bulletPoints !== undefined) {
    patches.push({
      op: "replace",
      path: "/attributes/bullet_point",
      value: copy.bulletPoints.map((value) => ({
        marketplace_id: marketplaceId,
        language_tag: languageTag,
        value,
      })),
    });
  }

  return patches;
}

export function isFbaManagedListing(listing: Record<string, unknown>): boolean {
  const channel = String(listing.fulfillment_channel || "").toUpperCase();
  if (channel.includes("AMAZON") || channel === "AFN") return true;
  const fba = Number(listing.fba_fulfillable_quantity);
  const fbm = Number(listing.fbm_quantity);
  return Number.isFinite(fba) && fba > 0 && (!Number.isFinite(fbm) || fbm <= 0);
}

export function normalizeFulfillmentChannelCode(
  channel: string | null | undefined,
): string {
  const upper = String(channel || "").trim().toUpperCase();
  if (!upper || upper === "MERCHANT" || upper === "DEFAULT") return "DEFAULT";
  return upper;
}

export function buildListingPatchOperations(
  marketplaceId: string,
  currency: string,
  patch: { price?: number; quantity?: number },
  fulfillmentChannelCode = "DEFAULT",
): PatchOperation[] {
  const channelCode = normalizeFulfillmentChannelCode(fulfillmentChannelCode);
  const patches: PatchOperation[] = [];

  if (patch.price !== undefined) {
    patches.push({
      op: "replace",
      path: "/attributes/purchasable_offer",
      value: [{
        marketplace_id: marketplaceId,
        currency: currency || "USD",
        our_price: [{
          schedule: [{ value_with_tax: patch.price }],
        }],
      }],
    });
  }

  if (patch.quantity !== undefined) {
    patches.push({
      op: "replace",
      path: "/attributes/fulfillment_availability",
      value: [{
        fulfillment_channel_code: channelCode,
        quantity: patch.quantity,
      }],
    });
  }

  return patches;
}

/** PATCH operations for main + secondary product images on a live listing. */
export function buildListingImagePatchOperations(
  marketplaceId: string,
  imageUrls: string[],
  previousSecondaryCount = 0,
): PatchOperation[] {
  const patches: PatchOperation[] = [];
  const main = String(imageUrls[0] || "").trim();
  if (!main) return patches;

  patches.push({
    op: "replace",
    path: "/attributes/main_product_image_locator",
    value: [{
      marketplace_id: marketplaceId,
      media_location: main,
    }],
  });

  const newSecondaryCount = Math.max(0, imageUrls.length - 1);
  const priorSecondaryCount = Math.max(0, Math.min(8, previousSecondaryCount));

  for (let slot = 1; slot <= 8; slot += 1) {
    const path = `/attributes/other_product_image_locator_${slot}`;
    const url = String(imageUrls[slot] || "").trim();
    if (url.startsWith("http")) {
      patches.push({
        op: "replace",
        path,
        value: [{
          marketplace_id: marketplaceId,
          media_location: url,
        }],
      });
      continue;
    }

    // Only delete slots that previously had images — never delete empty slots Amazon never set.
    if (slot <= priorSecondaryCount && slot > newSecondaryCount) {
      patches.push({ op: "delete", path });
    }
  }

  return patches;
}

/** Count secondary image slots currently set on a synced listing. */
export function countAmazonListingSecondaryImages(
  rawListing: unknown,
  marketplaceId = "ATVPDKIKX0DER",
): number {
  const item = rawListing && typeof rawListing === "object"
    ? rawListing as Record<string, unknown>
    : null;
  if (!item) return 0;

  const attrs = item.attributes && typeof item.attributes === "object"
    ? item.attributes as Record<string, unknown>
    : {};

  let count = 0;
  for (let slot = 1; slot <= 8; slot += 1) {
    const rows = attrs[`other_product_image_locator_${slot}`];
    if (!Array.isArray(rows)) continue;
    const hasUrl = rows.some((entry) => {
      const rec = entry && typeof entry === "object"
        ? entry as Record<string, unknown>
        : null;
      if (rec?.marketplace_id && rec.marketplace_id !== marketplaceId) return false;
      return String(rec?.media_location || "").trim().startsWith("http");
    });
    if (hasUrl) count = slot;
  }

  return count;
}

export function listingHasMissingOffer(listing: Record<string, unknown>): boolean {
  const price = Number(listing.price);
  return !Number.isFinite(price) || price <= 0;
}

/**
 * Use LISTING_OFFER_ONLY PUT instead of PATCH when:
 * - the seller offer is not buyable yet, or
 * - the live offer price (product page) still differs from the price being submitted.
 */
export function listingNeedsOfferPut(
  listing: Record<string, unknown>,
  patch: { price?: number } = {},
): boolean {
  const asin = String(listing.asin || "").trim();
  const marketplaceId = String(listing.marketplace_id || "").trim();

  if (patch.price !== undefined && asin && marketplaceId) {
    const livePrice = extractLiveOfferPrice(listing.raw_listing, marketplaceId);
    if (livePrice !== null && Math.abs(livePrice - patch.price) >= 0.01) {
      return true;
    }
  }

  if (listing.listing_status_buyable === true) return false;
  if (!asin) return listingHasMissingOffer(listing);
  return true;
}

export function buildOfferRestorePutBody(
  listing: Record<string, unknown>,
  patch: { price?: number; quantity?: number },
): { ok: true; body: ListingsItemRequestBody } | { ok: false; error: string } {
  const marketplaceId = String(listing.marketplace_id || "").trim();
  if (!marketplaceId) {
    return { ok: false, error: "listing_not_patchable" };
  }

  const price = patch.price !== undefined
    ? patch.price
    : Number(listing.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: "invalid_price" };
  }

  const channelCode = normalizeFulfillmentChannelCode(
    String(listing.fulfillment_channel || "DEFAULT"),
  );
  const currency = String(listing.currency || "USD");
  const asin = String(listing.asin || listing.matched_asin || "").trim();
  const attributes: Record<string, unknown> = {
    purchasable_offer: [{
      marketplace_id: marketplaceId,
      currency,
      our_price: [{
        schedule: [{ value_with_tax: price }],
      }],
    }],
    condition_type: [{ value: "new_new", marketplace_id: marketplaceId }],
    list_price: [{
      marketplace_id: marketplaceId,
      currency,
      value: price,
    }],
  };

  if (asin) {
    attributes.merchant_suggested_asin = [{
      value: asin,
      marketplace_id: marketplaceId,
    }];
  }

  const quantity = patch.quantity !== undefined
    ? patch.quantity
    : Number(listing.fbm_quantity);
  if (Number.isInteger(quantity) && quantity >= 0) {
    attributes.fulfillment_availability = [{
      fulfillment_channel_code: channelCode,
      quantity,
    }];
  }

  return {
    ok: true,
    body: {
      productType: "PRODUCT",
      requirements: "LISTING_OFFER_ONLY",
      attributes,
    },
  };
}

async function patchListingsItemRequest(params: {
  creds: AmazonCredentials;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  productType: string;
  patches: PatchOperation[];
  mode?: "VALIDATION_PREVIEW";
  userAgent: string;
  failureError: string;
}): Promise<PatchListingsResult> {
  const query = new URLSearchParams({ marketplaceIds: params.marketplaceId });
  if (params.mode) query.set("mode", params.mode);

  const url =
    `${params.creds.endpoint}/listings/2021-08-01/items/${encodeURIComponent(params.sellerId)}/${encodeURIComponent(params.sellerSku)}?${query.toString()}`;

  const requestBody = JSON.stringify({
    productType: params.productType,
    patches: params.patches,
  });

  const baseHeaders: Record<string, string> = {
    "x-amz-access-token": params.creds.accessToken,
    "content-type": "application/json",
    "user-agent": params.userAgent,
  };

  if (!params.creds.aws) {
    return { ok: false, error: "server_misconfigured" };
  }

  const fetchHeaders = await signSpApiRequest({
    method: "PATCH",
    url,
    region: params.creds.aws.region,
    service: "execute-api",
    accessKeyId: params.creds.aws.accessKeyId,
    secretAccessKey: params.creds.aws.secretAccessKey,
    sessionToken: params.creds.aws.sessionToken,
    headers: baseHeaders,
    body: requestBody,
  });

  const resp = await fetch(url, {
    method: "PATCH",
    headers: fetchHeaders,
    body: requestBody,
  });

  let data: Record<string, unknown>;
  try {
    data = await resp.json() as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: params.failureError,
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, true),
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: params.failureError,
      httpStatus: resp.status,
      hint: spApiHintForHttpStatus(resp.status, true),
    };
  }

  const issues = asArray(data.issues)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  return {
    ok: true,
    httpStatus: resp.status,
    submissionId: typeof data.submissionId === "string" ? data.submissionId : null,
    submissionStatus: typeof data.status === "string" ? data.status : "INVALID",
    issues,
    rawResponse: data,
  };
}

export async function patchListingsItemValidationPreview(params: {
  creds: AmazonCredentials;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  productType: string;
  patches: PatchOperation[];
}): Promise<PatchListingsResult> {
  return patchListingsItemRequest({
    ...params,
    mode: "VALIDATION_PREVIEW",
    userAgent: "KarryKraze-AmazonPatchPreview/1.0",
    failureError: "sp_api_validation_failed",
  });
}

export async function patchListingsItemLiveUpdate(params: {
  creds: AmazonCredentials;
  sellerId: string;
  sellerSku: string;
  marketplaceId: string;
  productType: string;
  patches: PatchOperation[];
}): Promise<PatchListingsResult> {
  return patchListingsItemRequest({
    ...params,
    userAgent: "KarryKraze-AmazonPatchLive/1.0",
    failureError: "sp_api_patch_failed",
  });
}

export function mapPatchIssues(issues: unknown[]): ReturnType<typeof mapAmazonListingIssues> {
  return mapAmazonListingIssues(
    issues,
    "Amazon reported an issue with this listing update.",
  );
}

export async function applyLocalListingPatchUpdate(
  // deno-lint-ignore no-explicit-any
  client: any,
  listingId: string,
  patch: { price?: number; quantity?: number; title?: string },
  now: string,
) {
  const rowPatch: Record<string, unknown> = { updated_at: now, last_synced_at: now };

  if (patch.price !== undefined) {
    // Keep `price` as the live customer-facing offer from sync — not the patch target.
    rowPatch.price_last_source = "manual";
    rowPatch.price_synced_at = now;
  }
  if (patch.quantity !== undefined) {
    rowPatch.fbm_quantity = patch.quantity;
    rowPatch.quantity_last_source = "manual";
    rowPatch.quantity_synced_at = now;
  }
  if (patch.title !== undefined) {
    rowPatch.amazon_title = patch.title;
  }

  const { error } = await client
    .from("amazon_listings")
    .update(rowPatch)
    .eq("id", listingId);

  if (error) throw new Error("database_error");
}

export function patchSubmissionAccepted(status: string): boolean {
  const normalized = String(status || "").toUpperCase();
  return normalized === "ACCEPTED" || normalized === "VALID";
}
