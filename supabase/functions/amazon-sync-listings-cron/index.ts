// amazon-sync-listings-cron — Scheduled read-only incremental Amazon listing sync.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json } from "../_shared/amazonAuthUtils.ts";
import {
  buildCronSyncResponse,
  isSyncEnvConfigured,
  loadActiveSellerAccounts,
  readSyncEnvConfig,
  runSellerAccountSync,
} from "../_shared/amazonSyncAccountUtils.ts";
import {
  getCronBatchAccounts,
  getCronMaxPages,
  requireCronSecret,
} from "../_shared/amazonSyncCronUtils.ts";

const LOG_PREFIX = "[amazon-sync-listings-cron]";

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

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

  const maxPages = getCronMaxPages();
  const batchAccounts = getCronBatchAccounts();
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  let accountsProcessed = 0;
  const allRuns = [];
  const accountErrors: Array<{ sellerAccountId: string; error: string }> = [];

  try {
    const accounts = await loadActiveSellerAccounts(serviceClient, batchAccounts);

    if (accounts.length === 0) {
      console.log(`${LOG_PREFIX} no_active_accounts`);
      return json({
        ok: true,
        accountsProcessed: 0,
        marketplacesSynced: 0,
        recordsSeen: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsFailed: 0,
        status: "success",
        runs: [],
        warnings: ["no_active_accounts"],
      });
    }

    for (const account of accounts) {
      try {
        const runs = await runSellerAccountSync({
          client: serviceClient,
          account,
          syncType: "incremental",
          maxPages,
          triggeredBy: null,
          env: syncEnv,
          now,
        });
        accountsProcessed += 1;
        allRuns.push(...runs);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "sync_failed";
        accountErrors.push({ sellerAccountId: account.id, error: message });
        console.log(`${LOG_PREFIX} account_failed id=${account.id} error=${message}`);
      }
    }

    const response = buildCronSyncResponse(allRuns, accountsProcessed);
    if (accountErrors.length > 0) {
      response.warnings = [
        ...(response.warnings || []),
        ...accountErrors.map((row) => `account_error:${row.sellerAccountId}:${row.error}`),
      ];
    }

    console.log(
      `${LOG_PREFIX} done accounts=${accountsProcessed} marketplaces=${response.marketplacesSynced} status=${response.status}`,
    );

    if (response.status === "failed" && response.recordsSeen === 0 && accountsProcessed === 0) {
      return json({ ...response, ok: false, error: "sync_failed" }, 502);
    }

    return json(response);
  } catch {
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
