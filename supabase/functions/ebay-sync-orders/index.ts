// ebay-sync-orders — Pull eBay orders via Fulfillment API, upsert to orders_raw + line_items_raw
// Now includes: product matching (fuzzy title → KK code), fulfillment/tracking capture
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json",
};

const EBAY_API = "https://api.ebay.com";

// ── Product matching (ported from ebayImport.js) ────────────────

interface KKProduct {
  code: string;
  name: string;
}

/** Normalize string for fuzzy matching — lowercase, strip punctuation, collapse whitespace */
function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Crude stemmer: strip common English suffixes */
function stem(w: string): string {
  return w.replace(/ies$/, "y").replace(/es$/, "").replace(/s$/, "");
}

/**
 * Match an eBay item title to a KK product.
 * Strategy: exact → bracket-strip → substring → token-overlap (≥2 shared roots)
 */
function matchProduct(ebayTitle: string, products: KKProduct[]): string | null {
  const t = norm(ebayTitle);
  if (!t) return null;

  const tNoBrackets = norm((ebayTitle || "").replace(/\[[^\]]*\]/g, ""));

  // Pass 1 — exact
  for (const p of products) {
    const n = norm(p.name);
    if (n === t || n === tNoBrackets) return p.code;
  }

  // Pass 2 — substring
  for (const p of products) {
    const n = norm(p.name);
    if (t.includes(n) || n.includes(t)) return p.code;
    if (tNoBrackets && (tNoBrackets.includes(n) || n.includes(tNoBrackets))) return p.code;
  }

  // Pass 3 — token overlap with stemming (≥2 shared tokens)
  const tTokens = new Set(t.split(" ").filter(w => w.length > 2).map(stem));
  let bestCode: string | null = null;
  let bestScore = 1;
  for (const p of products) {
    const pTokens = norm(p.name).split(" ").filter(w => w.length > 2).map(stem);
    let score = 0;
    for (const w of pTokens) if (tTokens.has(w)) score++;
    if (score > bestScore) { bestScore = score; bestCode = p.code; }
  }
  return bestCode;
}

/** Ensure we have a valid access token, refreshing if expired */
async function getAccessToken(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: tokenRow } = await supabase
    .from("marketplace_tokens")
    .select("*")
    .eq("platform", "ebay")
    .single();

  if (!tokenRow?.access_token) throw new Error("eBay not connected");

  // Check if token is still valid (with 5-min buffer)
  const expiresAt = new Date(tokenRow.token_expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  // Token expired — refresh it
  console.log("[ebay-sync] Access token expired, refreshing...");
  const clientId = Deno.env.get("EBAY_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET") || "";
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const scopes = [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.finances",
  ].join(" ");

  const resp = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
      scope: scopes,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  }

  const newExpiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString();

  await supabase
    .from("marketplace_tokens")
    .update({
      access_token: data.access_token,
      token_expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("platform", "ebay");

  console.log("[ebay-sync] Token refreshed, new expiry:", newExpiresAt);
  return data.access_token;
}

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceKey);

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
