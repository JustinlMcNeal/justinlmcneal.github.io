// amazon-sync-orders-cron — Scheduled Amazon order pull (service role + CRON_SECRET).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json } from "../_shared/amazonAuthUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import { syncAmazonOrdersToDb } from "../_shared/amazonOrderSyncUtils.ts";
import {
  isSyncEnvConfigured,
  loadActiveSellerAccounts,
  readSyncEnvConfig,
  resolveEnabledMarketplaceIds,
} from "../_shared/amazonSyncAccountUtils.ts";
import { requireCronSecret } from "../_shared/amazonSyncCronUtils.ts";

const LOG_PREFIX = "[amazon-sync-orders-cron]";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const syncEnv = readSyncEnvConfig();

  if (!supabaseUrl || !supabaseServiceKey || !cronSecret || !isSyncEnvConfigured(syncEnv)) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }
  if (!requireCronSecret(req)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const daysBack = 3;

  try {
    const accounts = await loadActiveSellerAccounts(serviceClient, 3);
    if (!accounts.length) {
      return json({ ok: true, success: true, synced: 0, message: "no_active_accounts" });
    }

    let totalSynced = 0;
    const warnings: string[] = [];

    for (const account of accounts) {
      const credResult = await resolveAmazonCredentials(serviceClient, account.id, syncEnv);
      if (!credResult.ok) {
        warnings.push(`${account.id}:${credResult.error}`);
        continue;
      }

      const marketplaceIds = await resolveEnabledMarketplaceIds(serviceClient, account);
      const syncResult = await syncAmazonOrdersToDb(
        serviceClient,
        credResult.creds,
        marketplaceIds,
        daysBack,
      );

      if (!syncResult.ok) {
        warnings.push(`${account.id}:${syncResult.error}`);
        continue;
      }

      totalSynced += syncResult.stats.synced;
      console.log(
        `${LOG_PREFIX} account=${account.id} fetched=${syncResult.stats.fetched} synced=${syncResult.stats.synced}`,
      );
    }

    return json({
      ok: true,
      success: true,
      days_back: daysBack,
      synced: totalSynced,
      warnings,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} error`, message);
    return json({ ok: false, error: message }, 500);
  }
});
