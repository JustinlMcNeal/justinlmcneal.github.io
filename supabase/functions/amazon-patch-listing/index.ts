// amazon-patch-listing — Admin-only patchListingsItem for price/qty on existing listings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import {
  applyLocalListingPatchUpdate,
  buildListingPatchOperations,
  isFbaManagedListing,
  mapPatchIssues,
  patchListingsItemLiveUpdate,
  patchListingsItemValidationPreview,
  patchSubmissionAccepted,
  validateListingPatchInput,
} from "../_shared/amazonListingPatchUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import {
  readSyncEnvConfig,
  runSellerAccountSync,
} from "../_shared/amazonSyncAccountUtils.ts";

const LOG_PREFIX = "[amazon-patch-listing]";

type PatchPayload = {
  amazonListingId?: unknown;
  price?: unknown;
  quantity?: unknown;
  preview?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function parseOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const livePatchDisabled = Deno.env.get("AMAZON_ENABLE_LIVE_PATCH") !== "true";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const syncEnv = readSyncEnvConfig();

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey ||
    !syncEnv.lwaClientId || !syncEnv.lwaClientSecret) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const admin = await requireAdminJson(
    createClient,
    supabaseUrl,
    supabaseAnonKey,
    authHeader,
    LOG_PREFIX,
  );
  if (!admin.ok) return admin.response;

  let body: PatchPayload = {};
  try {
    body = (await req.json()) as PatchPayload;
  } catch {
    body = {};
  }

  const listingId = parseUuid(body.amazonListingId);
  if (!listingId) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const wantsPreview = body.preview === true;
  if (livePatchDisabled && !wantsPreview) {
    return json({ ok: false, error: "live_patch_disabled" }, 403);
  }

  const parsedPatch = validateListingPatchInput({
    price: parseOptionalNumber(body.price),
    quantity: parseOptionalNumber(body.quantity),
  });

  if (!parsedPatch.ok) {
    return json({ ok: false, error: parsedPatch.error }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  try {
    const { data: listing, error: listingErr } = await serviceClient
      .from("amazon_listings")
      .select([
        "id",
        "seller_account_id",
        "seller_id",
        "marketplace_id",
        "seller_sku",
        "product_type",
        "currency",
        "fulfillment_channel",
        "fba_fulfillable_quantity",
        "fbm_quantity",
      ].join(","))
      .eq("id", listingId)
      .maybeSingle();

    if (listingErr || !listing) {
      return json({ ok: false, error: "listing_not_found" }, 404);
    }

    const row = listing as Record<string, unknown>;
    const productType = String(row.product_type || "").trim();
    const sellerSku = String(row.seller_sku || "").trim();
    const marketplaceId = String(row.marketplace_id || "").trim();

    if (!productType || !sellerSku || !marketplaceId) {
      return json({ ok: false, error: "listing_not_patchable" }, 400);
    }

    if (parsedPatch.quantity !== undefined && isFbaManagedListing(row)) {
      return json({ ok: false, error: "fba_quantity_not_supported" }, 400);
    }

    const credsResult = await resolveAmazonCredentials(
      serviceClient,
      String(row.seller_account_id || ""),
      syncEnv,
    );
    if (!credsResult.ok) {
      return json({ ok: false, error: credsResult.error }, 400);
    }

    const patches = buildListingPatchOperations(
      marketplaceId,
      String(row.currency || "USD"),
      parsedPatch,
      String(row.fulfillment_channel || "DEFAULT") || "DEFAULT",
    );

    const patchParams = {
      creds: credsResult.creds,
      sellerId: credsResult.creds.account.seller_id,
      sellerSku,
      marketplaceId,
      productType,
      patches,
    };

    const patchResult = wantsPreview
      ? await patchListingsItemValidationPreview(patchParams)
      : await patchListingsItemLiveUpdate(patchParams);

    if (!patchResult.ok) {
      console.log(`${LOG_PREFIX} patch_failed error=${patchResult.error}`);
      return json({
        ok: false,
        error: patchResult.error,
        hint: patchResult.hint ?? null,
        preview: wantsPreview,
      }, patchResult.httpStatus && patchResult.httpStatus >= 400 ? patchResult.httpStatus : 502);
    }

    const amazonIssues = mapPatchIssues(patchResult.issues);
    const accepted = patchSubmissionAccepted(patchResult.submissionStatus);

    if (!accepted) {
      return json({
        ok: false,
        error: "patch_rejected",
        preview: wantsPreview,
        submissionStatus: patchResult.submissionStatus,
        issues: amazonIssues,
      }, 422);
    }

    if (wantsPreview) {
      return json({
        ok: true,
        preview: true,
        submissionStatus: patchResult.submissionStatus,
        submissionId: patchResult.submissionId,
        issues: amazonIssues,
        patch: parsedPatch,
      });
    }

    await applyLocalListingPatchUpdate(serviceClient, listingId, parsedPatch, now);

    try {
      await runSellerAccountSync({
        client: serviceClient,
        account: credsResult.creds.account,
        syncType: "single_sku",
        maxPages: 1,
        triggeredBy: admin.userId,
        sellerSku,
        marketplaceIds: [marketplaceId],
        env: syncEnv,
        now,
      });
    } catch {
      console.log(`${LOG_PREFIX} post_patch_sync_failed sku=${sellerSku}`);
    }

    console.log(`${LOG_PREFIX} success listingId=${listingId}`);
    return json({
      ok: true,
      preview: false,
      submissionStatus: patchResult.submissionStatus,
      submissionId: patchResult.submissionId,
      issues: amazonIssues,
      patch: parsedPatch,
      amazonListingId: listingId,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
