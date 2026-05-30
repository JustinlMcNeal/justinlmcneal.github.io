// amazon-verify-submitted-draft — Admin read-only verification + published reconciliation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import {
  asDraftRowForVerify,
  verifySubmittedDraftOnce,
} from "../_shared/amazonDraftVerifyUtils.ts";
import { markManualVerifyNotFound } from "../_shared/amazonDraftVerifyQueueUtils.ts";

const LOG_PREFIX = "[amazon-verify-submitted-draft]";

type VerifyPayload = {
  draftId?: unknown;
  runSingleSkuSync?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
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

  let body: VerifyPayload = {};
  try {
    body = (await req.json()) as VerifyPayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const draftId = parseUuid(body.draftId);
  const runSingleSkuSync = body.runSingleSkuSync !== false;

  if (!draftId) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();
  const syncEnv = {
    lwaClientId,
    lwaClientSecret,
    spApiEndpointOverride,
    awsAccessKeyId,
    awsSecretAccessKey,
    awsSessionToken,
    awsRegionOverride,
    allowUnsignedSpApi,
  };

  try {
    const { data: draftRaw, error: draftErr } = await serviceClient
      .from("amazon_listing_drafts")
      .select("*")
      .eq("id", draftId)
      .maybeSingle();

    if (draftErr) {
      return json({ ok: false, error: "database_error" }, 500);
    }
    if (!draftRaw) {
      return json({ ok: false, error: "draft_not_found" }, 404);
    }

    const draft = asDraftRowForVerify(draftRaw as Record<string, unknown>);

    if (draft.draft_status !== "submitted") {
      return json({ ok: false, error: "draft_not_submitted" }, 400);
    }

    const result = await verifySubmittedDraftOnce(
      serviceClient,
      draft,
      admin.userId,
      syncEnv,
      { runSingleSkuSync },
    );

    if (result.status === "error") {
      const status = result.error === "database_error" ? 500
        : result.error === "sync_failed" ? 502
        : 400;
      const code = result.error === "token_refresh_failed" ? 502 : result.error;
      return json({ ok: false, error: code }, status);
    }

    if (result.status === "not_found") {
      await markManualVerifyNotFound(serviceClient, draftId, now);
      console.log(`${LOG_PREFIX} not_found draftId=${draftId}`);
      return json({
        ok: true,
        verified: false,
        draftStatus: "submitted",
        reason: "listing_not_found_yet",
      });
    }

    console.log(`${LOG_PREFIX} verified draftId=${draftId} listingId=${result.listing.id}`);
    return json({
      ok: true,
      verified: true,
      draftStatus: "published",
      amazonListingId: result.listing.id,
      listingStatus: result.listing.listing_status,
      listingStatusBuyable: result.listing.listing_status_buyable,
      mappingId: result.mappingId,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
