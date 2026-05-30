// amazon-auth-callback — Amazon LWA OAuth redirect handler (state-validated, no JWT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeadersJson,
  DEFAULT_ADMIN_PATH,
  redirectToAdmin,
  sha256Hex,
  VALID_REGIONS,
} from "../_shared/amazonAuthUtils.ts";

const LOG_PREFIX = "[amazon-auth-callback]";
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

type OAuthStateRow = {
  id: string;
  region: string;
  marketplace_ids: string[] | null;
  redirect_after: string | null;
  expires_at: string;
  used_at: string | null;
};

type LwaTokenResponse = {
  refresh_token?: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function exchangeAuthorizationCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ ok: true; refreshToken: string } | { ok: false; reason: string }> {
  const resp = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  let tokenData: LwaTokenResponse;
  try {
    tokenData = await resp.json() as LwaTokenResponse;
  } catch {
    console.log(`${LOG_PREFIX} token_exchange_failed`);
    return { ok: false, reason: "token_exchange_failed" };
  }

  if (!resp.ok || tokenData.error) {
    console.log(`${LOG_PREFIX} token_exchange_failed`);
    return { ok: false, reason: "token_exchange_failed" };
  }

  const refreshToken = tokenData.refresh_token?.trim();
  if (!refreshToken) {
    console.log(`${LOG_PREFIX} missing_refresh_token`);
    return { ok: false, reason: "missing_refresh_token" };
  }

  return { ok: true, refreshToken };
}

async function validateAndConsumeState(
  serviceClient: ReturnType<typeof createClient>,
  rawState: string,
): Promise<
  | { ok: true; row: OAuthStateRow }
  | { ok: false; reason: string; redirectAfter: string }
> {
  const stateHash = await sha256Hex(rawState);

  const { data, error } = await serviceClient
    .from("amazon_oauth_states")
    .select("id, region, marketplace_ids, redirect_after, expires_at, used_at")
    .eq("state_hash", stateHash)
    .maybeSingle();

  const redirectAfter = data?.redirect_after ?? DEFAULT_ADMIN_PATH;

  if (error || !data) {
    console.log(`${LOG_PREFIX} invalid_state`);
    return { ok: false, reason: "invalid_state", redirectAfter };
  }

  const row = data as OAuthStateRow;

  if (row.used_at) {
    console.log(`${LOG_PREFIX} state_already_used`);
    return { ok: false, reason: "state_already_used", redirectAfter };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    console.log(`${LOG_PREFIX} state_expired`);
    return { ok: false, reason: "state_expired", redirectAfter };
  }

  if (!VALID_REGIONS.has(row.region)) {
    console.log(`${LOG_PREFIX} unsupported_region`);
    return { ok: false, reason: "unsupported_region", redirectAfter };
  }

  const { data: updated, error: markErr } = await serviceClient
    .from("amazon_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (markErr || !updated) {
    console.log(`${LOG_PREFIX} state_already_used`);
    return { ok: false, reason: "state_already_used", redirectAfter };
  }

  return { ok: true, row };
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }

  if (req.method !== "GET") {
    return redirectToAdmin(DEFAULT_ADMIN_PATH, "error", "method_not_allowed");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("AMAZON_LWA_CLIENT_ID");
  const clientSecret = Deno.env.get("AMAZON_LWA_CLIENT_SECRET");
  const redirectUri = Deno.env.get("AMAZON_AUTH_REDIRECT_URI");

  if (!supabaseUrl || !supabaseServiceKey || !clientId || !clientSecret || !redirectUri) {
    console.log(`${LOG_PREFIX} server_misconfigured`);
    return redirectToAdmin(DEFAULT_ADMIN_PATH, "error", "server_misconfigured");
  }

  const url = new URL(req.url);
  const oauthError = url.searchParams.get("error");
  const redirectFallback = DEFAULT_ADMIN_PATH;

  if (oauthError) {
    console.log(`${LOG_PREFIX} user_denied`);
    return redirectToAdmin(redirectFallback, "error", "user_denied");
  }

  const code = (url.searchParams.get("code") || url.searchParams.get("spapi_oauth_code") || "")
    .trim();
  const rawState = (url.searchParams.get("state") || "").trim();
  const sellingPartnerId = (url.searchParams.get("selling_partner_id") || "").trim();

  if (!code) {
    console.log(`${LOG_PREFIX} missing_code`);
    return redirectToAdmin(redirectFallback, "error", "missing_code");
  }

  if (!rawState) {
    console.log(`${LOG_PREFIX} invalid_state`);
    return redirectToAdmin(redirectFallback, "error", "invalid_state");
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  const stateResult = await validateAndConsumeState(serviceClient, rawState);
  if (!stateResult.ok) {
    return redirectToAdmin(stateResult.redirectAfter, "error", stateResult.reason);
  }

  const { row: stateRow } = stateResult;
  const redirectAfter = stateRow.redirect_after ?? DEFAULT_ADMIN_PATH;
  const marketplaceIds = stateRow.marketplace_ids ?? [];

  if (marketplaceIds.length === 0) {
    return redirectToAdmin(redirectAfter, "error", "unsupported_marketplace");
  }

  const { data: marketplaces, error: marketplaceErr } = await serviceClient
    .from("amazon_marketplaces")
    .select("marketplace_id")
    .in("marketplace_id", marketplaceIds)
    .eq("region", stateRow.region)
    .eq("is_enabled", true);

  if (marketplaceErr || !marketplaces || marketplaces.length !== marketplaceIds.length) {
    console.log(`${LOG_PREFIX} unsupported_marketplace`);
    return redirectToAdmin(redirectAfter, "error", "unsupported_marketplace");
  }

  const tokenResult = await exchangeAuthorizationCode(
    code,
    clientId,
    clientSecret,
    redirectUri,
  );
  if (!tokenResult.ok) {
    return redirectToAdmin(redirectAfter, "error", tokenResult.reason);
  }

  const sellerId = sellingPartnerId;
  if (!sellerId) {
    console.log(`${LOG_PREFIX} missing_seller_id`);
    return redirectToAdmin(redirectAfter, "error", "missing_seller_id");
  }

  const now = new Date().toISOString();
  const accountLabel = `Amazon ${stateRow.region.toUpperCase()}`;

  const { data: account, error: accountErr } = await serviceClient
    .from("amazon_seller_accounts")
    .upsert(
      {
        seller_id: sellerId,
        account_label: accountLabel,
        region: stateRow.region,
        marketplace_ids: marketplaceIds,
        is_active: true,
        authorized_at: now,
        last_token_refresh_at: now,
        token_status: "active",
        scopes_roles_snapshot: {},
        updated_at: now,
      },
      { onConflict: "seller_id" },
    )
    .select("id")
    .single();

  if (accountErr || !account?.id) {
    console.log(`${LOG_PREFIX} db_write_failed`);
    return redirectToAdmin(redirectAfter, "error", "db_write_failed");
  }

  const sellerAccountId = account.id as string;

  const { data: vaultName, error: vaultErr } = await serviceClient.rpc(
    "amazon_store_lwa_refresh_token",
    {
      p_seller_account_id: sellerAccountId,
      p_refresh_token: tokenResult.refreshToken,
    },
  );

  if (vaultErr || !vaultName || typeof vaultName !== "string") {
    console.log(`${LOG_PREFIX} vault_write_failed`);
    return redirectToAdmin(redirectAfter, "error", "vault_write_failed");
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
    return redirectToAdmin(redirectAfter, "error", "db_write_failed");
  }

  console.log(`${LOG_PREFIX} success`);
  return redirectToAdmin(redirectAfter, "success");
});
