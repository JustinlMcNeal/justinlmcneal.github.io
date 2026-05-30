// Shared seller-account sync orchestration for manual and cron sync runners.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AwsSigningConfig,
  buildAggregateSyncResponse,
  resolveMaxPages,
  runMarketplaceSync,
  SyncRunSummary,
  SyncType,
} from "./amazonSyncRunUtils.ts";
import {
  getAmazonEndpoint,
  getAwsRegionForSpApiRegion,
  refreshAmazonAccessToken,
} from "./amazonSpApiUtils.ts";

export type ServiceClient = ReturnType<typeof createClient>;

export type SellerAccountRow = {
  id: string;
  seller_id: string;
  region: string;
  marketplace_ids: string[] | null;
  token_status: string;
  is_active: boolean;
};

export type SyncEnvConfig = {
  lwaClientId: string;
  lwaClientSecret: string;
  spApiEndpointOverride: string | null;
  awsAccessKeyId: string | null;
  awsSecretAccessKey: string | null;
  awsSessionToken: string | null;
  awsRegionOverride: string | null;
  allowUnsignedSpApi: boolean;
};

export async function resolveConnectedAccount(
  client: ServiceClient,
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
  return (data?.[0] as SellerAccountRow | undefined) ?? null;
}

export async function loadActiveSellerAccounts(
  client: ServiceClient,
  limit: number,
): Promise<SellerAccountRow[]> {
  const { data, error } = await client
    .from("amazon_seller_accounts")
    .select("id, seller_id, region, marketplace_ids, token_status, is_active")
    .eq("is_active", true)
    .eq("token_status", "active")
    .order("authorized_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error("database_error");
  return (data || []) as SellerAccountRow[];
}

export async function resolveEnabledMarketplaceIds(
  client: ServiceClient,
  account: SellerAccountRow,
  requestedIds: string[] = [],
): Promise<string[]> {
  let marketplaceIds = requestedIds.filter(Boolean);
  if (marketplaceIds.length === 0) {
    marketplaceIds = account.marketplace_ids?.length
      ? account.marketplace_ids
      : ["ATVPDKIKX0DER"];
  }

  const { data: enabledMarketplaces, error: marketplaceErr } = await client
    .from("amazon_marketplaces")
    .select("marketplace_id")
    .in("marketplace_id", marketplaceIds)
    .eq("is_enabled", true);

  if (marketplaceErr || !enabledMarketplaces?.length) {
    throw new Error("invalid_marketplaces");
  }

  return enabledMarketplaces.map((row) => row.marketplace_id as string);
}

export function buildAwsConfig(
  accountRegion: string,
  env: SyncEnvConfig,
): AwsSigningConfig | undefined {
  if (!env.awsAccessKeyId?.trim() || !env.awsSecretAccessKey?.trim()) {
    return undefined;
  }

  return {
    accessKeyId: env.awsAccessKeyId.trim(),
    secretAccessKey: env.awsSecretAccessKey.trim(),
    sessionToken: env.awsSessionToken,
    region: getAwsRegionForSpApiRegion(accountRegion, env.awsRegionOverride),
  };
}

export function readSyncEnvConfig(): SyncEnvConfig {
  return {
    lwaClientId: Deno.env.get("AMAZON_LWA_CLIENT_ID") || "",
    lwaClientSecret: Deno.env.get("AMAZON_LWA_CLIENT_SECRET") || "",
    spApiEndpointOverride: Deno.env.get("AMAZON_SP_API_ENDPOINT") || null,
    awsAccessKeyId: Deno.env.get("AWS_ACCESS_KEY_ID") || null,
    awsSecretAccessKey: Deno.env.get("AWS_SECRET_ACCESS_KEY") || null,
    awsSessionToken: Deno.env.get("AWS_SESSION_TOKEN") || null,
    awsRegionOverride: Deno.env.get("AWS_REGION") || null,
    allowUnsignedSpApi: Deno.env.get("AMAZON_ALLOW_UNSIGNED_SP_API") === "true",
  };
}

export function isSyncEnvConfigured(env: SyncEnvConfig): boolean {
  if (!env.lwaClientId || !env.lwaClientSecret) return false;
  if (env.allowUnsignedSpApi) return true;
  return Boolean(env.awsAccessKeyId?.trim() && env.awsSecretAccessKey?.trim());
}

type TokenReadyResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string; revoked?: boolean };

