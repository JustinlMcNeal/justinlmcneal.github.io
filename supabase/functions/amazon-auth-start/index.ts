// amazon-auth-start — Begin Amazon LWA consent flow (admin-only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  consentBaseByRegion,
  corsHeadersJson,
  DEFAULT_ADMIN_PATH,
  json,
  requireAdminJson,
  sha256Hex,
  VALID_REGIONS,
  isSafeLocalPath,
} from "../_shared/amazonAuthUtils.ts";

const LOG_PREFIX = "[amazon-auth-start]";
const STATE_TTL_MS = 10 * 60 * 1000;

type StartPayload = {
  region?: string;
  marketplaceIds?: unknown;
  redirectAfter?: unknown;
};

function normalizeMarketplaceIds(raw: unknown, fallback: string): string[] {
  if (Array.isArray(raw)) {
    const ids = raw
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
    if (ids.length > 0) return ids;
  }
  return [fallback];
}

function resolveOauthVersion(raw: string | undefined | null): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "production" || v === "published" || v === "none" || v === "off") {
    return null;
  }
  if (v === "beta" || v === "draft") return "beta";
  return v;
}

function buildConsentUrl(
  region: string,
  appId: string,
  state: string,
  oauthVersion?: string | null,
): string {
  const base = consentBaseByRegion[region] ?? consentBaseByRegion.na;
  // Amazon docs: consent URI uses application_id + state (+ version=beta for Draft apps only).
  // redirect_uri is registered on the app; omit here to avoid MD1000 mismatches.
  const params = new URLSearchParams({
    application_id: appId,
    state,
  });
  if (oauthVersion) {
    params.set("version", oauthVersion);
  }
  return `${base}?${params.toString()}`;
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
  const appId = Deno.env.get("AMAZON_APP_ID");
  const redirectUri = Deno.env.get("AMAZON_AUTH_REDIRECT_URI");
  const defaultRegion = (Deno.env.get("AMAZON_SP_API_REGION") || "na").toLowerCase();
  const defaultMarketplaceId = Deno.env.get("AMAZON_DEFAULT_MARKETPLACE_ID") || "ATVPDKIKX0DER";
  const oauthVersion = resolveOauthVersion(Deno.env.get("AMAZON_OAUTH_VERSION") ?? "beta");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !appId || !redirectUri) {
    console.log(`${LOG_PREFIX} server_misconfigured`);
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    console.log(`${LOG_PREFIX} unauthorized`);
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

  let body: StartPayload = {};
  try {
    body = (await req.json()) as StartPayload;
  } catch {
    body = {};
  }

  const region = typeof body.region === "string" && body.region.trim()
    ? body.region.trim().toLowerCase()
    : defaultRegion;

  if (!VALID_REGIONS.has(region)) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const marketplaceIds = normalizeMarketplaceIds(body.marketplaceIds, defaultMarketplaceId);

  let redirectAfter = DEFAULT_ADMIN_PATH;
  if (body.redirectAfter !== undefined && body.redirectAfter !== null && body.redirectAfter !== "") {
    if (typeof body.redirectAfter !== "string" || !isSafeLocalPath(body.redirectAfter.trim())) {
      return json({ ok: false, error: "invalid_request" }, 400);
    }
    redirectAfter = body.redirectAfter.trim();
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: marketplaces, error: marketplaceErr } = await serviceClient
    .from("amazon_marketplaces")
    .select("marketplace_id")
    .in("marketplace_id", marketplaceIds)
    .eq("region", region)
    .eq("is_enabled", true);

  if (marketplaceErr) {
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }

  if (!marketplaces || marketplaces.length !== marketplaceIds.length) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const rawState = crypto.randomUUID();
  const stateHash = await sha256Hex(rawState);
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  const { error: insertErr } = await serviceClient.from("amazon_oauth_states").insert({
    state_hash: stateHash,
    created_by: admin.userId,
    region,
    marketplace_ids: marketplaceIds,
    redirect_after: redirectAfter,
    expires_at: expiresAt,
  });

  if (insertErr) {
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }

  const redirectUrl = buildConsentUrl(region, appId, rawState, oauthVersion);

  console.log(`${LOG_PREFIX} success`);
  return json({ ok: true, redirectUrl });
});
