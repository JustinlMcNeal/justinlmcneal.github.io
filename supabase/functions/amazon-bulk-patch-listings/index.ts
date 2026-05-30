// amazon-bulk-patch-listings — Admin bulk patchListingsItem for price/qty (sequential Listings API).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import {
  BULK_PATCH_MAX_ITEMS,
  operationNeedsValue,
  parseBulkPatchOperation,
  processBulkListingPatches,
  type BulkPatchOperation,
} from "../_shared/amazonBulkPatchUtils.ts";
import { readSyncEnvConfig } from "../_shared/amazonSyncAccountUtils.ts";

const LOG_PREFIX = "[amazon-bulk-patch-listings]";

type BulkPayload = {
  amazonListingIds?: unknown;
  operation?: unknown;
  value?: unknown;
  preview?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function parseListingIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    const id = parseUuid(entry);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

function parseOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const livePatchDisabled = Deno.env.get("AMAZON_ENABLE_LIVE_PATCH") !== "true";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const syncEnv = readSyncEnvConfig();

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey ||
    !syncEnv.lwaClientId || !syncEnv.lwaClientSecret) {
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

  let body: BulkPayload = {};
  try {
    body = (await req.json()) as BulkPayload;
  } catch {
    body = {};
  }

  const listingIds = parseListingIds(body.amazonListingIds);
  const operation = parseBulkPatchOperation(body.operation);
  const wantsPreview = body.preview === true;
  const value = parseOptionalNumber(body.value);

  if (!listingIds.length || !operation) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  if (listingIds.length > BULK_PATCH_MAX_ITEMS) {
    return json({ ok: false, error: "batch_limit_exceeded", limit: BULK_PATCH_MAX_ITEMS }, 400);
  }

  if (livePatchDisabled && !wantsPreview) {
    return json({ ok: false, error: "live_patch_disabled" }, 403);
  }

  if (operationNeedsValue(operation) && (value === undefined || value === null)) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  try {
    const { results, summary } = await processBulkListingPatches({
      client: serviceClient,
      listingIds,
      operation: operation as BulkPatchOperation,
      value,
      preview: wantsPreview,
      syncEnv,
      now,
    });

    console.log(
      `${LOG_PREFIX} done preview=${wantsPreview} op=${operation} ok=${summary.succeeded} fail=${summary.failed} skip=${summary.skipped}`,
    );

    return json({
      ok: true,
      preview: wantsPreview,
      operation,
      value: value ?? null,
      summary,
      results,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
