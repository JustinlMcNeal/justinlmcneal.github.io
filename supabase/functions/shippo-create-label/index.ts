// supabase/functions/shippo-create-label/index.ts
// Buy a USPS shipping label for one order via Shippo.
// Idempotent: refuses to purchase if a non-voided label already exists.
// Phase 1c: After label purchase, auto-pushes tracking to eBay for eBay orders.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAccessToken, EBAY_API } from "../_shared/ebayUtils.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const shippoKey   = Deno.env.get("SHIPPO_API_KEY")!;

const SHIPPO_BASE = "https://api.goshippo.com";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function shippo(path: string, method = "GET", body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: {
      "Authorization": `ShippoToken ${shippoKey}`,
      "Content-Type":  "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SHIPPO_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) {
    const msg = typeof data === "object" ? JSON.stringify(data) : String(data);
    throw new Error(`Shippo ${method} ${path} ${res.status}: ${msg}`);
  }
  return data;
}

interface CreateLabelRequest {
  stripe_checkout_session_id: string;
  preset_id?: string; // UUID from package_presets — null → use default
}

// ── eBay Carrier Code Mapping ──
const CARRIER_MAP: Record<string, string> = {
  usps: "USPS", ups: "UPS", fedex: "FEDEX", dhl_express: "DHL",
};

