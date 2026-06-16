// sync-ebay-listing-inventory-cache — Admin-only read of eBay listing qty/status into local cache.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";
import { getAccessToken, createServiceClient } from "../_shared/ebayUtils.ts";
import {
  EBAY_CACHE_DELAY_MS,
  EBAY_CACHE_REFRESH_DEFAULT_LIMIT,
  EBAY_CACHE_REFRESH_MAX,
  refreshProductEbayCache,
  upsertEbayCacheRows,
  sleep,
  type ProductRefreshTarget,
  type VariantRow,
} from "../_shared/inventoryEbayCacheUtils.ts";
import {
  createInventorySyncRun,
  finalizeInventorySyncRun,
  logInventorySyncResult,
} from "../_shared/inventoryAmazonSyncUtils.ts";

const LOG_PREFIX = "[sync-ebay-listing-inventory-cache]";

type Payload = {
  productIds?: unknown;
  limit?: unknown;
};

function parseUuidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  const re = /^[0-9a-f-]{36}$/i;
  for (const entry of value) {
    if (typeof entry === "string" && re.test(entry.trim())) ids.push(entry.trim());
  }
  return [...new Set(ids)];
}

function parseLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return EBAY_CACHE_REFRESH_DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), EBAY_CACHE_REFRESH_MAX);
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
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
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

  let body: Payload = {};
  try {
    body = (await req.json()) as Payload;
  } catch {
    body = {};
  }

  const productIds = parseUuidList(body.productIds);
  const limit = parseLimit(body.limit);
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date().toISOString();

  try {
    let query = serviceClient
      .from("products")
      .select("id, code, ebay_sku, ebay_listing_id, ebay_offer_id, ebay_status, ebay_item_group_key")
      .or("ebay_listing_id.not.is.null,ebay_offer_id.not.is.null")
      .not("ebay_status", "eq", "not_listed")
      .limit(limit);

    if (productIds.length) query = query.in("id", productIds);

    const { data: products, error: prodErr } = await query;
    if (prodErr) return json({ ok: false, error: "database_error" }, 500);

    const targets = (products || []) as ProductRefreshTarget[];
    const run = await createInventorySyncRun(serviceClient, {
      channel: "ebay",
      mode: "cache_refresh",
      requestedBy: admin.userId ?? null,
      candidateCount: targets.length,
      notes: "eBay listing inventory cache refresh (read-only)",
    });

    const ebayClient = createServiceClient();
    const accessToken = await getAccessToken(ebayClient);

    const results: Array<Record<string, unknown>> = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < targets.length; i++) {
      const product = targets[i];
      const { data: variants } = await serviceClient
        .from("product_variants")
        .select("id, sku, option_value")
        .eq("product_id", product.id)
        .eq("is_active", true);

      try {
        const { rows, errors } = await refreshProductEbayCache(
          accessToken,
          product,
          (variants || []) as VariantRow[],
        );

        if (!rows.length) {
          skipped += 1;
          results.push({
            productId: product.id,
            code: product.code,
            status: "skipped",
            errors,
          });
          if (run?.id) {
            await logInventorySyncResult(serviceClient, {
              runId: run.id,
              productId: product.id,
              sellerSku: product.ebay_sku,
              status: "skipped",
              action: "cache_refresh",
              errorCode: errors[0] || "no_rows",
              errorMessage: errors.join("; ") || "No cache rows returned",
            });
          }
        } else {
          await upsertEbayCacheRows(serviceClient, rows, now);
          succeeded += 1;
          results.push({
            productId: product.id,
            code: product.code,
            status: "success",
            rows: rows.length,
            skus: rows.map((r) => r.ebay_sku),
          });
          for (const row of rows) {
            if (run?.id) {
              await logInventorySyncResult(serviceClient, {
                runId: run.id,
                productId: product.id,
                variantId: row.variant_id ?? null,
                sellerSku: row.ebay_sku,
                previousQty: null,
                targetQty: row.current_qty ?? null,
                status: "success",
                action: "cache_refresh",
              });
            }
          }
        }
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ productId: product.id, code: product.code, status: "failed", error: msg });
        if (run?.id) {
          await logInventorySyncResult(serviceClient, {
            runId: run.id,
            productId: product.id,
            sellerSku: product.ebay_sku,
            status: "failed",
            action: "cache_refresh",
            errorCode: "refresh_failed",
            errorMessage: msg,
          });
        }
      }

      if (i < targets.length - 1) await sleep(EBAY_CACHE_DELAY_MS);
    }

    const summary = { total: targets.length, succeeded, failed, skipped };
    if (run?.id) await finalizeInventorySyncRun(serviceClient, run.id, summary, now);

    console.log(`${LOG_PREFIX} done ok=${succeeded} fail=${failed} skip=${skipped}`);

    return json({
      ok: true,
      runId: run?.id ?? null,
      candidateCount: targets.length,
      summary,
      results,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} error`, err);
    return json({ ok: false, error: "cache_refresh_failed" }, 500);
  }
});
