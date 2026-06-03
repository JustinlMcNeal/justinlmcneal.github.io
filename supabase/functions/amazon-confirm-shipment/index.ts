// amazon-confirm-shipment — Push Shippo tracking to Amazon (confirmShipment).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersJson, json, requireAdminJson } from "../_shared/amazonAuthUtils.ts";
import {
  amazonOrderIdFromSession,
  confirmAmazonShipment,
} from "../_shared/amazonConfirmShipmentUtils.ts";
import { resolveAmazonCredentials } from "../_shared/amazonPtdAuthUtils.ts";
import { isSyncEnvConfigured, readSyncEnvConfig } from "../_shared/amazonSyncAccountUtils.ts";

const LOG_PREFIX = "[amazon-confirm-shipment]";

type Payload = {
  stripe_checkout_session_id?: unknown;
  sellerAccountId?: unknown;
  marketplaceId?: unknown;
};

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
  const syncEnv = readSyncEnvConfig();

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !isSyncEnvConfigured(syncEnv)) {
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
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const sessionId = typeof body.stripe_checkout_session_id === "string"
    ? body.stripe_checkout_session_id.trim()
    : "";
  if (!sessionId.startsWith("amazon_")) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const amazonOrderId = amazonOrderIdFromSession(sessionId);
  if (!amazonOrderId) return json({ ok: false, error: "invalid_request" }, 400);

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const sellerAccountId = typeof body.sellerAccountId === "string" && body.sellerAccountId.trim()
    ? body.sellerAccountId.trim()
    : null;

  const [{ data: shipment }, { data: lineItems }] = await Promise.all([
    serviceClient
      .from("fulfillment_shipments")
      .select("tracking_number, carrier, tracking_pushed_to_amazon")
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle(),
    serviceClient
      .from("line_items_raw")
      .select("stripe_line_item_id, quantity")
      .eq("stripe_checkout_session_id", sessionId),
  ]);

  if (!shipment?.tracking_number) {
    return json({ ok: false, error: "missing_tracking" }, 400);
  }

  const credResult = await resolveAmazonCredentials(serviceClient, sellerAccountId, syncEnv);
  if (!credResult.ok) return json({ ok: false, error: credResult.error }, 400);

  const marketplaceId = typeof body.marketplaceId === "string" && body.marketplaceId.trim()
    ? body.marketplaceId.trim()
    : credResult.creds.account.marketplace_ids?.[0] || "ATVPDKIKX0DER";

  const confirmResult = await confirmAmazonShipment(credResult.creds, {
    amazonOrderId,
    marketplaceId,
    trackingNumber: String(shipment.tracking_number),
    carrier: String(shipment.carrier || "USPS"),
    lineItems: (lineItems || []) as Array<{ stripe_line_item_id: string; quantity: number | null }>,
  });

  if (!confirmResult.ok) {
    return json(
      { ok: false, error: confirmResult.error, hint: confirmResult.hint },
      502,
    );
  }

  await serviceClient
    .from("fulfillment_shipments")
    .update({
      tracking_pushed_to_amazon: true,
      label_status: "shipped",
      shipped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_checkout_session_id", sessionId);

  return json({ ok: true, success: true, amazon_order_id: amazonOrderId });
});
