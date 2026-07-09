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
  enrichDraftPayloadFromRow,
  mapAmazonListingIssues,
  normalizeSubmissionStatus,
  putListingsItemValidationPreview,
  resolveDraftStatusAfterAmazonPreview,
  resolveListingsItemBuildContext,
  syncPushIssues,
} from "../_shared/amazonListingPayloadUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import { getOrFetchPtdSummary, extractRequiredAttributes } from "../_shared/amazonPtdUtils.ts";
import { readSyncEnvConfig } from "../_shared/amazonSyncAccountUtils.ts";

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
  const syncEnv = readSyncEnvConfig();

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !syncEnv.lwaClientId || !syncEnv.lwaClientSecret) {
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
    const draftPayload = enrichDraftPayloadFromRow({
      seller_sku: draft.seller_sku,
      marketplace_id: draft.marketplace_id,
      product_type: draft.product_type,
      requirements: draft.requirements,
      matched_asin: draft.matched_asin,
      asin: draft.asin,
      draft_payload: asDraftPayload(draft.draft_payload),
      variation_role: typeof draft.variation_role === "string" ? draft.variation_role : null,
      parent_seller_sku: typeof draft.parent_seller_sku === "string" ? draft.parent_seller_sku : null,
      variation_theme: typeof draft.variation_theme === "string" ? draft.variation_theme : null,
      parentage_level: typeof draft.parentage_level === "string" ? draft.parentage_level : null,
    });
    const sellerAccountId = typeof draft.seller_account_id === "string"
      ? draft.seller_account_id
      : null;

    const buildContext = resolveListingsItemBuildContext({
      seller_sku: draft.seller_sku,
      marketplace_id: draft.marketplace_id,
      product_type: draft.product_type,
      requirements: draft.requirements,
      matched_asin: draft.matched_asin,
      asin: draft.asin,
      draft_payload: draftPayload,
      variation_role: typeof draft.variation_role === "string" ? draft.variation_role : null,
      parent_seller_sku: typeof draft.parent_seller_sku === "string" ? draft.parent_seller_sku : null,
      variation_theme: typeof draft.variation_theme === "string" ? draft.variation_theme : null,
      parentage_level: typeof draft.parentage_level === "string" ? draft.parentage_level : null,
    });
    if (!buildContext.ok) {
      return json({ ok: false, error: buildContext.error }, 400);
    }

    if (!sellerSku || !marketplaceId || !productType) {
      return json({ ok: false, error: "draft_not_ready" }, 400);
    }

    const ptdProductType = buildContext.context.mode === "offer_only"
      ? buildContext.context.productType
      : productType;
    const ptdRequirements = buildContext.context.requirements;

    const variationRole = typeof draft.variation_role === "string" ? draft.variation_role : null;
    const validationOptions = { variationRole };

    let localIssues = validateLocalDraft(
      sellerSku,
      draftPayload,
      productType,
      validationOptions,
    );

    if (variationRole === "child") {
      const parentSku = typeof draft.parent_seller_sku === "string"
        ? draft.parent_seller_sku.trim()
        : "";
      if (parentSku) {
        const { data: parentDraft } = await serviceClient
          .from("amazon_listing_drafts")
          .select("product_type")
          .eq("seller_sku", parentSku)
          .eq("variation_role", "parent")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const parentType = typeof parentDraft?.product_type === "string"
          ? parentDraft.product_type.trim()
          : "";
        if (parentType && productType && parentType.toUpperCase() !== productType.toUpperCase()) {
          localIssues.push({
            field: "productType",
            severity: "error",
            message: `Child product type must match parent (${parentType}). Change ACCESSORY or other types to ${parentType}.`,
          });
        }
      }
    }

    let ptdIssues: ValidationIssue[] = [];

    if (forceLocalPreview && buildContext.context.mode !== "offer_only") {
      const credResult = await resolveAmazonCredentials(serviceClient, sellerAccountId, syncEnv);

      if (!credResult.ok) {
        const status = credResult.error === "server_misconfigured" ? 500
          : credResult.error === "token_refresh_failed" ? 502
          : credResult.error === "aws_assume_role_failed" ? 502
          : 400;
        return json({ ok: false, error: credResult.error }, status);
      }

      const ptdResult = await getOrFetchPtdSummary(
        serviceClient,
        credResult.creds,
        {
          sellerAccountId: credResult.creds.account.id,
          sellerId: credResult.creds.account.seller_id,
          marketplaceId,
          productType: ptdProductType,
          requirements: ptdRequirements,
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
        validationOptions,
      );
    } else if (forceLocalPreview && buildContext.context.mode === "offer_only") {
      ptdIssues = validateDraftAgainstPtd(
        {
          ...draftPayload,
          merchant_suggested_asin: draftPayload.merchant_suggested_asin ||
            draft.matched_asin ||
            draft.asin,
        },
        extractRequiredAttributes({}, "LISTING_OFFER_ONLY"),
        [],
        validationOptions,
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
      variation_role: typeof draft.variation_role === "string" ? draft.variation_role : null,
      parent_seller_sku: typeof draft.parent_seller_sku === "string" ? draft.parent_seller_sku : null,
      variation_theme: typeof draft.variation_theme === "string" ? draft.variation_theme : null,
      parentage_level: typeof draft.parentage_level === "string" ? draft.parentage_level : null,
    });

    if (!payloadResult.ok) {
      return json({ ok: false, error: payloadResult.error }, 400);
    }

    const credResult = await resolveAmazonCredentials(serviceClient, sellerAccountId, syncEnv);

    if (!credResult.ok) {
      const status = credResult.error === "server_misconfigured" ? 500
        : credResult.error === "token_refresh_failed" ? 502
        : credResult.error === "aws_assume_role_failed" ? 502
        : 400;
      return json({ ok: false, error: credResult.error }, status);
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
      return json({
        ok: false,
        error: previewResult.error,
        hint: previewResult.hint ?? null,
        httpStatus: previewResult.httpStatus ?? null,
      }, status);
    }

    const normalizedSubmissionStatus = normalizeSubmissionStatus(previewResult.submissionStatus);

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
      productType,
      submissionId: previewResult.submissionId,
      submissionStatus: normalizedSubmissionStatus,
      lastAmazonPreviewStatus: normalizedSubmissionStatus,
      amazonIssues,
      validationErrors,
    };

    const lastSubmissionResponse = {
      mode: "VALIDATION_PREVIEW",
      httpStatus: previewResult.httpStatus,
      submissionId: previewResult.submissionId,
      status: normalizedSubmissionStatus,
      rawStatus: previewResult.submissionStatus,
      issueCount: previewResult.issues.length,
      requestBody: payloadResult.body,
      response: {
        status: previewResult.rawResponse.status ?? null,
        submissionId: previewResult.submissionId,
        issueCount: previewResult.issues.length,
        issues: previewResult.issues,
      },
    };

    const { error: updateErr } = await serviceClient
      .from("amazon_listing_drafts")
      .update({
        submission_id: previewResult.submissionId,
        submission_status: normalizedSubmissionStatus,
        last_submission_response: lastSubmissionResponse,
        last_validation_result: lastValidationResult,
        validation_errors: validationErrors,
        last_previewed_at: now,
        draft_status: draftStatus,
        updated_at: now,
      })
      .eq("id", draftId);

    if (updateErr) {
      console.log(`${LOG_PREFIX} draft_update_failed`, updateErr.message);
      return json({ ok: false, error: "database_error", hint: updateErr.message.slice(0, 240) }, 500);
    }

    try {
      await syncPushIssues(
        serviceClient,
        draftId,
        amazonIssues,
        previewResult.submissionId,
        now,
      );
    } catch (syncErr: unknown) {
      const message = syncErr instanceof Error ? syncErr.message : "sync_push_issues_failed";
      console.log(`${LOG_PREFIX} sync_push_issues_failed`, message);
      return json({ ok: false, error: "sync_push_issues_failed", hint: message }, 500);
    }

    console.log(
      `${LOG_PREFIX} success draftId=${draftId} status=${previewResult.submissionStatus} draftStatus=${draftStatus}`,
    );

    return json({
      ok: true,
      draftId,
      submissionId: previewResult.submissionId,
      submissionStatus: normalizedSubmissionStatus,
      draftStatus,
      amazonIssues,
      validationErrors,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`${LOG_PREFIX} unhandled`, message);
    return json({ ok: false, error: "unexpected_error", hint: message.slice(0, 240) }, 500);
  }
});
