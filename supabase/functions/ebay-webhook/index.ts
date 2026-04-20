// ebay-webhook — Receive eBay marketplace notifications (ItemSold, etc.)
// Phase 2: Real-time order ingestion instead of polling CRON
// Deploy with: --no-verify-jwt (eBay needs unauthenticated POST access)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  createServiceClient,
  getAccessToken,
  matchProduct,
  EBAY_API,
  KKProduct,
} from "../_shared/ebayUtils.ts";

// ── Helpers ─────────────────────────────────────────────────

function toCents(amount: string | number | undefined): number {
  if (amount == null) return 0;
  return Math.round(parseFloat(String(amount)) * 100);
}

/** SHA-256 hash for eBay challenge verification */
async function computeChallengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpointUrl: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(challengeCode + verificationToken + endpointUrl);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch a single eBay order by ID */
async function fetchEbayOrder(
  accessToken: string,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  const url = `${EBAY_API}/sell/fulfillment/v1/order/${orderId}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`[ebay-webhook] Fetch order ${orderId} failed (${resp.status}):`, errText.slice(0, 300));
    return null;
  }
  return await resp.json();
}

/** Insert an eBay order into orders_raw + line_items_raw + fulfillment_shipments
 *  (Same logic as ebay-sync-orders, extracted for reuse) */
async function insertEbayOrder(
  supabase: ReturnType<typeof createServiceClient>,
  order: Record<string, unknown>,
  products: KKProduct[],
): Promise<{ inserted: boolean; matched: number; unmatched: number }> {
  const orderId = order.orderId as string;
  const sessionId = `ebay_api_${orderId}`;

  // Dedup check — same logic as ebay-sync-orders
  const { data: existing } = await supabase
    .from("orders_raw")
    .select("id")
    .or(`stripe_checkout_session_id.eq.ebay_${orderId},stripe_checkout_session_id.eq.${sessionId}`)
    .maybeSingle();

  if (existing) {
    console.log(`[ebay-webhook] Order ${orderId} already exists, skipping`);
    return { inserted: false, matched: 0, unmatched: 0 };
  }

  // Extract buyer info
  const buyer = (order.buyer as Record<string, unknown>) || {};
  const shippingAddr =
    ((order.fulfillmentStartInstructions as unknown[]) || [])[0] as
      | Record<string, unknown>
      | undefined;
  const shipTo =
    (shippingAddr?.shippingStep as Record<string, unknown>)?.shipTo as
      | Record<string, unknown>
      | undefined;
  const contactAddr = shipTo?.contactAddress as Record<string, unknown> | undefined;
  const fullName = (shipTo?.fullName as string) || "";
  const nameParts = fullName.split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  const pricingSummary = order.pricingSummary as Record<string, unknown> || {};

  // Build order row
  const orderRow = {
    stripe_checkout_session_id: sessionId,
    kk_order_id: `EBAY-${orderId}`,
    first_name: firstName,
    last_name: lastName,
    email: "",
    street_address: [
      (contactAddr?.addressLine1 as string) || "",
      (contactAddr?.addressLine2 as string) || "",
    ].filter(Boolean).join(", "),
    city: (contactAddr?.city as string) || "",
    state: (contactAddr?.stateOrProvince as string) || "",
    zip: (contactAddr?.postalCode as string) || "",
    country: (contactAddr?.countryCode as string) || "US",
    order_date: order.creationDate as string,
    total_paid_cents: toCents((pricingSummary.total as Record<string, unknown>)?.value as string),
    subtotal_paid_cents: toCents((pricingSummary.priceSubtotal as Record<string, unknown>)?.value as string),
    tax_cents: toCents((pricingSummary.tax as Record<string, unknown>)?.value as string),
    shipping_paid_cents: toCents((pricingSummary.deliveryCost as Record<string, unknown>)?.value as string),
    total_items: ((order.lineItems as unknown[]) || []).length,
  };

  const { error: orderErr } = await supabase
    .from("orders_raw")
    .insert(orderRow);

  if (orderErr) {
    console.error(`[ebay-webhook] Order insert error for ${orderId}:`, orderErr.message);
    return { inserted: false, matched: 0, unmatched: 0 };
  }

  // Insert line items with product matching
  let matched = 0;
  let unmatched = 0;
  const lineItems = (order.lineItems as Record<string, unknown>[]) || [];

  for (const item of lineItems) {
    const ebayTitle = (item.title as string) || "Unknown";
    const productCode = matchProduct(ebayTitle, products);

    if (productCode) {
      matched++;
      console.log(`[ebay-webhook] Matched "${ebayTitle}" → ${productCode}`);
    } else {
      unmatched++;
      console.log(`[ebay-webhook] Unmatched: "${ebayTitle}"`);
    }

    const matchedProduct = productCode
      ? products.find(p => p.code === productCode)
      : null;

    const lineItemRow = {
      stripe_checkout_session_id: sessionId,
      stripe_line_item_id: `ebay_li_${item.lineItemId}`,
      product_id: productCode || null,
      product_name: matchedProduct?.name || ebayTitle,
      variant: (item.legacyVariationId as string) || null,
      quantity: (item.quantity as number) || 1,
      unit_price_cents: toCents((item.lineItemCost as Record<string, unknown>)?.value as string),
      post_discount_unit_price_cents: toCents(
        (item.discountedLineItemCost as Record<string, unknown>)?.value as string ||
        (item.lineItemCost as Record<string, unknown>)?.value as string
      ),
      order_date: order.creationDate as string,
    };

    const { error: lineErr } = await supabase
      .from("line_items_raw")
      .insert(lineItemRow);

    if (lineErr) {
      console.error(`[ebay-webhook] Line item insert error:`, lineErr.message);
    }
  }

  // Create fulfillment_shipments row (pending status for new orders)
  const shipmentRow = {
    stripe_checkout_session_id: sessionId,
    kk_order_id: `EBAY-${orderId}`,
    label_status: "pending",
    label_cost_cents: 0,
    carrier: null,
    service: null,
    tracking_number: null,
    notes: `eBay webhook order ${orderId}`,
  };

  const { error: shipErr } = await supabase
    .from("fulfillment_shipments")
    .upsert(shipmentRow, { onConflict: "stripe_checkout_session_id" });

  if (shipErr) {
    console.error(`[ebay-webhook] Shipment upsert error for ${orderId}:`, shipErr.message);
  }

  return { inserted: true, matched, unmatched };
}

// ── Main Handler ────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const VERIFICATION_TOKEN = Deno.env.get("EBAY_WEBHOOK_VERIFICATION_TOKEN") || "";
  const ENDPOINT_URL = Deno.env.get("EBAY_WEBHOOK_ENDPOINT_URL") || "";

  // ── GET: eBay challenge verification ──
  if (req.method === "GET") {
    const url = new URL(req.url);
    const challengeCode = url.searchParams.get("challenge_code");

    if (!challengeCode) {
      return new Response(
        JSON.stringify({ error: "Missing challenge_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const hashHex = await computeChallengeResponse(challengeCode, VERIFICATION_TOKEN, ENDPOINT_URL);
    console.log("[ebay-webhook] Challenge verified, responding with hash");

    return new Response(
      JSON.stringify({ challengeResponse: hashHex }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── POST: Notification from eBay ──
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const topic = body?.metadata?.topic as string || "";
      const notificationId = body?.notification?.notificationId || "unknown";

      console.log(`[ebay-webhook] Received: topic=${topic}, notificationId=${notificationId}`);

      const supabase = createServiceClient();

      // Update last_webhook_received_at for monitoring
      await supabase
        .from("marketplace_tokens")
        .update({
          extra: supabase.rpc ? undefined : undefined, // handled below
        })
        .eq("platform", "ebay");

      // Use raw SQL-style update for jsonb field
      const { data: tokenRow } = await supabase
        .from("marketplace_tokens")
        .select("extra")
        .eq("platform", "ebay")
        .single();

      const extra = (tokenRow?.extra as Record<string, unknown>) || {};
      extra.last_webhook_received_at = new Date().toISOString();
      extra.last_webhook_topic = topic;

      await supabase
        .from("marketplace_tokens")
        .update({ extra, updated_at: new Date().toISOString() })
        .eq("platform", "ebay");

      // ── Route by topic ──
      if (topic === "MARKETPLACE_ACCOUNT_DELETION") {
        // Already handled by ebay-account-deletion endpoint
        console.log("[ebay-webhook] Account deletion event — acknowledged");
        return new Response(null, { status: 200, headers: corsHeaders });
      }

      if (
        topic === "ORDER_CONFIRMATION" ||
        topic === "MARKETPLACE_ORDER_CREATED" ||
        topic === "MARKETPLACE_ORDER_PAID"
      ) {
        // eBay sends order data in the notification payload
        const notifData = body?.notification?.data as Record<string, unknown> || {};
        const resourceId = (notifData?.orderId as string) ||
                           (notifData?.resourceId as string) ||
                           (notifData?.resource?.orderId as string) || "";

        if (!resourceId) {
          console.error("[ebay-webhook] Order event missing orderId/resourceId");
          return new Response(null, { status: 200, headers: corsHeaders });
        }

        console.log(`[ebay-webhook] Processing order: ${resourceId}`);

        // Fetch full order details from eBay API
        const accessToken = await getAccessToken(supabase);
        const order = await fetchEbayOrder(accessToken, resourceId);

        if (!order) {
          console.error(`[ebay-webhook] Could not fetch order ${resourceId}`);
          return new Response(null, { status: 200, headers: corsHeaders });
        }

        // Load products for matching
        const { data: allProducts } = await supabase
          .from("products")
          .select("code, name");
        const products: KKProduct[] = (allProducts || []) as KKProduct[];

        const result = await insertEbayOrder(supabase, order, products);
        console.log(`[ebay-webhook] Order ${resourceId}: inserted=${result.inserted}, matched=${result.matched}, unmatched=${result.unmatched}`);

        return new Response(
          JSON.stringify({ success: true, ...result }),
          { status: 200, headers: corsHeaders },
        );
      }

      // ── Unhandled topic — acknowledge to prevent retries ──
      console.log(`[ebay-webhook] Unhandled topic: ${topic} — acknowledged`);
      return new Response(null, { status: 200, headers: corsHeaders });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ebay-webhook] Error:", msg);
      // Return 200 to prevent eBay retries on our errors
      // (eBay retries on non-200, which could cause duplicate processing)
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 200, headers: corsHeaders },
      );
    }
  }

  return new Response("Method not allowed", { status: 405, headers: corsHeaders });
});