/** Push tracking number to eBay Fulfillment API for eBay orders */
async function pushTrackingToEbay(
  sb: ReturnType<typeof createClient>,
  sessionId: string,
  trackingNumber: string,
  carrier: string,
) {
  const ebayOrderId = sessionId.replace("ebay_api_", "");
  const ebayCarrier = CARRIER_MAP[carrier.toLowerCase()] || carrier.toUpperCase();

  // Resolve eBay line item IDs from our DB
  const { data: lineItems } = await sb
    .from("line_items_raw")
    .select("stripe_line_item_id, quantity")
    .eq("stripe_checkout_session_id", sessionId);

  if (!lineItems?.length) {
    throw new Error(`No line items found for eBay order ${ebayOrderId}`);
  }

  const ebayLineItems = lineItems.map((li) => ({
    lineItemId: li.stripe_line_item_id.replace("ebay_li_", ""),
    quantity: li.quantity || 1,
  }));

  const token = await getAccessToken(sb);

  const resp = await fetch(
    `${EBAY_API}/sell/fulfillment/v1/order/${ebayOrderId}/shipping_fulfillment`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Language": "en-US",
      },
      body: JSON.stringify({
        trackingNumber,
        shippingCarrierCode: ebayCarrier,
        lineItems: ebayLineItems,
      }),
    },
  );

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`eBay fulfillment POST ${resp.status}: ${errBody}`);
  }

  // Extract fulfillmentId from Location header (eBay returns it there on 201)
  const location = resp.headers.get("Location") || "";
  const fulfillmentId = location.split("/").pop() || "";

  return fulfillmentId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { stripe_checkout_session_id, preset_id } = (await req.json()) as CreateLabelRequest;
    if (!stripe_checkout_session_id) return json({ error: "Missing stripe_checkout_session_id" }, 400);

    const sb = createClient(supabaseUrl, serviceKey);

    // ── 1. Idempotency check ──
    const { data: existing } = await sb
      .from("fulfillment_shipments")
      .select("shippo_transaction_id, label_status, label_url, tracking_number, carrier, service, label_cost_cents")
      .eq("stripe_checkout_session_id", stripe_checkout_session_id)
      .single();

    if (existing?.shippo_transaction_id && existing.label_status !== "voided") {
      return json({
        success: true,
        duplicate: true,
        data: {
          tracking_number: existing.tracking_number,
          label_url:       existing.label_url,
          carrier:         existing.carrier,
          service:         existing.service,
          label_cost_cents: existing.label_cost_cents,
        },
      });
    }

    // ── 2. Fetch order ──
    const { data: order, error: orderErr } = await sb
      .from("orders_raw")
      .select("kk_order_id, first_name, last_name, email, phone_number, street_address, city, state, zip, country, total_weight_g")
      .eq("stripe_checkout_session_id", stripe_checkout_session_id)
      .single();

    if (orderErr || !order) {
      console.error("[shippo-create-label] order lookup failed:", JSON.stringify({ orderErr, sessionId: stripe_checkout_session_id }));
      return json({ error: "Order not found", detail: orderErr?.message || "no data" }, 404);
    }

    // ── 3. Fetch package preset ──
    let presetQuery = sb.from("package_presets").select("*");
    if (preset_id) {
      presetQuery = presetQuery.eq("id", preset_id);
    } else {
      presetQuery = presetQuery.eq("is_default", true);
    }
    const { data: preset } = await presetQuery.single();
    if (!preset) return json({ error: "Package preset not found" }, 404);

    // ── 4. Fetch ship-from address ──
    const { data: fromSetting } = await sb
      .from("site_settings")
      .select("value")
      .eq("key", "ship_from_address")
      .single();

    if (!fromSetting?.value) return json({ error: "Ship-from address not configured" }, 500);
    const fromAddr = fromSetting.value;

    // ── 5. Build Shippo shipment ──
    const weightOz = Math.max(1, Math.round((order.total_weight_g || 100) / 28.3495));
    const parcel: Record<string, unknown> = {
      length: String(preset.length_in),
      width:  String(preset.width_in),
      height: String(preset.height_in ?? 1), // flat → 1"
      distance_unit: "in",
      weight: String(weightOz),
      mass_unit: "oz",
    };

    const shipment = await shippo("/shipments/", "POST", {
      address_from: {
        name:    fromAddr.name,
        street1: fromAddr.street1,
        city:    fromAddr.city,
        state:   fromAddr.state,
        zip:     fromAddr.zip,
        country: fromAddr.country || "US",
        phone:   fromAddr.phone,
        email:   fromAddr.email,
      },
      address_to: {
        name:    `${order.first_name || ""} ${order.last_name || ""}`.trim(),
        street1: order.street_address,
        city:    order.city,
        state:   order.state,
        zip:     order.zip,
        country: order.country || "US",
        phone:   order.phone_number || "",
        email:   order.email || "",
      },
      parcels: [parcel],
      async: false,
    });

    // ── 6. Pick cheapest USPS rate ──
    const uspsRates = (shipment.rates || [])
      .filter((r: { provider: string }) => r.provider === "USPS")
      .sort((a: { amount: string }, b: { amount: string }) => parseFloat(a.amount) - parseFloat(b.amount));

    if (!uspsRates.length) {
      return json({ error: "No USPS rates available for this shipment", shipment_id: shipment.object_id }, 422);
    }

    const cheapest = uspsRates[0];

    // ── 7. Purchase the label (transaction) ──
    const transaction = await shippo("/transactions/", "POST", {
      rate: cheapest.object_id,
      label_file_type: "PNG",
      async: false,
    });

    if (transaction.status !== "SUCCESS") {
      const msgs = (transaction.messages || []).map((m: { text: string }) => m.text).join("; ");
      return json({ error: `Label purchase failed: ${msgs || transaction.status}` }, 422);
    }

    // ── 8. Download label PNG → upload to Supabase Storage ──
    let storagePath: string | null = null;
    try {
      const pngRes = await fetch(transaction.label_url);
      if (pngRes.ok) {
        const pngBlob = await pngRes.blob();
        const filePath = `${order.kk_order_id || stripe_checkout_session_id}.png`;
        const { error: uploadErr } = await sb.storage
          .from("labels")
          .upload(filePath, pngBlob, { contentType: "image/png", upsert: true });

        if (!uploadErr) storagePath = filePath;
        else console.error("[shippo-create-label] Storage upload error:", uploadErr.message);
      }
    } catch (dlErr: unknown) {
      console.error("[shippo-create-label] Label download error:", dlErr instanceof Error ? dlErr.message : String(dlErr));
    }

    // ── 9. Update fulfillment_shipments ──
    const nowIso = new Date().toISOString();
    const labelCostCents = Math.round(parseFloat(cheapest.amount) * 100);

    const { error: upsertErr } = await sb
      .from("fulfillment_shipments")
      .upsert({
        stripe_checkout_session_id,
        kk_order_id: order.kk_order_id,
        label_status: "label_purchased",
        shippo_transaction_id: transaction.object_id,
        shippo_rate_id: cheapest.object_id,
        tracking_number: transaction.tracking_number,
        tracking_url: transaction.tracking_url_provider,
        carrier: cheapest.provider,
        service: cheapest.servicelevel?.name || cheapest.servicelevel_name || "",
        label_cost_cents: labelCostCents,
        label_url: storagePath, // Supabase Storage path (not Shippo URL)
        label_purchased_at: nowIso,
        updated_at: nowIso,
      }, { onConflict: "stripe_checkout_session_id" });

    if (upsertErr) {
      console.error("[shippo-create-label] upsert error:", upsertErr.message);
      // Label was purchased but DB write failed — return label data anyway
      return json({
        success: true,
        warning: "Label purchased but DB update failed — tracking saved in Shippo",
        data: {
          tracking_number: transaction.tracking_number,
          label_cost_cents: labelCostCents,
          carrier: cheapest.provider,
          service: cheapest.servicelevel?.name || "",
          transaction_id: transaction.object_id,
        },
      });
    }

    // ── 10. Push tracking to eBay (if eBay order) ──
    let trackingPushedToEbay = false;
    let ebayFulfillmentId: string | null = null;
    if (stripe_checkout_session_id.startsWith("ebay_api_")) {
      try {
        ebayFulfillmentId = await pushTrackingToEbay(
          sb, stripe_checkout_session_id, transaction.tracking_number, cheapest.provider,
        );
        trackingPushedToEbay = true;
        console.log(`[shippo-create-label] eBay tracking pushed: fulfillmentId=${ebayFulfillmentId}`);
      } catch (ebayErr: unknown) {
        const ebayMsg = ebayErr instanceof Error ? ebayErr.message : String(ebayErr);
        console.error("[shippo-create-label] eBay tracking push failed:", ebayMsg);
        // Don't fail — label is already purchased. Admin can retry.
      }

      // Update fulfillment_shipments with eBay sync status
      await sb
        .from("fulfillment_shipments")
        .update({
          tracking_pushed_to_ebay: trackingPushedToEbay,
          ebay_fulfillment_id: ebayFulfillmentId,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_checkout_session_id", stripe_checkout_session_id);
    }

    return json({
      success: true,
      data: {
        tracking_number:  transaction.tracking_number,
        tracking_url:     transaction.tracking_url_provider,
        label_url:        storagePath,
        carrier:          cheapest.provider,
        service:          cheapest.servicelevel?.name || cheapest.servicelevel_name || "",
        label_cost_cents: labelCostCents,
        transaction_id:   transaction.object_id,
        rate_amount:      cheapest.amount,
        estimated_days:   cheapest.estimated_days,
        tracking_pushed_to_ebay: trackingPushedToEbay,
        ebay_fulfillment_id: ebayFulfillmentId,
      },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[shippo-create-label] error:", msg);
    return json({ error: msg }, 500);
  }
});
