// amazon-estimate-listing-fees — Admin Product Fees API batch estimates (read-only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson, UUID_RE } from "../_shared/amazonAuthUtils.ts";
import {
  estimateListingFeesForAccount,
  FEES_ESTIMATE_MAX_ITEMS,
  type FeesListingInput,
} from "../_shared/amazonFeesEstimateUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import { readSyncEnvConfig } from "../_shared/amazonSyncAccountUtils.ts";

const LOG_PREFIX = "[amazon-estimate-listing-fees]";
const MAX_REQUEST_ITEMS = 20;

type Payload = {
  amazonListingIds?: unknown;
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

function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

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

  let body: Payload = {};
  try {
    body = (await req.json()) as Payload;
  } catch {
    body = {};
  }

  const listingIds = parseListingIds(body.amazonListingIds);
  if (!listingIds.length) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  if (listingIds.length > MAX_REQUEST_ITEMS) {
    return json({ ok: false, error: "batch_limit_exceeded", limit: MAX_REQUEST_ITEMS }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: rows, error } = await serviceClient
      .from("v_amazon_listing_workspace")
      .select([
        "amazon_listing_id",
        "seller_account_id",
        "seller_sku",
        "asin",
        "marketplace_id",
        "price",
        "currency",
        "fulfillment_channel",
        "profit_calc_status",
        "kk_cogs",
      ].join(","))
      .in("amazon_listing_id", listingIds);

    if (error) throw new Error("database_error");

    const rowById = new Map<string, Record<string, unknown>>();
    for (const row of (rows || []) as Record<string, unknown>[]) {
      rowById.set(String(row.amazon_listing_id), row);
    }

    /** @type {Map<string, FeesListingInput[]>} */
    const grouped = new Map<string, FeesListingInput[]>();
    const skipped: Array<Record<string, unknown>> = [];

    for (const listingId of listingIds) {
      const row = rowById.get(listingId);
      if (!row) {
        skipped.push({
          amazonListingId: listingId,
          status: "failed",
          error: "listing_not_found",
        });
        continue;
      }

      if (String(row.profit_calc_status) !== "complete") {
        skipped.push({
          amazonListingId: listingId,
          status: "skipped",
          error: String(row.profit_calc_status || "not_estimable"),
        });
        continue;
      }

      const sellerSku = String(row.seller_sku || "").trim();
      const asin = String(row.asin || "").trim();
      const marketplaceId = String(row.marketplace_id || "").trim();
      const price = asNumber(row.price);
      const sellerAccountId = String(row.seller_account_id || "").trim();

      if (!sellerAccountId || !marketplaceId || price === null || price <= 0) {
        skipped.push({
          amazonListingId: listingId,
          status: "failed",
          error: "listing_not_estimable",
        });
        continue;
      }

      if (!sellerSku && !asin) {
        skipped.push({
          amazonListingId: listingId,
          status: "failed",
          error: "listing_not_estimable",
        });
        continue;
      }

      const input: FeesListingInput = {
        amazonListingId: listingId,
        sellerSku,
        asin: asin || null,
        marketplaceId,
        price,
        currency: String(row.currency || "USD"),
        fulfillmentChannel: String(row.fulfillment_channel || "DEFAULT"),
        kkCogs: asNumber(row.kk_cogs),
      };

      const list = grouped.get(sellerAccountId) || [];
      list.push(input);
      grouped.set(sellerAccountId, list);
    }

    const results: Array<Record<string, unknown>> = [...skipped];

    for (const [sellerAccountId, items] of grouped.entries()) {
      const credsResult = await resolveAmazonCredentials(
        serviceClient,
        sellerAccountId,
        syncEnv,
      );

      if (!credsResult.ok) {
        for (const item of items) {
          results.push({
            amazonListingId: item.amazonListingId,
            sellerSku: item.sellerSku,
            status: "failed",
            error: credsResult.error,
            source: "product_fees_api",
          });
        }
        continue;
      }

      const chunkSize = FEES_ESTIMATE_MAX_ITEMS;
      for (let offset = 0; offset < items.length; offset += chunkSize) {
        const chunk = items.slice(offset, offset + chunkSize);
        const estimates = await estimateListingFeesForAccount({
          creds: credsResult.creds,
          items: chunk,
        });
        results.push(...estimates);
      }
    }

    const succeeded = results.filter((row) => row.status === "success").length;
    console.log(`${LOG_PREFIX} done requested=${listingIds.length} success=${succeeded}`);

    return json({
      ok: true,
      summary: {
        requested: listingIds.length,
        succeeded,
        failed: results.filter((row) => row.status === "failed").length,
        skipped: results.filter((row) => row.status === "skipped").length,
      },
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
