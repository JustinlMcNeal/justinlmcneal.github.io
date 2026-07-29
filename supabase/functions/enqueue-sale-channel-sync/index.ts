// enqueue-sale-channel-sync — Manual/test enqueue for sale sync jobs (Phase 061B.2).
// NOT wired to sale triggers. Admin or service role only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";
import {
  buildSalePushIdempotencyKey,
  type SaleSourceChannel,
} from "../_shared/saleChannelSyncTypes.ts";
import { enqueueSaleSyncJob } from "../_shared/saleSyncQueue.ts";

const LOG_PREFIX = "[enqueue-sale-channel-sync]";

type Payload = {
  sourceChannel?: unknown;
  productId?: unknown;
  variantId?: unknown;
  availableQty?: unknown;
  externalOrderId?: unknown;
  externalLineId?: unknown;
  reservationId?: unknown;
  holdActionId?: unknown;
  pushIdempotencyKey?: unknown;
  syncContext?: unknown;
  metadata?: unknown;
};

function parseSourceChannel(value: unknown): SaleSourceChannel | null {
  const s = String(value || "").toLowerCase();
  if (s === "kk" || s === "amazon" || s === "ebay") return s;
  return null;
}

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
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const sourceChannel = parseSourceChannel(body.sourceChannel);
  const variantId = String(body.variantId || "").trim();
  const externalOrderId = String(body.externalOrderId || "").trim();
  const externalLineId = String(body.externalLineId || "").trim();
  const availableQty = Number(body.availableQty);

  if (!sourceChannel || !variantId || !externalOrderId || !externalLineId) {
    return json({ ok: false, error: "missing_required_fields" }, 400);
  }
  if (!Number.isFinite(availableQty) || availableQty < 0) {
    return json({ ok: false, error: "invalid_available_qty" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const pushKey = typeof body.pushIdempotencyKey === "string" && body.pushIdempotencyKey.trim()
    ? body.pushIdempotencyKey.trim()
    : buildSalePushIdempotencyKey(sourceChannel, externalOrderId, externalLineId);

  try {
    const result = await enqueueSaleSyncJob({
      supabase: serviceClient,
      sourceChannel,
      productId: typeof body.productId === "string" ? body.productId : null,
      variantId,
      availableQty: Math.trunc(availableQty),
      externalOrderId,
      externalLineId,
      reservationId: typeof body.reservationId === "string" ? body.reservationId : null,
      holdActionId: typeof body.holdActionId === "string" ? body.holdActionId : null,
      pushIdempotencyKey: pushKey,
      syncContext: (body.syncContext && typeof body.syncContext === "object")
        ? body.syncContext as Record<string, unknown>
        : {
          trigger_source: "sale",
          trigger_reference_type: "order_line",
          trigger_reference_id: `${externalOrderId}:${externalLineId}`,
        },
      metadata: {
        ...(body.metadata && typeof body.metadata === "object" ? body.metadata as object : {}),
        enqueue_mode: "manual_test_061b2",
      },
    });

    return json({
      ok: true,
      testOnly: true,
      message: "Manual enqueue for 061B.2 testing — not wired to sale triggers.",
      ...result,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} error`, err);
    return json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
