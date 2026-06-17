// relist-ebay-variation-group — Admin-only ended eBay variation group relist (Phase 060B.3).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";
import { getAccessToken, createServiceClient } from "../_shared/ebayUtils.ts";
import { parseInventorySyncRunContext } from "../_shared/inventoryEbaySyncUtils.ts";
import { relistEbayVariationGroup } from "../_shared/ebayVariationGroupRelistUtils.ts";

const LOG_PREFIX = "[relist-ebay-variation-group]";
const UUID_RE = /^[0-9a-f-]{36}$/i;

type Payload = {
  productId?: unknown;
  triggeringVariantId?: unknown;
  preview?: unknown;
  syncContext?: unknown;
};

function parseUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value.trim())) return null;
  return value.trim();
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const liveVariationRelistEnabled = Deno.env.get("EBAY_ENABLE_LIVE_VARIATION_RELIST") === "true";

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
  const triggeringVariantId = parseUuid(body.triggeringVariantId);
  const wantsPreview = body.preview === true;
  const syncCtx = parseInventorySyncRunContext(body.syncContext);

  if (!productId) {
    return json({
      ok: false,
      status: "skipped",
      mode: "variation_group_relist",
      message: "productId is required.",
      errors: ["invalid_payload"],
    }, 400);
  }

  const serviceClient = createServiceClient();
  const dryRun = wantsPreview || !liveVariationRelistEnabled;

  let accessToken: string | null = null;
  if (!dryRun) {
    try {
      accessToken = await getAccessToken(serviceClient);
    } catch (err) {
      console.error(`${LOG_PREFIX} token error`, err);
      return json({
        ok: false,
        status: "failed",
        mode: "variation_group_relist",
        productId,
        message: "eBay not connected.",
        errors: ["ebay_not_connected"],
      }, 503);
    }
  }

  try {
    const result = await relistEbayVariationGroup({
      supabase: serviceClient,
      accessToken,
      productId,
      triggeringVariantId,
      preview: wantsPreview,
      liveEnabled: liveVariationRelistEnabled,
      syncContext: syncCtx,
      requestedBy: admin.userId,
    });

    const httpStatus = result.status === "failed" ? 502 : 200;
    return json(result, httpStatus);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} error`, message);
    return json({
      ok: false,
      status: "failed",
      mode: "variation_group_relist",
      productId,
      message,
      errors: [message],
    }, 500);
  }
});
