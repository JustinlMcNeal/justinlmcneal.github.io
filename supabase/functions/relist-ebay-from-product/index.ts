// relist-ebay-from-product — Admin-only ended single-SKU eBay relist (Phase 059D.2).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";
import { getAccessToken, createServiceClient } from "../_shared/ebayUtils.ts";
import { parseInventorySyncRunContext } from "../_shared/inventoryEbaySyncUtils.ts";
import { handleEbayRelistFromProduct } from "../_shared/ebayRelistFromProduct.ts";

const LOG_PREFIX = "[relist-ebay-from-product]";
const UUID_RE = /^[0-9a-f-]{36}$/i;

type Payload = {
  productId?: unknown;
  variantId?: unknown;
  quantity?: unknown;
  preview?: unknown;
  syncContext?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

function parseQuantity(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const liveRelistDisabled = Deno.env.get("EBAY_ENABLE_LIVE_RELIST") !== "true";

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

  const productId = parseUuid(body.productId);
  const variantId = parseUuid(body.variantId);
  const quantity = parseQuantity(body.quantity);
  const wantsPreview = body.preview === true;
  const syncCtx = parseInventorySyncRunContext(body.syncContext);

  if (!productId || !variantId || !quantity) {
    return json({
      ok: false,
      status: "skipped",
      mode: "ebay_relist_from_product",
      message: "productId, variantId, and positive quantity are required.",
      errors: ["invalid_payload"],
    }, 400);
  }

  const serviceClient = createServiceClient();
  const now = new Date().toISOString();

  let accessToken: string | null = null;
  const dryRun = wantsPreview || liveRelistDisabled;
  if (!dryRun) {
    try {
      accessToken = await getAccessToken(serviceClient);
    } catch (err) {
      console.error(`${LOG_PREFIX} token error`, err);
      return json({
        ok: false,
        status: "failed",
        mode: "ebay_relist_from_product",
        productId,
        variantId,
        quantity,
        message: "eBay not connected.",
        errors: ["ebay_not_connected"],
      }, 503);
    }
  }

  try {
    const result = await handleEbayRelistFromProduct({
      client: serviceClient,
      accessToken,
      productId,
      variantId,
      quantity,
      wantsPreview,
      liveRelistDisabled,
      syncCtx,
      requestedBy: admin.userId,
      now,
    });

    const httpStatus = result.status === "failed" ? 502
      : result.status === "skipped" || result.status === "manual" ? 200
      : 200;

    return json(result, httpStatus);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} error`, message);
    return json({
      ok: false,
      status: "failed",
      mode: "ebay_relist_from_product",
      productId,
      variantId,
      quantity,
      message,
      errors: [message],
    }, 500);
  }
});
