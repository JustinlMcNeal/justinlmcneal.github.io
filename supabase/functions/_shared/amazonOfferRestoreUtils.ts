/** Shared Amazon LISTING_OFFER_ONLY PUT submit (Phase 059B.2). */

import {
  applyLocalListingPatchUpdate,
  buildOfferRestorePutBody,
  mapPatchIssues,
  patchSubmissionAccepted,
} from "./amazonListingPatchUtils.ts";
import {
  putListingsItemLiveSubmit,
  putListingsItemValidationPreview,
} from "./amazonListingPayloadUtils.ts";
import { resolveAmazonCredentials } from "./amazonPtdAuthUtils.ts";
import type { readSyncEnvConfig } from "./amazonSyncAccountUtils.ts";

export type OfferRestorePatch = { price?: number; quantity?: number };

export type OfferRestoreSubmitResult = {
  ok: boolean;
  preview: boolean;
  offerRestore: boolean;
  submissionStatus?: string | null;
  submissionId?: string | null;
  issues: ReturnType<typeof mapPatchIssues>;
  error?: string;
  hint?: string | null;
  httpStatus?: number;
  patch?: OfferRestorePatch;
};

/**
 * Build offer-restore PUT body and submit to Amazon (validation preview or live).
 * Updates local listing cache on live success.
 */
export async function submitAmazonOfferRestore(params: {
  // deno-lint-ignore no-explicit-any
  client: any;
  listing: Record<string, unknown>;
  patch: OfferRestorePatch;
  preview: boolean;
  syncEnv: ReturnType<typeof readSyncEnvConfig>;
  now: string;
}): Promise<OfferRestoreSubmitResult> {
  const listingId = String(params.listing.id || "").trim();
  const sellerAccountId = String(params.listing.seller_account_id || "").trim();
  const sellerSku = String(params.listing.seller_sku || "").trim();
  const marketplaceId = String(params.listing.marketplace_id || "").trim();

  const restoreBody = buildOfferRestorePutBody(params.listing, params.patch);
  if (!restoreBody.ok) {
    return {
      ok: false,
      preview: params.preview,
      offerRestore: true,
      issues: [],
      error: restoreBody.error,
    };
  }

  const credsResult = await resolveAmazonCredentials(
    params.client,
    sellerAccountId,
    params.syncEnv,
  );
  if (!credsResult.ok) {
    return {
      ok: false,
      preview: params.preview,
      offerRestore: true,
      issues: [],
      error: credsResult.error,
    };
  }

  const putParams = {
    creds: credsResult.creds,
    sellerId: credsResult.creds.account.seller_id,
    sellerSku,
    marketplaceId,
    body: restoreBody.body,
  };

  const putResult = params.preview
    ? await putListingsItemValidationPreview(putParams)
    : await putListingsItemLiveSubmit(putParams);

  if (!putResult.ok) {
    return {
      ok: false,
      preview: params.preview,
      offerRestore: true,
      issues: mapPatchIssues(putResult.issues),
      error: putResult.error,
      hint: putResult.hint ?? null,
      httpStatus: putResult.httpStatus,
      patch: params.patch,
    };
  }

  const issues = mapPatchIssues(putResult.issues);
  if (!patchSubmissionAccepted(putResult.submissionStatus)) {
    return {
      ok: false,
      preview: params.preview,
      offerRestore: true,
      submissionStatus: putResult.submissionStatus,
      submissionId: putResult.submissionId,
      issues,
      error: "patch_rejected",
      patch: params.patch,
    };
  }

  if (!params.preview && listingId) {
    await applyLocalListingPatchUpdate(params.client, listingId, params.patch, params.now);
  }

  return {
    ok: true,
    preview: params.preview,
    offerRestore: true,
    submissionStatus: putResult.submissionStatus,
    submissionId: putResult.submissionId,
    issues,
    patch: params.patch,
  };
}
