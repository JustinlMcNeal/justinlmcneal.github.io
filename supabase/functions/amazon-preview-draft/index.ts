// amazon-preview-draft — Admin-only draft validation against PTD (no SP-API writes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import {
  computeMissingRequiredAttributes,
  resolveDraftStatus,
  syncValidationIssues,
  validateDraftAgainstPtd,
  validateLocalDraft,
} from "../_shared/amazonDraftValidationUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import { getOrFetchPtdSummary } from "../_shared/amazonPtdUtils.ts";

const LOG_PREFIX = "[amazon-preview-draft]";

type PreviewPayload = {
  draftId?: unknown;
  forceSchemaRefresh?: unknown;
  draftPayload?: unknown;
  marketplaceId?: unknown;
  productType?: unknown;
  sellerSku?: unknown;
  kkProductId?: unknown;
  requirements?: unknown;
  requirementsEnforced?: unknown;
  locale?: unknown;
  sellerAccountId?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function parseText(value: unknown, maxLen = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function asDraftPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
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

  let body: PreviewPayload = {};
  try {
    body = (await req.json()) as PreviewPayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const draftId = parseUuid(body.draftId);
  const forceSchemaRefresh = body.forceSchemaRefresh === true;
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  let sellerSku = "";
  let marketplaceId = "";
  let productType = "";
  let requirements = "LISTING";
  let requirementsEnforced = "ENFORCED";
  let locale = "en_US";
  let sellerAccountId: string | null = null;
  let draftPayload: Record<string, unknown> = {};
  let persistDraftId: string | null = draftId;

  try {
    if (draftId) {
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

      sellerSku = String(draft.seller_sku || "");
      marketplaceId = String(draft.marketplace_id || "");
      productType = String(draft.product_type || "");
      requirements = String(draft.requirements || "LISTING");
      requirementsEnforced = String(draft.requirements_enforced || "ENFORCED");
      sellerAccountId = typeof draft.seller_account_id === "string" ? draft.seller_account_id : null;
      draftPayload = asDraftPayload(draft.draft_payload);
    } else {
      marketplaceId = parseText(body.marketplaceId, 32) || "";
      productType = parseText(body.productType, 120) || "";
      sellerSku = parseText(body.sellerSku, 120) || "";
      draftPayload = asDraftPayload(body.draftPayload);
      sellerAccountId = body.sellerAccountId ? parseUuid(body.sellerAccountId) : null;
      requirements = typeof body.requirements === "string" ? body.requirements : "LISTING";
      requirementsEnforced = parseText(body.requirementsEnforced, 32) || "ENFORCED";
      locale = parseText(body.locale, 16) || "en_US";

      if (!marketplaceId || !productType || !parseUuid(body.kkProductId)) {
        return json({ ok: false, error: "invalid_request" }, 400);
      }
    }

    if (!productType.trim()) {
      return json({ ok: false, error: "invalid_request" }, 400);
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

    const { creds } = credResult;
    const ptdResult = await getOrFetchPtdSummary(
      serviceClient,
      creds,
      {
        sellerAccountId: creds.account.id,
        sellerId: creds.account.seller_id,
        marketplaceId,
        productType,
        requirements,
        requirementsEnforced,
        locale,
      },
      forceSchemaRefresh,
    );

    if (!ptdResult.ok) {
      const status = ptdResult.error === "database_error" ? 500 : 502;
      return json({ ok: false, error: ptdResult.error }, status);
    }

    const { summary } = ptdResult;
    const localIssues = validateLocalDraft(sellerSku, draftPayload, productType);
    const ptdIssues = validateDraftAgainstPtd(
      draftPayload,
      summary.requiredAttributes,
      summary.recommendedAttributes,
    );

    const validationErrors = [...localIssues, ...ptdIssues];
    const draftStatus = resolveDraftStatus(validationErrors);
    const missingRequiredAttributes = computeMissingRequiredAttributes(
      draftPayload,
      summary.requiredAttributes,
    );

    const lastValidationResult = {
      previewedAt: now,
      source: ptdResult.source,
      productType: summary.productType,
      productTypeVersion: summary.productTypeVersion,
      requiredAttributes: summary.requiredAttributes,
      recommendedAttributes: summary.recommendedAttributes,
      missingRequiredAttributes,
      validationErrors,
    };

    if (persistDraftId) {
      const { error: updateErr } = await serviceClient
        .from("amazon_listing_drafts")
        .update({
          validation_errors: validationErrors,
          last_validation_result: lastValidationResult,
          last_previewed_at: now,
          draft_status: draftStatus,
          product_type_version: summary.productTypeVersion,
          updated_at: now,
        })
        .eq("id", persistDraftId);

      if (updateErr) {
        return json({ ok: false, error: "database_error" }, 500);
      }

      await syncValidationIssues(serviceClient, persistDraftId, validationErrors, now);
    }

    console.log(`${LOG_PREFIX} success draftId=${persistDraftId || "inline"} status=${draftStatus}`);
    return json({
      ok: true,
      draftId: persistDraftId,
      draftStatus,
      validationErrors,
      requiredAttributes: summary.requiredAttributes,
      missingRequiredAttributes,
      productTypeVersion: summary.productTypeVersion,
      schemaSource: ptdResult.source,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
