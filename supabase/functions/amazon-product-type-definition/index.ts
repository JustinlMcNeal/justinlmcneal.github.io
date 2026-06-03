// amazon-product-type-definition — Admin-only PTD fetch/cache (read-only SP-API).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import { readSyncEnvConfig } from "../_shared/amazonSyncAccountUtils.ts";
import {
  getOrFetchPtdSummary,
  toPublicPtdResponse,
} from "../_shared/amazonPtdUtils.ts";

const LOG_PREFIX = "[amazon-product-type-definition]";

const VALID_REQUIREMENTS = new Set(["LISTING", "LISTING_PRODUCT_ONLY", "LISTING_OFFER_ONLY"]);

type PtdPayload = {
  sellerAccountId?: unknown;
  marketplaceId?: unknown;
  productType?: unknown;
  requirements?: unknown;
  requirementsEnforced?: unknown;
  locale?: unknown;
  forceRefresh?: unknown;
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
  const syncEnv = readSyncEnvConfig();

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !syncEnv.lwaClientId || !syncEnv.lwaClientSecret) {
    console.log(`${LOG_PREFIX} server_misconfigured`);
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

  let body: PtdPayload = {};
  try {
    body = (await req.json()) as PtdPayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const sellerAccountId = body.sellerAccountId ? parseUuid(body.sellerAccountId) : null;
  const marketplaceId = parseText(body.marketplaceId, 32);
  const productType = parseText(body.productType, 120);
  const requirements = typeof body.requirements === "string" &&
      VALID_REQUIREMENTS.has(body.requirements)
    ? body.requirements
    : "LISTING";
  const requirementsEnforced = parseText(body.requirementsEnforced, 32) || "ENFORCED";
  const locale = parseText(body.locale, 16) || "en_US";
  const forceRefresh = body.forceRefresh === true;

  if (!marketplaceId || !productType) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: marketplace, error: marketplaceErr } = await serviceClient
      .from("amazon_marketplaces")
      .select("marketplace_id")
      .eq("marketplace_id", marketplaceId)
      .eq("is_enabled", true)
      .maybeSingle();

    if (marketplaceErr) {
      console.log(`${LOG_PREFIX} database_error`);
      return json({ ok: false, error: "database_error" }, 500);
    }
    if (!marketplace) {
      return json({ ok: false, error: "invalid_request" }, 404);
    }

    const credResult = await resolveAmazonCredentials(serviceClient, sellerAccountId, syncEnv);

    if (!credResult.ok) {
      const status = credResult.error === "server_misconfigured" ? 500
        : credResult.error === "token_refresh_failed" ? 502
        : credResult.error === "aws_assume_role_failed" ? 502
        : 400;
      return json({ ok: false, error: credResult.error }, status);
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
      forceRefresh,
    );

    if (!ptdResult.ok) {
      const status = ptdResult.error === "database_error" ? 500
        : ptdResult.error === "invalid_product_type" ? 400
        : ptdResult.error === "invalid_request" ? 400
        : 502;
      return json({
        ok: false,
        error: ptdResult.error,
        hint: ptdResult.hint ?? null,
        httpStatus: ptdResult.httpStatus ?? null,
      }, status);
    }

    console.log(`${LOG_PREFIX} success source=${ptdResult.source} productType=${productType}`);
    return json(toPublicPtdResponse(ptdResult.summary, ptdResult.source));
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    const message = err instanceof Error ? err.message : "unexpected_error";
    console.log(`${LOG_PREFIX} unhandled`, message);
    return json({ ok: false, error: "unexpected_error", hint: message.slice(0, 200) }, 500);
  }
});
