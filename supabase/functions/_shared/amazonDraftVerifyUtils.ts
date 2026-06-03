// Post-submit draft verification: sync, optional offer activation, published reconciliation.

import {
  buildListingsItemRequestBody,
  putListingsItemLiveSubmit,
} from "./amazonListingPayloadUtils.ts";
import { patchSubmissionAccepted } from "./amazonListingPatchUtils.ts";
import { resolveAmazonCredentials } from "./amazonPtdAuthUtils.ts";
import { readListingSpApiStatusFlags } from "./amazonSpApiUtils.ts";
import { runMarketplaceSync } from "./amazonSyncRunUtils.ts";

export type DraftRowForVerify = {
  id: string;
  seller_account_id: string | null;
  seller_id: string | null;
  marketplace_id: string | null;
  seller_sku: string | null;
  kk_product_id: string | null;
  kk_variant_id: string | null;
  kk_sku: string | null;
  draft_status: string;
};

export type ListingRowForVerify = {
  id: string;
  listing_status: string;
  listing_status_buyable: boolean;
  seller_sku: string;
  marketplace_id: string;
  asin: string | null;
  price: number | null;
  fbm_quantity: number | null;
  raw_listing?: unknown;
};

/** Prefer stored flag; fall back to raw_listing summary when columns are stale. */
export function effectiveListingBuyable(
  listing: Pick<ListingRowForVerify, "listing_status_buyable" | "marketplace_id" | "raw_listing">,
): boolean {
  if (listing.listing_status_buyable === true) return true;
  return readListingSpApiStatusFlags(listing.raw_listing, listing.marketplace_id).buyable;
}

export type VerifyNotFoundReason =
  | "listing_not_found_yet"
  | "awaiting_buyable"
  | "offer_activation_failed";

export type VerifyDraftOnceResult =
  | {
    status: "verified";
    listing: ListingRowForVerify;
    mappingId: string | null;
    offerActivationAttempted?: boolean;
  }
  | { status: "not_found"; reason: VerifyNotFoundReason; offerActivationAttempted?: boolean }
  | { status: "error"; error: string };

const VERIFIABLE_LISTING_STATUSES = new Set([
  "active",
  "inactive",
  "issue",
  "suppressed",
  "unknown",
]);

export function isListingVerifiable(listing: ListingRowForVerify): boolean {
  return VERIFIABLE_LISTING_STATUSES.has(String(listing.listing_status || "").toLowerCase());
}

/** Catalog exists on Amazon but the seller offer is not live yet (missing/inactive offer). */
export function listingNeedsOfferActivation(listing: ListingRowForVerify): boolean {
  if (effectiveListingBuyable(listing)) return false;
  const status = String(listing.listing_status || "").toLowerCase();
  if (status === "issue" || status === "suppressed") return false;
  const asin = String(listing.asin || "").trim();
  if (!asin) return false;
  // Include active rows with stale buyable=false (manual price preserve edge case).
  return status === "inactive" || status === "unknown" || status === "active";
}

function asDraftPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function attemptOfferActivationForDraft(
  // deno-lint-ignore no-explicit-any
  client: any,
  draft: DraftRowForVerify,
  listing: ListingRowForVerify,
  env: {
    lwaClientId: string;
    lwaClientSecret: string;
    spApiEndpointOverride?: string | null;
    awsAccessKeyId?: string | null;
    awsSecretAccessKey?: string | null;
    awsSessionToken?: string | null;
    awsRegionOverride?: string | null;
    allowUnsignedSpApi?: boolean;
  },
): Promise<{ ok: true; submissionStatus: string } | { ok: false; error: string }> {
  if (Deno.env.get("AMAZON_ENABLE_LIVE_SUBMIT") !== "true") {
    return { ok: false, error: "live_submit_disabled" };
  }

  const asin = String(listing.asin || "").trim();
  const sellerSku = String(draft.seller_sku || "").trim();
  const marketplaceId = String(draft.marketplace_id || "").trim();
  const sellerAccountId = draft.seller_account_id;

  if (!asin || !sellerSku || !marketplaceId || !sellerAccountId) {
    return { ok: false, error: "invalid_request" };
  }

  const { data: draftRow, error: draftErr } = await client
    .from("amazon_listing_drafts")
    .select("draft_payload, product_type, seller_id")
    .eq("id", draft.id)
    .maybeSingle();

  if (draftErr) return { ok: false, error: "database_error" };
  if (!draftRow) return { ok: false, error: "draft_not_found" };

  const payloadResult = buildListingsItemRequestBody({
    seller_sku: draft.seller_sku,
    marketplace_id: draft.marketplace_id,
    product_type: draftRow.product_type,
    requirements: "LISTING_OFFER_ONLY",
    matched_asin: asin,
    draft_payload: asDraftPayload(draftRow.draft_payload),
  });

  if (!payloadResult.ok) {
    return { ok: false, error: payloadResult.error };
  }

  const credResult = await resolveAmazonCredentials(client, sellerAccountId, env);
  if (!credResult.ok) {
    return { ok: false, error: credResult.error };
  }

  const sellerId = String(draft.seller_id || draftRow.seller_id || credResult.creds.account.seller_id || "")
    .trim();
  if (!sellerId) {
    return { ok: false, error: "amazon_not_connected" };
  }

  const submitResult = await putListingsItemLiveSubmit({
    creds: credResult.creds,
    sellerId,
    sellerSku,
    marketplaceId,
    body: payloadResult.body,
  });

  if (!submitResult.ok) {
    return { ok: false, error: submitResult.error };
  }

  if (!patchSubmissionAccepted(submitResult.submissionStatus)) {
    return { ok: false, error: "offer_activation_rejected" };
  }

  return { ok: true, submissionStatus: submitResult.submissionStatus };
}

