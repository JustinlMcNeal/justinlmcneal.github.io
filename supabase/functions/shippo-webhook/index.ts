// supabase/functions/shippo-webhook/index.ts
// Receives Shippo webhook events (track_updated) and updates fulfillment_shipments
// Also triggers transactional SMS for shipped + delivered statuses
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Map Shippo tracking status → our label_status
function mapStatus(shippoStatus: string): string {
  switch (shippoStatus) {
    case "PRE_TRANSIT":  return "label_purchased";
    case "TRANSIT":      return "shipped";
    case "DELIVERED":    return "delivered";
    case "RETURNED":     return "returned";
    case "FAILURE":      return "failed";
    default:             return "shipped"; // UNKNOWN → treat as shipped
  }
}

Deno.serve(async (req) => {
  // Shippo sends POST only — reject others
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const sb = createClient(supabaseUrl, serviceKey);
  let rawPayload: unknown;

  try {
    rawPayload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const payload = rawPayload as Record<string, unknown>;
  const event = payload.event as string | undefined;
  const data = payload.data as Record<string, unknown> | undefined;

  if (!event || !data) {
    return json({ error: "Missing event or data" }, 400);
  }

  const trackingNumber = data.tracking_number as string | undefined;
  const carrier = (data.carrier as string || "").toUpperCase();
  const trackingStatus = data.tracking_status as Record<string, unknown> | undefined;
  const currentStatus = trackingStatus?.status as string | undefined;
  const eta = data.eta as string | null;

  // ── 1. Log the webhook event ──
  let logStatus = "processed";
  let logError: string | null = null;

  try {
    // ── 2. Handle track_updated events ──
    if (event === "track_updated" && trackingNumber && currentStatus) {
      const newLabelStatus = mapStatus(currentStatus);
      const now = new Date().toISOString();

      // Find the shipment row by tracking number
      const { data: shipment, error: lookupErr } = await sb
        .from("fulfillment_shipments")
        .select("stripe_checkout_session_id, kk_order_id, label_status, tracking_number")
        .eq("tracking_number", trackingNumber)
        .single();

      if (lookupErr || !shipment) {
        logStatus = "ignored";
        logError = `No shipment found for tracking ${trackingNumber}`;
        console.warn("[shippo-webhook]", logError);
      } else {
        // Build update object
        const update: Record<string, unknown> = {
          label_status: newLabelStatus,
          last_tracking_sync_at: now,
        };

        if (eta) update.estimated_delivery = eta;

        // Set timestamps based on status
        if (currentStatus === "TRANSIT" && shipment.label_status !== "shipped") {
          update.in_transit_at = now;
          update.shipped_at = now;
        }
        if (currentStatus === "DELIVERED") {
          update.delivered_at = now;
        }
        if (currentStatus === "RETURNED") {
          update.returned_at = now;
        }

        const { error: updateErr } = await sb
          .from("fulfillment_shipments")
          .update(update)
          .eq("stripe_checkout_session_id", shipment.stripe_checkout_session_id);

        if (updateErr) {
          logStatus = "error";
          logError = updateErr.message;
          console.error("[shippo-webhook] Update error:", updateErr.message);
        } else {
          console.log(`[shippo-webhook] ${trackingNumber}: ${shipment.label_status} → ${newLabelStatus}`);

          // ── 3. Send SMS notifications for shipped / delivered ──
          const prevStatus = shipment.label_status;
          const shouldNotify =
            (currentStatus === "TRANSIT" && prevStatus !== "shipped") ||
            (currentStatus === "DELIVERED" && prevStatus !== "delivered");

          if (shouldNotify) {
            try {
              await sendTrackingSms(sb, shipment.stripe_checkout_session_id, shipment.kk_order_id, currentStatus, trackingNumber, carrier);
            } catch (smsErr: unknown) {
              console.error("[shippo-webhook] SMS error:", smsErr instanceof Error ? smsErr.message : String(smsErr));
              // Don't fail the webhook for SMS errors
            }
          }

          // ── 4. Trigger review request on delivery ──
          if (currentStatus === "DELIVERED" && prevStatus !== "delivered") {
            try {
              await triggerReviewRequest(shipment.stripe_checkout_session_id);
            } catch (rrErr: unknown) {
              console.error("[shippo-webhook] Review request error:", rrErr instanceof Error ? rrErr.message : String(rrErr));
            }
          }
        }
      }
    } else if (event !== "track_updated") {
      logStatus = "ignored";
      logError = `Unhandled event type: ${event}`;
    }
  } catch (err: unknown) {
    logStatus = "error";
    logError = err instanceof Error ? err.message : String(err);
    console.error("[shippo-webhook] Processing error:", logError);
  }

  // ── Always log the event ──
  await sb.from("shippo_webhook_events").insert({
    event_type: event,
    tracking_number: trackingNumber || null,
    carrier: carrier || null,
    payload_json: payload,
    status: logStatus,
    error_message: logError,
  }).then(({ error }) => {
    if (error) console.error("[shippo-webhook] Failed to log event:", error.message);
  });

  // Shippo expects 2XX within 3 seconds
  return json({ ok: true, status: logStatus });
});

// ── SMS helper: send shipped/delivered notification ──
async function sendTrackingSms(
  sb: ReturnType<typeof createClient>,
  sessionId: string,
  kkOrderId: string,
  shippoStatus: string,
  trackingNumber: string,
  carrier: string,
) {
  // Look up the customer's phone from orders_raw
  const { data: order } = await sb
    .from("orders_raw")
    .select("phone_number, customer_name, kk_order_id")
    .eq("stripe_checkout_session_id", sessionId)
    .single();

  if (!order?.phone_number) {
    console.log("[shippo-webhook] No phone number for order", kkOrderId);
    return;
  }

  // Check SMS consent
  const { data: contact } = await sb
    .from("customer_contacts")
    .select("id, sms_consent, status")
    .eq("phone", order.phone_number)
    .single();

  if (!contact || !contact.sms_consent || contact.status !== "active") {
    console.log("[shippo-webhook] No SMS consent for", order.phone_number);
    return;
  }

  const firstName = (order.customer_name || "").split(" ")[0] || "there";
  const trackUrl = carrier === "USPS"
    ? `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`
    : `https://karrykraze.com/pages/my-orders.html`;

  let body: string;
  if (shippoStatus === "TRANSIT") {
    body = `Hey ${firstName}! 🎉 Your Karry Kraze order ${kkOrderId} has shipped!\n\nTracking: ${trackUrl}\n\nReply STOP to opt out`;
  } else {
    body = `Hi ${firstName}! 📦 Your Karry Kraze order ${kkOrderId} has been delivered!\n\nLove your items? We'd love a review: https://karrykraze.com/pages/reviews.html\n\nReply STOP to opt out`;
  }

  // Call the internal send-sms function
  const smsPayload = {
    to: order.phone_number,
    body,
    message_type: "shipping_notification",
    intent: "transactional",
    campaign: shippoStatus === "TRANSIT" ? "shipping_shipped" : "shipping_delivered",
    contact_id: contact.id,
  };

  const smsRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(smsPayload),
  });

  const smsResult = await smsRes.json();
  console.log(`[shippo-webhook] SMS ${shippoStatus} for ${kkOrderId}:`, JSON.stringify(smsResult));
}

// ── Trigger review request after delivery ──
async function triggerReviewRequest(sessionId: string) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-review-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ order_session_id: sessionId }),
  });

  const result = await res.json();
  console.log(`[shippo-webhook] Review request for ${sessionId}:`, JSON.stringify(result));
}
