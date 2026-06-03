// amazon-submit-draft — Admin-only live Amazon Listings Items PUT submit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeadersJson,
  isParentVariationDraftRow,
  json,
  requireAdminJson,
  UUID_RE,
} from "../_shared/amazonAuthUtils.ts";
import {
  buildListingsItemRequestBody,
  evaluateDraftLiveSubmitReadiness,
  mapAmazonListingIssues,
  putListingsItemLiveSubmit,
  resolveDraftStatusAfterLiveSubmit,
  syncPushIssues,
} from "../_shared/amazonListingPayloadUtils.ts";
import { queueDraftForVerification } from "../_shared/amazonDraftVerifyQueueUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";

const LOG_PREFIX = "[amazon-submit-draft]";
const CONFIRMATION_PHRASE = "PUBLISH_TO_AMAZON";

type LiveSubmitPayload = {
  draftId?: unknown;
  confirmation?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function asDraftPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function loadOpenErrorIssues(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
): Promise<Array<{ source: string; severity: string }>> {
  const { data, error } = await client
    .from("amazon_listing_issues")
    .select("source, severity")
    .eq("draft_id", draftId)
    .eq("status", "open")
    .eq("severity", "error");

  if (error) throw new Error("database_error");
  return (data || []).map((row: { source?: string; severity?: string }) => ({
    source: String(row.source || ""),
    severity: String(row.severity || ""),
  }));
}

const PARENT_DRAFT_SELECT =
  "id, kk_product_id, draft_status, submission_status, published_amazon_listing_id, variation_role, seller_sku";

function isParentSubmissionReady(parentDraft: Record<string, unknown>): boolean {
  const status = String(parentDraft.draft_status || "");
  const submissionStatus = String(parentDraft.submission_status || "").toUpperCase();
  if (status === "published" || parentDraft.published_amazon_listing_id) return true;
  if (status === "submitted") {
    return submissionStatus === "ACCEPTED"
      || submissionStatus === "VALID"
      || submissionStatus === "";
  }
  if (!["submitted", "published"].includes(status)) return false;
  return submissionStatus === "ACCEPTED" || submissionStatus === "VALID";
}

async function fetchParentDraftForChild(
  // deno-lint-ignore no-explicit-any
  client: any,
  draft: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const parentDraftId = typeof draft.parent_draft_id === "string" ? draft.parent_draft_id : null;
  const parentSellerSku = typeof draft.parent_seller_sku === "string"
    ? draft.parent_seller_sku.trim()
    : "";
  const kkProductId = String(draft.kk_product_id || "");

  if (parentDraftId) {
    const { data, error } = await client
      .from("amazon_listing_drafts")
      .select(PARENT_DRAFT_SELECT)
      .eq("id", parentDraftId)
      .maybeSingle();
    if (error) throw new Error("database_error");
    if (
      data
      && String(data.kk_product_id) === kkProductId
      && isParentVariationDraftRow(data)
    ) {
      return data as Record<string, unknown>;
    }
  }

  if (!parentSellerSku || !kkProductId) return null;

  const { data, error } = await client
    .from("amazon_listing_drafts")
    .select(PARENT_DRAFT_SELECT)
    .eq("kk_product_id", kkProductId)
    .eq("seller_sku", parentSellerSku)
    .neq("draft_status", "archived")
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) throw new Error("database_error");

  for (const row of data || []) {
    if (isParentVariationDraftRow(row)) {
      return row as Record<string, unknown>;
    }
  }

  return await fetchParentShellFromSyncedListing(client, draft, parentSellerSku);
}

/** Parent draft deleted locally but KK-XXXX-PARENT still on Amazon after sync. */
async function fetchParentShellFromSyncedListing(
  // deno-lint-ignore no-explicit-any
  client: any,
  draft: Record<string, unknown>,
  parentSellerSku: string,
): Promise<Record<string, unknown> | null> {
  const marketplaceId = String(draft.marketplace_id || "").trim();
  const sku = String(parentSellerSku || "").trim().toUpperCase();
  if (!marketplaceId || !sku.endsWith("-PARENT")) return null;

  const { data: listing, error } = await client
    .from("amazon_listings")
    .select("id, seller_sku, asin, marketplace_id, listing_status")
    .eq("seller_sku", parentSellerSku)
    .eq("marketplace_id", marketplaceId)
    .maybeSingle();

  if (error || !listing) return null;

  const asin = String(listing.asin || "").trim();
  if (!asin) return null;

  console.log(
    `${LOG_PREFIX} parent_shell_from_listing sku=${parentSellerSku} asin=${asin}`,
  );

  return {
    id: null,
    kk_product_id: draft.kk_product_id,
    draft_status: "submitted",
    submission_status: "ACCEPTED",
    published_amazon_listing_id: listing.id,
    variation_role: "parent",
    seller_sku: parentSellerSku,
  };
}

