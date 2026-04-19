// ebay-sync-orders — Pull eBay orders via Fulfillment API, upsert to orders_raw + line_items_raw
// Now includes: product matching (fuzzy title → KK code), fulfillment/tracking capture
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  createServiceClient,
  getAccessToken,
  matchProduct,
  EBAY_API,
  KKProduct,
} from "../_shared/ebayUtils.ts";

/** Fetch orders from eBay Fulfillment API */
async function fetchEbayOrders(
  accessToken: string,
  daysBack: number
): Promise<unknown[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const orders: unknown[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const filter = `creationdate:[${since}..]`;
    const url = `${EBAY_API}/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[ebay-sync] API error ${resp.status}:`, errText);
      throw new Error(`eBay API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const pageOrders = data.orders || [];
    orders.push(...pageOrders);

    console.log(`[ebay-sync] Fetched ${pageOrders.length} orders (offset=${offset}, total=${data.total})`);

    if (offset + limit >= (data.total || 0)) break;
    offset += limit;
  }

  return orders;
}

/** Convert cents from eBay amount string (e.g., "12.99") */
function toCents(amount: string | number | undefined): number {
  if (amount == null) return 0;
  return Math.round(parseFloat(String(amount)) * 100);
}

/** Fetch shipping fulfillments (tracking) for a specific order */
async function fetchOrderFulfillments(
  accessToken: string,
  orderId: string
): Promise<Record<string, unknown>[]> {
  try {
    const url = `${EBAY_API}/sell/fulfillment/v1/order/${orderId}/shipping_fulfillment`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.fulfillments || []) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createServiceClient();

    // Accept optional daysBack parameter (default: 7)
    let daysBack = 7;
    try {
      const body = await req.json();
      if (body?.days_back) daysBack = Math.min(90, Math.max(1, body.days_back));
    } catch { /* no body is fine */ }

    const accessToken = await getAccessToken(supabase);
    const ebayOrders = await fetchEbayOrders(accessToken, daysBack);

    if (!ebayOrders.length) {
      return new Response(
        JSON.stringify({ success: true, synced: 0, message: "No orders found" }),
        { headers: corsHeaders }
      );
    }

    // Load all products for fuzzy matching
    const { data: allProducts } = await supabase
      .from("products")
      .select("code, name");
    const products: KKProduct[] = (allProducts || []) as KKProduct[];
    console.log(`[ebay-sync] Loaded ${products.length} products for matching`);

    let synced = 0;
    let skipped = 0;
    let matched = 0;
    let unmatched = 0;

    for (const order of ebayOrders as Record<string, unknown>[]) {
      const orderId = order.orderId as string;
      const sessionId = `ebay_api_${orderId}`;

      // Check for existing order (both CSV import and API import)
      const { data: existing } = await supabase
        .from("orders_raw")
        .select("id")
        .or(`stripe_checkout_session_id.eq.ebay_${orderId},stripe_checkout_session_id.eq.${sessionId}`)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
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
        email: (buyer.taxAddress as Record<string, unknown>)?.stateOrProvince
          ? "" : "", // eBay doesn't expose email via Fulfillment API
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
        console.error(`[ebay-sync] Order insert error for ${orderId}:`, orderErr.message);
        continue;
      }

      // Insert line items WITH product matching
      const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
      for (const item of lineItems) {
        const ebayTitle = (item.title as string) || "Unknown";
        const productCode = matchProduct(ebayTitle, products);
        if (productCode) {
          matched++;
          console.log(`[ebay-sync] Matched "${ebayTitle}" → ${productCode}`);
        } else {
          unmatched++;
          console.log(`[ebay-sync] Unmatched: "${ebayTitle}"`);
        }

        // Use the matched product's canonical name if found
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
          console.error(`[ebay-sync] Line item insert error:`, lineErr.message);
        }
      }

      // Extract fulfillment/tracking data from eBay order
      const orderFulfillmentStatus = order.orderFulfillmentStatus as string || "";

      // Map eBay fulfillment status → our label_status
      let labelStatus = "pending";
      if (orderFulfillmentStatus === "FULFILLED") labelStatus = "shipped";
      else if (orderFulfillmentStatus === "IN_PROGRESS") labelStatus = "label_purchased";

      // Fetch actual tracking info from eBay shipping fulfillments endpoint
      let carrier: string | null = "eBay";
      let service: string | null = "eBay Shipping";
      let trackingNumber: string | null = null;
      let shippedAt: string | null = null;

      if (orderFulfillmentStatus === "FULFILLED" || orderFulfillmentStatus === "IN_PROGRESS") {
        const fulfillments = await fetchOrderFulfillments(accessToken, orderId);
        if (fulfillments.length > 0) {
          const ff = fulfillments[0];
          const shipmentItems = (ff.shipmentTrackingNumber as string) || null;
          trackingNumber = shipmentItems;
          carrier = (ff.shippingCarrierCode as string) || "eBay";
          shippedAt = (ff.shippedDate as string) || null;
          console.log(`[ebay-sync] Tracking for ${orderId}: ${carrier} ${trackingNumber}`);
        }
      }

      // Build fulfillment_shipments row
      const shipmentRow: Record<string, unknown> = {
        stripe_checkout_session_id: sessionId,
        kk_order_id: `EBAY-${orderId}`,
        label_status: labelStatus,
        label_cost_cents: 0, // Handled by Finances API sync
        carrier,
        service,
        tracking_number: trackingNumber,
        notes: `eBay order ${orderId}, fulfillment status: ${orderFulfillmentStatus || "UNKNOWN"}`,
      };

      if (shippedAt) {
        shipmentRow.shipped_at = shippedAt;
      } else if (labelStatus === "shipped") {
        shipmentRow.shipped_at = order.creationDate as string;
      }

      const { error: shipErr } = await supabase
        .from("fulfillment_shipments")
        .upsert(shipmentRow, { onConflict: "stripe_checkout_session_id" });

      if (shipErr) {
        console.error(`[ebay-sync] Shipment upsert error for ${orderId}:`, shipErr.message);
      }

      synced++;
    }

    console.log(`[ebay-sync] Done: synced=${synced}, skipped=${skipped}, matched=${matched}, unmatched=${unmatched}`);

    return new Response(
      JSON.stringify({ success: true, synced, skipped, matched, unmatched, total: ebayOrders.length }),
      { headers: corsHeaders }
    );
  } catch (err: unknown) {
    console.error("[ebay-sync] Error:", err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
