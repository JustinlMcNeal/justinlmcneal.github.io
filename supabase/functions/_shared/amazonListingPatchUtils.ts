// patchListingsItem helpers for price/qty updates on existing Amazon listings.

import { signSpApiRequest, spApiHintForHttpStatus } from "./amazonSigV4Utils.ts";
import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";
import { mapAmazonListingIssues } from "./amazonListingPayloadUtils.ts";

export type ListingPatchInput = {
  price?: number | null;
  quantity?: number | null;
};

export type PatchOperation = {
  op: "replace";
  path: string;
  value: unknown;
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

export function validateListingPatchInput(input: ListingPatchInput): {
  ok: true;
  price?: number;
  quantity?: number;
} | { ok: false; error: string } {
  const hasPrice = input.price !== undefined && input.price !== null;
  const hasQty = input.quantity !== undefined && input.quantity !== null;

  if (!hasPrice && !hasQty) {
    return { ok: false, error: "invalid_request" };
  }

  const result: { ok: true; price?: number; quantity?: number } = { ok: true };

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

  return result;
}

export function isFbaManagedListing(listing: Record<string, unknown>): boolean {
  const channel = String(listing.fulfillment_channel || "").toUpperCase();
  if (channel.includes("AMAZON") || channel === "AFN") return true;
  const fba = Number(listing.fba_fulfillable_quantity);
  const fbm = Number(listing.fbm_quantity);
  return Number.isFinite(fba) && fba > 0 && (!Number.isFinite(fbm) || fbm <= 0);
}

export function buildListingPatchOperations(
  marketplaceId: string,
  currency: string,
  patch: { price?: number; quantity?: number },
  fulfillmentChannelCode = "DEFAULT",
): PatchOperation[] {
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
        fulfillment_channel_code: fulfillmentChannelCode,
        quantity: patch.quantity,
      }],
    });
  }

  return patches;
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
  patch: { price?: number; quantity?: number },
  now: string,
) {
  const rowPatch: Record<string, unknown> = { updated_at: now, last_synced_at: now };

  if (patch.price !== undefined) {
    rowPatch.price = patch.price;
    rowPatch.price_synced_at = now;
  }
  if (patch.quantity !== undefined) {
    rowPatch.fbm_quantity = patch.quantity;
    rowPatch.quantity_last_source = "manual";
    rowPatch.quantity_synced_at = now;
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
