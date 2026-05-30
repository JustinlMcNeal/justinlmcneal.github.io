// amazon-sync-listings — Read-only SP-API searchListingsItems sync (incremental/full/multi-marketplace).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import {
  buildManualSyncResponse,
  isSyncEnvConfigured,
  readSyncEnvConfig,
  resolveConnectedAccount,
  resolveMaxPages,
  runSellerAccountSync,
} from "../_shared/amazonSyncAccountUtils.ts";
import { parseSyncType } from "../_shared/amazonSyncRunUtils.ts";

const LOG_PREFIX = "[amazon-sync-listings]";

type SyncPayload = {
  sellerAccountId?: unknown;
  marketplaceIds?: unknown;
  syncType?: unknown;
  maxPages?: unknown;
  sellerSku?: unknown;
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
    console.log(`${LOG_PREFIX} server_misconfigured`);
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  if (!isSyncEnvConfigured(syncEnv)) {
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

  let body: SyncPayload = {};
  try {
    body = (await req.json()) as SyncPayload;
  } catch {
    body = {};
  }

  let sellerAccountId: string | null = null;
  if (body.sellerAccountId !== undefined && body.sellerAccountId !== null && body.sellerAccountId !== "") {
    if (typeof body.sellerAccountId !== "string" || !UUID_RE.test(body.sellerAccountId.trim())) {
      return json({ ok: false, error: "invalid_request" }, 400);
    }
    sellerAccountId = body.sellerAccountId.trim();
  }

  const syncType = parseSyncType(body.syncType);
  const maxPages = resolveMaxPages(syncType, body.maxPages);

  const sellerSku = typeof body.sellerSku === "string" ? body.sellerSku.trim() : "";
  if (syncType === "single_sku" && !sellerSku) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  let marketplaceIds: string[] = [];
  if (Array.isArray(body.marketplaceIds)) {
    marketplaceIds = body.marketplaceIds
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const account = await resolveConnectedAccount(serviceClient, sellerAccountId);
    if (
      !account ||
      !account.is_active ||
      account.token_status !== "active"
    ) {
      return json({ ok: false, error: "amazon_not_connected" }, 400);
    }

    const runs = await runSellerAccountSync({
      client: serviceClient,
      account,
      syncType,
      maxPages,
      triggeredBy: admin.userId,
      sellerSku: syncType === "single_sku" ? sellerSku : null,
      marketplaceIds,
      env: syncEnv,
    });

    const response = buildManualSyncResponse(runs);
    console.log(`${LOG_PREFIX} success status=${response.status} marketplaces=${runs.length}`);

    if (response.status === "failed" && response.recordsSeen === 0) {
      return json({ ...response, ok: false, error: "sp_api_request_failed" }, 502);
    }

    return json(response);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "amazon_not_connected" || err.message === "token_missing") {
        return json({ ok: false, error: err.message }, 400);
      }
      if (err.message === "token_refresh_failed") {
        return json({ ok: false, error: "token_refresh_failed" }, 502);
      }
      if (
        err.message === "sts_assume_role_failed" ||
        err.message === "sts_parse_failed" ||
        err.message === "missing_role_arn"
      ) {
        return json({ ok: false, error: "aws_assume_role_failed" }, 502);
      }
      if (err.message === "invalid_marketplaces") {
        return json({ ok: false, error: "invalid_request" }, 400);
      }
      if (err.message === "invalid_request") {
        return json({ ok: false, error: "invalid_request" }, 400);
      }
      if (err.message === "database_error") {
        console.log(`${LOG_PREFIX} database_error`);
        return json({ ok: false, error: "database_error" }, 500);
      }
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
