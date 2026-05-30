// amazon-submit-draft-preview — Admin-only Amazon VALIDATION_PREVIEW submit (no live publish).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import {
  validateDraftAgainstPtd,
  validateLocalDraft,
  type ValidationIssue,
} from "../_shared/amazonDraftValidationUtils.ts";
import {
  buildListingsItemRequestBody,
  mapAmazonListingIssues,
  putListingsItemValidationPreview,
  resolveDraftStatusAfterAmazonPreview,
  syncPushIssues,
} from "../_shared/amazonListingPayloadUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import { getOrFetchPtdSummary } from "../_shared/amazonPtdUtils.ts";

const LOG_PREFIX = "[amazon-submit-draft-preview]";

type SubmitPreviewPayload = {
  draftId?: unknown;
  forceLocalPreview?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function asDraftPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asValidationIssues(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ValidationIssue => {
    return !!entry &&
      typeof entry === "object" &&
      typeof entry.field === "string" &&
      (entry.severity === "error" || entry.severity === "warning") &&
      typeof entry.message === "string";
  });
}

function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  if (Deno.env.get("AMAZON_ENABLE_VALIDATION_PREVIEW") !== "true") {
    console.log(`${LOG_PREFIX} validation_preview_disabled`);
    return json({ ok: false, error: "validation_preview_disabled" }, 403);
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

  let body: SubmitPreviewPayload = {};
  try {
    body = (await req.json()) as SubmitPreviewPayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const draftId = parseUuid(body.draftId);
  const forceLocalPreview = body.forceLocalPreview !== false;
  if (!draftId) {
    return json({ ok: false, error: "invalid_request" }, 400);
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

    const sellerSku = String(draft.seller_sku || "").trim();
    const marketplaceId = String(draft.marketplace_id || "").trim();
    const productType = String(draft.product_type || "").trim();
    const requirements = String(draft.requirements || "LISTING");
    const requirementsEnforced = String(draft.requirements_enforced || "ENFORCED");
    const draftPayload = asDraftPayload(draft.draft_payload);
    const sellerAccountId = typeof draft.seller_account_id === "string"
      ? draft.seller_account_id
      : null;

    if (!sellerSku || !marketplaceId || !productType) {
      return json({ ok: false, error: "draft_not_ready" }, 400);
    }

    let localIssues = validateLocalDraft(sellerSku, draftPayload, productType);
    let ptdIssues: ValidationIssue[] = [];

    if (forceLocalPreview) {
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

      const ptdResult = await getOrFetchPtdSummary(
        serviceClient,
        credResult.creds,
        {
          sellerAccountId: credResult.creds.account.id,
          sellerId: credResult.creds.account.seller_id,
          marketplaceId,
          productType,
          requirements,
          requirementsEnforced,
          locale: "en_US",
        },
        false,
      );

      if (!ptdResult.ok) {
        const status = ptdResult.error === "database_error" ? 500 : 502;
        return json({ ok: false, error: ptdResult.error }, status);
      }

      ptdIssues = validateDraftAgainstPtd(
        draftPayload,
        ptdResult.summary.requiredAttributes,
        ptdResult.summary.recommendedAttributes,
      );
    } else {
      ptdIssues = asValidationIssues(draft.validation_errors).filter((issue) =>
        issue.message.includes("required by Amazon") ||
        issue.message.includes("recommended for this product type")
      );
    }

    const preflightIssues = [...localIssues, ...ptdIssues];
    if (hasBlockingErrors(preflightIssues)) {
      return json({ ok: false, error: "draft_not_ready", validationErrors: preflightIssues }, 400);
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

    const previewResult = await putListingsItemValidationPreview({
      creds: credResult.creds,
      sellerId,
      sellerSku,
      marketplaceId,
      body: payloadResult.body,
    });

    if (!previewResult.ok) {
      const status = previewResult.error === "server_misconfigured" ? 500 : 502;
      return json({ ok: false, error: previewResult.error }, status);
    }

    const amazonIssues = mapAmazonListingIssues(previewResult.issues);
    const validationErrors = [...preflightIssues, ...amazonIssues];
    const draftStatus = resolveDraftStatusAfterAmazonPreview({
      submissionStatus: previewResult.submissionStatus,
      amazonIssues,
      localIssues: preflightIssues,
    });

    const lastValidationResult = {
      ...(typeof draft.last_validation_result === "object" && draft.last_validation_result
        ? draft.last_validation_result as Record<string, unknown>
        : {}),
      previewedAt: now,
      amazonPreviewAt: now,
      submissionId: previewResult.submissionId,
      submissionStatus: previewResult.submissionStatus,
      amazonIssues,
      validationErrors,
    };

    const lastSubmissionResponse = {
      mode: "VALIDATION_PREVIEW",
      httpStatus: previewResult.httpStatus,
      submissionId: previewResult.submissionId,
      status: previewResult.submissionStatus,
      issueCount: previewResult.issues.length,
      requestBody: payloadResult.body,
      response: {
        status: previewResult.rawResponse.status ?? null,
        submissionId: previewResult.submissionId,
        issueCount: previewResult.issues.length,
      },
    };

    const { error: updateErr } = await serviceClient
      .from("amazon_listing_drafts")
      .update({
        submission_id: previewResult.submissionId,
        submission_status: previewResult.submissionStatus,
        last_submission_response: lastSubmissionResponse,
        last_validation_result: lastValidationResult,
        validation_errors: validationErrors,
        last_previewed_at: now,
        draft_status: draftStatus,
        updated_at: now,
      })
      .eq("id", draftId);

    if (updateErr) {
      return json({ ok: false, error: "database_error" }, 500);
    }

    await syncPushIssues(
      serviceClient,
      draftId,
      amazonIssues,
      previewResult.submissionId,
      now,
    );

    console.log(
      `${LOG_PREFIX} success draftId=${draftId} status=${previewResult.submissionStatus} draftStatus=${draftStatus}`,
    );

    return json({
      ok: true,
      draftId,
      submissionId: previewResult.submissionId,
      submissionStatus: previewResult.submissionStatus,
      draftStatus,
      amazonIssues,
      validationErrors,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
