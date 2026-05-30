// amazon-auth-import-self — Store SPP self-authorization refresh token (private apps).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeadersJson,
  json,
  requireAdminJson,
  VALID_REGIONS,
} from "../_shared/amazonAuthUtils.ts";

const LOG_PREFIX = "[amazon-auth-import-self]";
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

type ImportPayload = {
  sellerId?: unknown;
  refreshToken?: unknown;
  region?: unknown;
  marketplaceIds?: unknown;
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

async function verifyRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<boolean> {
  const resp = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!resp.ok) return false;
  try {
    const data = await resp.json() as { access_token?: string; error?: string };
    return Boolean(data.access_token && !data.error);
  } catch {
    return false;
  }
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
  const clientId = Deno.env.get("AMAZON_LWA_CLIENT_ID");
  const clientSecret = Deno.env.get("AMAZON_LWA_CLIENT_SECRET");
  const defaultRegion = (Deno.env.get("AMAZON_SP_API_REGION") || "na").toLowerCase();
  const defaultMarketplaceId = Deno.env.get("AMAZON_DEFAULT_MARKETPLACE_ID") || "ATVPDKIKX0DER";

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !clientId || !clientSecret) {
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

  let body: ImportPayload = {};
  try {
    body = (await req.json()) as ImportPayload;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const sellerId = typeof body.sellerId === "string" ? body.sellerId.trim() : "";
  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";

  if (!sellerId || sellerId.length < 3 || sellerId.length > 64) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  if (!refreshToken || refreshToken.length < 20) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const region = typeof body.region === "string" && body.region.trim()
    ? body.region.trim().toLowerCase()
    : defaultRegion;

  if (!VALID_REGIONS.has(region)) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const marketplaceIds = normalizeMarketplaceIds(body.marketplaceIds, defaultMarketplaceId);

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: marketplaces, error: marketplaceErr } = await serviceClient
    .from("amazon_marketplaces")
    .select("marketplace_id")
    .in("marketplace_id", marketplaceIds)
    .eq("region", region)
    .eq("is_enabled", true);

  if (marketplaceErr || !marketplaces || marketplaces.length !== marketplaceIds.length) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const tokenOk = await verifyRefreshToken(refreshToken, clientId, clientSecret);
  if (!tokenOk) {
    console.log(`${LOG_PREFIX} invalid_refresh_token`);
    return json({ ok: false, error: "invalid_refresh_token" }, 400);
  }

  const now = new Date().toISOString();
  const accountLabel = `Amazon ${region.toUpperCase()}`;

  const { data: account, error: accountErr } = await serviceClient
    .from("amazon_seller_accounts")
    .upsert(
      {
        seller_id: sellerId,
        account_label: accountLabel,
        region,
        marketplace_ids: marketplaceIds,
        is_active: true,
        authorized_at: now,
        last_token_refresh_at: now,
        token_status: "active",
        scopes_roles_snapshot: { source: "spp_self_authorization" },
        updated_at: now,
      },
      { onConflict: "seller_id" },
    )
    .select("id")
    .single();

  if (accountErr || !account?.id) {
    console.log(`${LOG_PREFIX} db_write_failed`);
    return json({ ok: false, error: "db_write_failed" }, 500);
  }

  const sellerAccountId = account.id as string;

  const { data: vaultName, error: vaultErr } = await serviceClient.rpc(
    "amazon_store_lwa_refresh_token",
    {
      p_seller_account_id: sellerAccountId,
      p_refresh_token: refreshToken,
    },
  );

  if (vaultErr || !vaultName || typeof vaultName !== "string") {
    console.log(`${LOG_PREFIX} vault_write_failed`);
    return json({ ok: false, error: "vault_write_failed" }, 500);
  }

  const { error: tokenRowErr } = await serviceClient
    .from("amazon_auth_tokens")
    .upsert(
      {
        seller_account_id: sellerAccountId,
        vault_secret_name: vaultName,
        lwa_refresh_token_encrypted: null,
        token_status: "active",
        last_refresh_at: now,
        last_error: null,
        updated_at: now,
      },
      { onConflict: "seller_account_id" },
    );

  if (tokenRowErr) {
    console.log(`${LOG_PREFIX} db_write_failed`);
    return json({ ok: false, error: "db_write_failed" }, 500);
  }

  console.log(`${LOG_PREFIX} success`);
  return json({ ok: true, sellerAccountId });
});
