// supabase/functions/shippo-webhook/index.ts
// Receives Shippo webhook events (track_updated) and updates fulfillment_shipments
// Also triggers transactional SMS for shipped + delivered statuses
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  finalizeKkOrderReservations,
  isKkStoreSession,
  shouldFinalizeOnShippoTracking,
} from "../_shared/finalizeKkReservations.ts";
import { recordBundleFinalizeShadowsForOrder } from "../_shared/bundleCheckoutShadow.ts";

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

/** Higher rank = later in the fulfillment lifecycle. Never move backward. */
const LABEL_STATUS_RANK: Record<string, number> = {
  pending: 0,
  label_purchased: 1,
  shipped: 2,
  failed: 2,
  delivered: 3,
  returned: 4,
  // Admin / money statuses — Shippo must not overwrite these
  voided: 100,
  refunded: 100,
  partial_refund: 100,
};

function labelStatusRank(status: string | null | undefined): number {
  return LABEL_STATUS_RANK[String(status || "pending")] ?? 0;
}

/** True when next status is same or later than prev (no regression). */
function shouldApplyLabelStatus(prev: string | null | undefined, next: string): boolean {
  return labelStatusRank(next) >= labelStatusRank(prev);
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
      const mappedStatus = mapStatus(currentStatus);
      const now = new Date().toISOString();

      // Find the shipment row by tracking number
      const { data: shipment, error: lookupErr } = await sb
        .from("fulfillment_shipments")
        .select("stripe_checkout_session_id, kk_order_id, label_status, tracking_number, delivered_at")
        .eq("tracking_number", trackingNumber)
        .single();

      if (lookupErr || !shipment) {
        logStatus = "ignored";
        logError = `No shipment found for tracking ${trackingNumber}`;
        console.warn("[shippo-webhook]", logError);
      } else {
        // Heal rows that already have delivered_at but were regressively set back to shipped
        const prevStatus =
          shipment.delivered_at && labelStatusRank(shipment.label_status) < labelStatusRank("delivered")
            ? "delivered"
            : shipment.label_status;

        const applyStatus = shouldApplyLabelStatus(prevStatus, mappedStatus);
        const newLabelStatus = applyStatus ? mappedStatus : prevStatus;

        // Build update object — always refresh sync timestamp / ETA
        const update: Record<string, unknown> = {
          last_tracking_sync_at: now,
        };

        if (applyStatus) {
          update.label_status = newLabelStatus;
        } else if (prevStatus !== shipment.label_status) {
          // Heal inconsistent DB row even when this event would have regressed
          update.label_status = prevStatus;
        }

        if (eta) update.estimated_delivery = eta;

        // Set timestamps based on status
        if (currentStatus === "TRANSIT" && prevStatus !== "shipped" && prevStatus !== "delivered") {
          update.in_transit_at = now;
          update.shipped_at = now;
        }
        if (currentStatus === "DELIVERED") {
          update.delivered_at = now;
          update.label_status = "delivered";
        }
        if (currentStatus === "RETURNED") {
          update.returned_at = now;
        }

        if (!applyStatus && currentStatus !== "DELIVERED" && prevStatus === shipment.label_status) {
          console.log(
            `[shippo-webhook] ${trackingNumber} skip status regression ${shipment.label_status} ← ${mappedStatus} | order=${shipment.kk_order_id}`,
          );
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
          const subStatus = trackingStatus?.substatus as string || "";
          const effectiveNext =
            (update.label_status as string | undefined) || shipment.label_status;
          console.log(`[shippo-webhook] ${trackingNumber} ${shipment.label_status} → ${effectiveNext}${subStatus ? ` (${subStatus})` : ""} | order=${shipment.kk_order_id}`);

          // ── 3. Send SMS notifications for shipped / delivered ──
          const shouldNotify =
            (currentStatus === "TRANSIT" && prevStatus !== "shipped" && prevStatus !== "delivered") ||
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

          // ── 5. Finalize inventory reservations on in-transit / delivery (KK + marketplace) ──
          if (shouldFinalizeOnShippoTracking(currentStatus, shipment.label_status)) {
            try {
              const fin = await finalizeKkOrderReservations(
                sb,
                shipment.stripe_checkout_session_id,
                trackingNumber || shipment.stripe_checkout_session_id,
                "shippo_track_updated",
              );
              if (fin && (fin.finalized_count ?? 0) > 0) {
                console.log(
                  `[shippo-webhook] reservations finalized: order=${shipment.kk_order_id} channel=${fin.channel || "?"} units=${fin.finalized_units}`,
                );
              }

              try {
                const bundleFin = await recordBundleFinalizeShadowsForOrder(sb, {
                  orderId: shipment.stripe_checkout_session_id,
                  referenceId: trackingNumber || shipment.stripe_checkout_session_id,
                  source: "shippo_track_updated",
                });
                if (bundleFin.inserted > 0) {
                  console.log(
                    `[shippo-webhook] bundle finalize shadows: inserted=${bundleFin.inserted}`,
                  );
                }
              } catch (bundleFinErr: unknown) {
                console.error(
                  "[shippo-webhook] bundle finalize shadow failed (non-fatal):",
                  bundleFinErr instanceof Error ? bundleFinErr.message : String(bundleFinErr),
                );
              }
            } catch (finErr: unknown) {
              console.error(
                "[shippo-webhook] KK reservation finalize failed (non-fatal):",
                finErr instanceof Error ? finErr.message : String(finErr),
              );
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

// ── SMS helper: send shipped/delivered notification (KK website orders only) ──
async function sendTrackingSms(
  sb: ReturnType<typeof createClient>,
  sessionId: string,
  kkOrderId: string,
  shippoStatus: string,
  trackingNumber: string,
  carrier: string,
) {
  if (!isKkStoreSession(sessionId)) {
    console.log("[shippo-webhook] Skip shipping SMS for marketplace order", kkOrderId);
    return;
  }

  // Look up the customer's phone from orders_raw
  const { data: order, error: orderErr } = await sb
    .from("orders_raw")
    .select("phone_number, first_name, last_name, kk_order_id")
    .eq("stripe_checkout_session_id", sessionId)
    .single();

  if (orderErr) {
    console.error("[shippo-webhook] Order lookup for SMS failed:", orderErr.message);
    return;
  }

  if (!order?.phone_number) {
    console.log("[shippo-webhook] No phone number for order", kkOrderId);
    return;
  }

  // Look up contact if exists (for contact_id logging), but don't require consent
  // Shipping notifications are transactional — no opt-in required under TCPA
  const { data: contact } = await sb
    .from("customer_contacts")
    .select("id")
    .eq("phone", order.phone_number)
    .maybeSingle();

  const firstName = String(order.first_name || "").trim() || "there";
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
    contact_id: contact?.id || null,
    skip_caps: true,
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
    body: JSON.stringify({ batch: true, session_id: sessionId }),
  });

  const result = await res.json();
  console.log(`[shippo-webhook] Review request for ${sessionId}:`, JSON.stringify(result));
}