export function asDraftRowForVerify(draft: Record<string, unknown>): DraftRowForVerify {
  return {
    id: String(draft.id),
    seller_account_id: typeof draft.seller_account_id === "string" ? draft.seller_account_id : null,
    seller_id: typeof draft.seller_id === "string" ? draft.seller_id : null,
    marketplace_id: typeof draft.marketplace_id === "string" ? draft.marketplace_id : null,
    seller_sku: typeof draft.seller_sku === "string" ? draft.seller_sku : null,
    kk_product_id: typeof draft.kk_product_id === "string" ? draft.kk_product_id : null,
    kk_variant_id: typeof draft.kk_variant_id === "string" ? draft.kk_variant_id : null,
    kk_sku: typeof draft.kk_sku === "string" ? draft.kk_sku : null,
    draft_status: String(draft.draft_status || ""),
  };
}

export async function runSingleSkuSyncForDraft(
  // deno-lint-ignore no-explicit-any
  client: any,
  draft: DraftRowForVerify,
  triggeredBy: string,
  env: {
    lwaClientId: string;
    lwaClientSecret: string;
    spApiEndpointOverride?: string | null;
    awsAccessKeyId?: string | null;
    awsSecretAccessKey?: string | null;
    awsSessionToken?: string | null;
    awsRegionOverride?: string | null;
    allowUnsignedSpApi?: boolean;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sellerAccountId = draft.seller_account_id;
  const marketplaceId = String(draft.marketplace_id || "").trim();
  const sellerSku = String(draft.seller_sku || "").trim();

  if (!sellerAccountId || !marketplaceId || !sellerSku) {
    return { ok: false, error: "invalid_request" };
  }

  const credResult = await resolveAmazonCredentials(client, sellerAccountId, env);
  if (!credResult.ok) {
    return { ok: false, error: credResult.error };
  }

  const { creds } = credResult;
  const now = new Date().toISOString();

  try {
    const run = await runMarketplaceSync({
      client,
      account: { id: creds.account.id, seller_id: creds.account.seller_id },
      marketplaceId,
      syncType: "single_sku",
      maxPages: 1,
      accessToken: creds.accessToken,
      endpoint: creds.endpoint,
      aws: creds.aws,
      triggeredBy: triggeredBy,
      sellerSku,
      now,
    });

    if (run.status === "failed" && run.recordsSeen === 0) {
      return { ok: false, error: "sync_failed" };
    }

    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "invalid_request") {
      return { ok: false, error: "invalid_request" };
    }
    if (err instanceof Error && err.message === "database_error") {
      return { ok: false, error: "database_error" };
    }
    return { ok: false, error: "sync_failed" };
  }
}

export async function verifySubmittedDraftOnce(
  // deno-lint-ignore no-explicit-any
  client: any,
  draft: DraftRowForVerify,
  actorId: string | null,
  env: {
    lwaClientId: string;
    lwaClientSecret: string;
    spApiEndpointOverride?: string | null;
    awsAccessKeyId?: string | null;
    awsSecretAccessKey?: string | null;
    awsSessionToken?: string | null;
    awsRegionOverride?: string | null;
    allowUnsignedSpApi?: boolean;
  },
  options: { runSingleSkuSync?: boolean } = {},
): Promise<VerifyDraftOnceResult> {
  const runSingleSkuSync = options.runSingleSkuSync !== false;
  const now = new Date().toISOString();
  const triggeredBy = actorId || "system:amazon-verify";

  if (!draft.seller_sku?.trim() || !draft.marketplace_id?.trim() || !draft.seller_account_id) {
    return { status: "error", error: "invalid_request" };
  }

  if (runSingleSkuSync) {
    const syncResult = await runSingleSkuSyncForDraft(client, draft, triggeredBy, env);
    if (!syncResult.ok) {
      return { status: "error", error: syncResult.error };
    }
  }

  let listing = await findListingForDraft(client, draft);
  if (!listing || !isListingVerifiable(listing)) {
    return { status: "not_found", reason: "listing_not_found_yet" };
  }

  let offerActivationAttempted = false;

  if (listingNeedsOfferActivation(listing)) {
    const offerResult = await attemptOfferActivationForDraft(client, draft, listing, env);
    offerActivationAttempted = true;

    if (offerResult.ok) {
      const resync = await runSingleSkuSyncForDraft(client, draft, triggeredBy, env);
      if (!resync.ok) {
        return { status: "error", error: resync.error };
      }
      listing = await findListingForDraft(client, draft);
      if (!listing || !isListingVerifiable(listing)) {
        return {
          status: "not_found",
          reason: "listing_not_found_yet",
          offerActivationAttempted,
        };
      }
    } else if (offerResult.error !== "live_submit_disabled") {
      console.log(
        `[amazonDraftVerify] offer_activation_failed draftId=${draft.id} error=${offerResult.error}`,
      );
      return {
        status: "not_found",
        reason: "offer_activation_failed",
        offerActivationAttempted,
      };
    }
  }

  if (!effectiveListingBuyable(listing)) {
    return {
      status: "not_found",
      reason: "awaiting_buyable",
      offerActivationAttempted,
    };
  }

  if (listing.listing_status_buyable !== true) {
    await client
      .from("amazon_listings")
      .update({
        listing_status_buyable: true,
        listing_status_discoverable: readListingSpApiStatusFlags(
          listing.raw_listing,
          listing.marketplace_id,
        ).discoverable,
        updated_at: now,
      })
      .eq("id", listing.id);
    listing.listing_status_buyable = true;
  }

  const { mappingId } = await promoteDraftToPublished(
    client,
    draft.id,
    listing,
    draft,
    actorId,
    now,
  );

  return { status: "verified", listing, mappingId, offerActivationAttempted };
}

