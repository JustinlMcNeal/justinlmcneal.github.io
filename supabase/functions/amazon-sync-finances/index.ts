// amazon-sync-finances — Pull Amazon Finances API transactions per order.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";
import { syncAmazonFinancesToDb } from "../_shared/amazonFinanceSyncUtils.ts";
import { refreshMarketplaceObservationsAfterSync } from "../_shared/marketplaceObservationRefresh.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import {
  isSyncEnvConfigured,
  readSyncEnvConfig,
  resolveEnabledMarketplaceIds,
} from "../_shared/amazonSyncAccountUtils.ts";

const LOG_PREFIX = "[amazon-sync-finances]";

type SyncPayload = { days_back?: unknown; sellerAccountId?: unknown };

Deno.serve(async (req) => {
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

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !isSyncEnvConfigured(syncEnv)) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ ok: false, error: "unauthorized" }, 401);

  const admin = await requireAdminJson(
    createClient,
    supabaseUrl,
    supabaseAnonKey,
    authHeader,
    LOG_PREFIX,
  );
  if (!admin.ok) return admin.response;

  let body: SyncPayload = {};
  try {
    body = (await req.json()) as SyncPayload;
  } catch {
    body = {};
  }

  let daysBack = 30;
  if (typeof body.days_back === "number" && Number.isFinite(body.days_back)) {
    daysBack = Math.min(90, Math.max(1, Math.floor(body.days_back)));
  }

  const sellerAccountId = typeof body.sellerAccountId === "string" && body.sellerAccountId.trim()
    ? body.sellerAccountId.trim()
    : null;

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const credResult = await resolveAmazonCredentials(serviceClient, sellerAccountId, syncEnv);
    if (!credResult.ok) return json({ ok: false, error: credResult.error }, 400);

    const marketplaceIds = await resolveEnabledMarketplaceIds(
      serviceClient,
      credResult.creds.account,
    );
    const marketplaceId = marketplaceIds[0] || "ATVPDKIKX0DER";

    const syncResult = await syncAmazonFinancesToDb(
      serviceClient,
      credResult.creds,
      marketplaceId,
      daysBack,
    );

    if (!syncResult.ok) {
      return json(
        { ok: false, error: syncResult.error, hint: syncResult.hint },
        syncResult.error === "rate_limited" ? 429 : 502,
      );
    }

    const obsRefresh = await refreshMarketplaceObservationsAfterSync(serviceClient, {
      channel: "amazon",
      daysBack,
      logPrefix: LOG_PREFIX,
    });

    return json({ ok: true, success: true, days_back: daysBack, ...syncResult.stats, observation_refresh: obsRefresh });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
});
