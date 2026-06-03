// Amazon SP-API credential resolution for PTD edge functions.

import {
  getAmazonEndpoint,
  refreshAmazonAccessToken,
} from "./amazonSpApiUtils.ts";
import { resolveAwsSigningConfig, type SyncEnvConfig } from "./amazonSyncAccountUtils.ts";

export type SellerAccountRow = {
  id: string;
  seller_id: string;
  region: string;
  marketplace_ids: string[] | null;
  token_status: string;
  is_active: boolean;
};

export type AwsSigningConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
  region: string;
};

export type AmazonCredentials = {
  account: SellerAccountRow;
  accessToken: string;
  endpoint: string;
  aws?: AwsSigningConfig;
};

export async function resolveConnectedAccount(
  // deno-lint-ignore no-explicit-any
  client: any,
  sellerAccountId: string | null,
): Promise<SellerAccountRow | null> {
  if (sellerAccountId) {
    const { data, error } = await client
      .from("amazon_seller_accounts")
      .select("id, seller_id, region, marketplace_ids, token_status, is_active")
      .eq("id", sellerAccountId)
      .maybeSingle();
    if (error) throw new Error("database_error");
    return data as SellerAccountRow | null;
  }

  const { data, error } = await client
    .from("amazon_seller_accounts")
    .select("id, seller_id, region, marketplace_ids, token_status, is_active")
    .eq("is_active", true)
    .eq("token_status", "active")
    .order("authorized_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error("database_error");
  const rows = data as SellerAccountRow[] | null;
  return rows?.[0] ?? null;
}

export async function resolveAmazonCredentials(
  // deno-lint-ignore no-explicit-any
  serviceClient: any,
  sellerAccountId: string | null,
  env: SyncEnvConfig,
): Promise<{ ok: true; creds: AmazonCredentials } | { ok: false; error: string }> {
  const account = await resolveConnectedAccount(serviceClient, sellerAccountId);
  if (!account?.is_active || account.token_status !== "active") {
    return { ok: false, error: "amazon_not_connected" };
  }

  const { data: tokenRow, error: tokenErr } = await serviceClient
    .from("amazon_auth_tokens")
    .select("token_status, vault_secret_name")
    .eq("seller_account_id", account.id)
    .maybeSingle();

  if (
    tokenErr ||
    !tokenRow ||
    tokenRow.token_status !== "active" ||
    !tokenRow.vault_secret_name
  ) {
    return { ok: false, error: "amazon_not_connected" };
  }

  const { data: refreshToken, error: vaultReadErr } = await serviceClient.rpc(
    "amazon_get_lwa_refresh_token",
    { p_seller_account_id: account.id },
  );

  if (vaultReadErr || typeof refreshToken !== "string" || !refreshToken.trim()) {
    return { ok: false, error: "token_missing" };
  }

  const tokenRefresh = await refreshAmazonAccessToken(
    refreshToken.trim(),
    env.lwaClientId,
    env.lwaClientSecret,
  );

  if (!tokenRefresh.ok) {
    return { ok: false, error: "token_refresh_failed" };
  }

  const endpoint = getAmazonEndpoint(account.region, env.spApiEndpointOverride);

  let aws: AwsSigningConfig | undefined;
  if (!env.allowUnsignedSpApi) {
    try {
      aws = await resolveAwsSigningConfig(account.region, env);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "aws_signing_failed";
      if (message === "sts_assume_role_failed" || message === "sts_parse_failed") {
        return { ok: false, error: "aws_assume_role_failed" };
      }
      return { ok: false, error: "server_misconfigured" };
    }
    if (!aws) {
      return { ok: false, error: "server_misconfigured" };
    }
  }

  return {
    ok: true,
    creds: {
      account,
      accessToken: tokenRefresh.accessToken,
      endpoint,
      aws,
    },
  };
}