async function assertChildVariationParentReady(
  // deno-lint-ignore no-explicit-any
  client: any,
  draft: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const role = String(draft.variation_role || "").trim().toLowerCase();
  const payload = draft.draft_payload && typeof draft.draft_payload === "object"
    ? draft.draft_payload as Record<string, unknown>
    : {};
  const parentage = String(payload.parentage_level || "").trim().toLowerCase();
  const isChild = role === "child" || parentage === "child";
  if (!isChild) return { ok: true };

  const parentDraft = await fetchParentDraftForChild(client, draft);
  if (!parentDraft) {
    return { ok: false, error: "parent_draft_not_found" };
  }
  if (!isParentSubmissionReady(parentDraft)) {
    return { ok: false, error: "parent_draft_not_ready" };
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  if (Deno.env.get("AMAZON_ENABLE_LIVE_SUBMIT") !== "true") {
    console.log(`${LOG_PREFIX} live_submit_disabled`);
    return json({ ok: false, error: "live_submit_disabled" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const lwaClientId = Deno.env.get("AMAZON_LWA_CLIENT_ID");
  const lwaClientSecret = Deno.env.get("AMAZON_LWA_CLIENT_SECRET");
  const spApiEndpointOverride = Deno.env.get("AMAZON_SP_API_ENDPOINT") || null;
  const awsAccessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const awsSecretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const awsSessionToken = Deno.env.get("AWS_SESSION_TOKEN") || null;
  const awsRegionOverride = Deno.env.get("AWS_REGION") || null;
  const allowUnsignedSpApi = Deno.env.get("AMAZON_ALLOW_UNSIGNED_SP_API") === "true";

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !lwaClientId || !lwaClientSecret) {
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

  let body: LiveSubmitPayload = {};
  try {
    body = (await req.json()) as LiveSubmitPayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const draftId = parseUuid(body.draftId);
  const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";

  if (!draftId) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  if (confirmation !== CONFIRMATION_PHRASE) {
    return json({ ok: false, error: "confirmation_required" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  try {
    const { data: draft, error: draftErr } = await serviceClient
      .from("amazon_listing_drafts")
      .select("*")
      .eq("id", draftId)
      .maybeSingle();

    if (draftErr) {
      return json({ ok: false, error: "database_error" }, 500);
    }
    if (!draft) {
      return json({ ok: false, error: "draft_not_found" }, 404);
    }

    if (draft.draft_status === "published" || draft.draft_status === "archived") {
      return json({ ok: false, error: "invalid_request" }, 400);
    }

    const parentReady = await assertChildVariationParentReady(
      serviceClient,
      draft as Record<string, unknown>,
    );
    if (!parentReady.ok) {
      return json({ ok: false, error: parentReady.error }, 400);
    }

    const openIssues = await loadOpenErrorIssues(serviceClient, draftId);
    const readiness = evaluateDraftLiveSubmitReadiness(
      draft as Record<string, unknown>,
      openIssues,
    );
    if (!readiness.ready) {
      return json({ ok: false, error: "draft_not_ready", reasons: readiness.reasons }, 400);
    }

    const sellerSku = String(draft.seller_sku || "").trim();
    const marketplaceId = String(draft.marketplace_id || "").trim();
    const draftPayload = asDraftPayload(draft.draft_payload);
    const sellerAccountId = typeof draft.seller_account_id === "string"
      ? draft.seller_account_id
      : null;

    if (!sellerSku || !marketplaceId) {
      return json({ ok: false, error: "draft_not_ready" }, 400);
    }

    const payloadResult = buildListingsItemRequestBody({
      seller_sku: draft.seller_sku,
      marketplace_id: draft.marketplace_id,
      product_type: draft.product_type,
      requirements: draft.requirements,
      matched_asin: draft.matched_asin,
      asin: draft.asin,
      draft_payload: draftPayload,
    });

    if (!payloadResult.ok) {
      return json({ ok: false, error: payloadResult.error }, 400);
    }

    const credResult = await resolveAmazonCredentials(serviceClient, sellerAccountId, {
      lwaClientId,
      lwaClientSecret,
      spApiEndpointOverride,
      awsAccessKeyId,
      awsSecretAccessKey,
      awsSessionToken,
      awsRegionOverride,
      allowUnsignedSpApi,
    });

    if (!credResult.ok) {
      const status = credResult.error === "server_misconfigured" ? 500 : 400;
      const code = credResult.error === "token_refresh_failed" ? 502 : credResult.error;
      return json({ ok: false, error: code }, status);
    }

    const sellerId = String(draft.seller_id || credResult.creds.account.seller_id || "").trim();
    if (!sellerId) {
      return json({ ok: false, error: "amazon_not_connected" }, 400);
    }

    const submitResult = await putListingsItemLiveSubmit({
      creds: credResult.creds,
      sellerId,
      sellerSku,
      marketplaceId,
      body: payloadResult.body,
    });

    if (!submitResult.ok) {
      const status = submitResult.error === "server_misconfigured" ? 500 : 502;
      return json({ ok: false, error: submitResult.error }, status);
    }

    const amazonIssues = mapAmazonListingIssues(
      submitResult.issues,
      "Amazon reported an issue during live submit.",
    );
    const draftStatus = resolveDraftStatusAfterLiveSubmit({
      submissionStatus: submitResult.submissionStatus,
      amazonIssues,
    });

    const lastSubmissionResponse = {
      mode: "LIVE_SUBMIT",
      httpStatus: submitResult.httpStatus,
      submissionId: submitResult.submissionId,
      status: submitResult.submissionStatus,
      issueCount: submitResult.issues.length,
      requestBody: payloadResult.body,
      response: {
        status: submitResult.rawResponse.status ?? null,
        submissionId: submitResult.submissionId,
        issueCount: submitResult.issues.length,
      },
    };

    const lastValidationResult = {
      ...(typeof draft.last_validation_result === "object" && draft.last_validation_result
        ? draft.last_validation_result as Record<string, unknown>
        : {}),
      liveSubmittedAt: now,
      submissionId: submitResult.submissionId,
      submissionStatus: submitResult.submissionStatus,
      amazonIssues,
    };

    const updateRow: Record<string, unknown> = {
      submission_id: submitResult.submissionId,
      submission_status: submitResult.submissionStatus,
      last_submission_response: lastSubmissionResponse,
      last_validation_result: lastValidationResult,
      last_previewed_at: now,
      draft_status: draftStatus,
      updated_at: now,
    };

    if (draftStatus === "submitted") {
      updateRow.submitted_at = now;
    }

    const { error: updateErr } = await serviceClient
      .from("amazon_listing_drafts")
      .update(updateRow)
      .eq("id", draftId);

    if (updateErr) {
      return json({ ok: false, error: "database_error" }, 500);
    }

    if (draftStatus === "submitted") {
      try {
        await queueDraftForVerification(serviceClient, draftId, now);
      } catch {
        console.log(`${LOG_PREFIX} verify_queue_failed draftId=${draftId}`);
      }
    }

    await syncPushIssues(
      serviceClient,
      draftId,
      amazonIssues,
      submitResult.submissionId,
      now,
      "amazon_submit",
    );

    if (draftStatus !== "submitted") {
      console.log(`${LOG_PREFIX} rejected draftId=${draftId} status=${submitResult.submissionStatus}`);
      return json({
        ok: false,
        error: "sp_api_submit_failed",
        draftId,
        submissionId: submitResult.submissionId,
        submissionStatus: submitResult.submissionStatus,
        draftStatus,
        amazonIssues,
      }, 400);
    }

    console.log(`${LOG_PREFIX} success draftId=${draftId} submissionId=${submitResult.submissionId}`);
    return json({
      ok: true,
      draftId,
      submissionId: submitResult.submissionId,
      submissionStatus: submitResult.submissionStatus,
      draftStatus,
      amazonIssues,
      needsSync: true,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
