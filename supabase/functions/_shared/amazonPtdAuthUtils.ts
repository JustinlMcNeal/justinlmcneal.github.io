// Amazon SP-API credential resolution for PTD edge functions.

import {
  getAmazonEndpoint,
  getAwsRegionForSpApiRegion,
  refreshAmazonAccessToken,
} from "./amazonSpApiUtils.ts";

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
  env: {
    lwaClientId: string;
    lwaClientSecret: string;
    spApiEndpointOverride?: string | null;
    awsAccessKeyId?: string | null;
    awsSecretAccessKey?: string | null;
    awsSessionToken?: string | null;
    awsRegionOverride?: string | null;
    allowUnsignedSpApi?: boolean;
  },
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
  const awsSigningRegion = getAwsRegionForSpApiRegion(account.region, env.awsRegionOverride);
  const aws = env.awsAccessKeyId?.trim() && env.awsSecretAccessKey?.trim()
    ? {
      accessKeyId: env.awsAccessKeyId.trim(),
      secretAccessKey: env.awsSecretAccessKey.trim(),
      sessionToken: env.awsSessionToken,
      region: awsSigningRegion,
    }
    : undefined;

  if (!env.allowUnsignedSpApi && !aws) {
    return { ok: false, error: "server_misconfigured" };
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
