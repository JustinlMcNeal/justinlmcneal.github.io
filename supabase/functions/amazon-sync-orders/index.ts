// amazon-sync-orders — Pull Amazon orders via SP-API Orders API, upsert orders_raw + line_items_raw.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import { syncAmazonOrdersToDb } from "../_shared/amazonOrderSyncUtils.ts";
import {
  isSyncEnvConfigured,
  readSyncEnvConfig,
  resolveEnabledMarketplaceIds,
} from "../_shared/amazonSyncAccountUtils.ts";

const LOG_PREFIX = "[amazon-sync-orders]";

type SyncPayload = {
  days_back?: unknown;
  sellerAccountId?: unknown;
};

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

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  if (!isSyncEnvConfigured(syncEnv)) {
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

  let body: SyncPayload = {};
  try {
    body = (await req.json()) as SyncPayload;
  } catch {
    body = {};
  }

  let daysBack = 7;
  if (typeof body.days_back === "number" && Number.isFinite(body.days_back)) {
    daysBack = Math.min(90, Math.max(1, Math.floor(body.days_back)));
  }

  const sellerAccountId = typeof body.sellerAccountId === "string" && body.sellerAccountId.trim()
    ? body.sellerAccountId.trim()
    : null;

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const credResult = await resolveAmazonCredentials(serviceClient, sellerAccountId, syncEnv);
    if (!credResult.ok) {
      return json({ ok: false, error: credResult.error }, 400);
    }

    const marketplaceIds = await resolveEnabledMarketplaceIds(
      serviceClient,
      credResult.creds.account,
    );

    const syncResult = await syncAmazonOrdersToDb(
      serviceClient,
      credResult.creds,
      marketplaceIds,
      daysBack,
    );

    if (!syncResult.ok) {
      console.log(`${LOG_PREFIX} failed`, syncResult.error, syncResult.hint || "");
      return json(
        { ok: false, error: syncResult.error, hint: syncResult.hint },
        syncResult.error === "rate_limited" ? 429 : 502,
      );
    }

    const stats = syncResult.stats;
    console.log(
      `${LOG_PREFIX} done fetched=${stats.fetched} synced=${stats.synced} skipped=${stats.skipped}`,
    );

    return json({
      ok: true,
      success: true,
      days_back: daysBack,
      ...stats,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} error`, message);
    return json({ ok: false, error: message }, 500);
  }
});