export async function findListingForDraft(
  // deno-lint-ignore no-explicit-any
  client: any,
  draft: DraftRowForVerify,
): Promise<ListingRowForVerify | null> {
  if (!draft.seller_account_id || !draft.marketplace_id || !draft.seller_sku) {
    return null;
  }

  const { data, error } = await client
    .from("amazon_listings")
    .select("id, listing_status, listing_status_buyable, seller_sku, marketplace_id, asin, price, fbm_quantity, raw_listing")
    .eq("seller_account_id", draft.seller_account_id)
    .eq("marketplace_id", draft.marketplace_id)
    .eq("seller_sku", draft.seller_sku.trim())
    .maybeSingle();

  if (error) throw new Error("database_error");
  return data as ListingRowForVerify | null;
}

export async function ensureDraftMapping(
  // deno-lint-ignore no-explicit-any
  client: any,
  listingId: string,
  draft: DraftRowForVerify,
  adminUserId: string | null,
  now: string,
): Promise<string | null> {
  const kkProductId = draft.kk_product_id;
  if (!kkProductId) return null;

  let existingQuery = client
    .from("amazon_listing_mappings")
    .select("id")
    .eq("amazon_listing_id", listingId)
    .eq("kk_product_id", kkProductId)
    .eq("mapping_status", "mapped");

  if (draft.kk_variant_id) {
    existingQuery = existingQuery.eq("kk_variant_id", draft.kk_variant_id);
  } else {
    existingQuery = existingQuery.is("kk_variant_id", null);
  }

  const { data: existing, error: existingErr } = await existingQuery.maybeSingle();

  if (existingErr) throw new Error("database_error");
  if (existing?.id) return existing.id as string;

  let kkSku = draft.kk_sku;
  if (!kkSku) {
    const { data: product, error: productErr } = await client
      .from("products")
      .select("code")
      .eq("id", kkProductId)
      .maybeSingle();
    if (productErr) throw new Error("database_error");
    kkSku = product?.code ?? null;
  }

  await client
    .from("amazon_listing_mappings")
    .update({ mapping_status: "legacy", updated_at: now })
    .eq("amazon_listing_id", listingId)
    .eq("mapping_status", "mapped");

  const { data: inserted, error: insertErr } = await client
    .from("amazon_listing_mappings")
    .insert({
      amazon_listing_id: listingId,
      kk_product_id: kkProductId,
      kk_variant_id: draft.kk_variant_id ?? null,
      kk_sku: kkSku,
      mapping_status: "mapped",
      mapping_confidence: "manual",
      mapped_by: adminUserId,
      mapped_at: now,
      notes: "Created from Amazon push draft verification",
      updated_at: now,
    })
    .select("id")
    .single();

  if (insertErr || !inserted?.id) throw new Error("database_error");
  return inserted.id as string;
}

export async function promoteDraftToPublished(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  listing: ListingRowForVerify,
  draft: DraftRowForVerify,
  adminUserId: string | null,
  now: string,
): Promise<{ mappingId: string | null }> {
  const mappingId = await ensureDraftMapping(client, listing.id, draft, adminUserId, now);

  const { error: updateErr } = await client
    .from("amazon_listing_drafts")
    .update({
      published_amazon_listing_id: listing.id,
      draft_status: "published",
      verify_status: "verified",
      verify_last_error: null,
      next_verify_after: null,
      updated_at: now,
    })
    .eq("id", draftId);

  if (updateErr) throw new Error("database_error");
  return { mappingId };
}