export async function ensureAccountAccessToken(
  client: ServiceClient,
  account: SellerAccountRow,
  env: SyncEnvConfig,
  now: string,
): Promise<TokenReadyResult> {
  const { data: tokenRow, error: tokenErr } = await client
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

  const { data: refreshToken, error: vaultReadErr } = await client.rpc(
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
    if (tokenRefresh.revoked) {
      await client.from("amazon_seller_accounts").update({
        token_status: "error",
        updated_at: now,
      }).eq("id", account.id);
      await client.from("amazon_auth_tokens").update({
        token_status: "error",
        last_error: "token_refresh_failed",
        updated_at: now,
      }).eq("seller_account_id", account.id);
    }
    return { ok: false, error: "token_refresh_failed", revoked: tokenRefresh.revoked };
  }

  await client.from("amazon_seller_accounts").update({
    last_token_refresh_at: now,
    updated_at: now,
  }).eq("id", account.id);

  await client.from("amazon_auth_tokens").update({
    last_refresh_at: now,
    updated_at: now,
  }).eq("seller_account_id", account.id);

  return { ok: true, accessToken: tokenRefresh.accessToken };
}

export type RunSellerAccountSyncParams = {
  client: ServiceClient;
  account: SellerAccountRow;
  syncType: SyncType;
  maxPages: number;
  triggeredBy: string | null;
  sellerSku?: string | null;
  marketplaceIds?: string[];
  env: SyncEnvConfig;
  now?: string;
};

export async function runSellerAccountSync(
  params: RunSellerAccountSyncParams,
): Promise<SyncRunSummary[]> {
  const {
    client,
    account,
    syncType,
    maxPages,
    triggeredBy,
    sellerSku = null,
    marketplaceIds = [],
    env,
  } = params;
  const now = params.now || new Date().toISOString();

  if (
    !account.is_active ||
    account.token_status !== "active"
  ) {
    throw new Error("amazon_not_connected");
  }

  const token = await ensureAccountAccessToken(client, account, env, now);
  if (!token.ok) {
    throw new Error(token.error);
  }

  const enabledIds = await resolveEnabledMarketplaceIds(client, account, marketplaceIds);
  const endpoint = getAmazonEndpoint(account.region, env.spApiEndpointOverride);
  const awsConfig = buildAwsConfig(account.region, env);

  const runs: SyncRunSummary[] = [];
  for (const marketplaceId of enabledIds) {
    const run = await runMarketplaceSync({
      client,
      account,
      marketplaceId,
      syncType,
      maxPages,
      accessToken: token.accessToken,
      endpoint,
      aws: awsConfig,
      triggeredBy,
      sellerSku: syncType === "single_sku" ? sellerSku : null,
      now,
    });
    runs.push(run);
  }

  return runs;
}

export function buildManualSyncResponse(runs: SyncRunSummary[]) {
  const response = buildAggregateSyncResponse(runs);
  return response;
}

export function buildCronSyncResponse(
  runs: SyncRunSummary[],
  accountsProcessed: number,
) {
  const response = buildAggregateSyncResponse(runs);
  return {
    ok: true,
    accountsProcessed,
    marketplacesSynced: response.marketplacesSynced,
    recordsSeen: response.recordsSeen,
    recordsCreated: response.recordsCreated,
    recordsUpdated: response.recordsUpdated,
    recordsFailed: response.recordsFailed,
    status: response.status,
    runs: response.runs,
    warnings: response.warnings,
  };
}

export { resolveMaxPages, buildAggregateSyncResponse };
