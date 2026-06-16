// Phase 10L — charge.refunded handler (order summary + observational enrichment + legacy stock).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type Stripe from "npm:stripe@17.7.0";
import {
  claimStripeInventoryDedup,
  DEDUP_REFUND_STOCK_RESTORE,
  getKkReservationMode,
  releaseKkActiveReservations,
  releaseKkShadowReservations,
  resolveDbLineVariant,
  restoreVariantStockForRefund,
} from "./stripeWebhookInventory.ts";
import {
  enrichRefundDetailsFromChargeEvent,
  resolveOrderSessionFromPaymentIntent,
} from "./stripeRefundDetails.ts";

function safeStr(v: unknown) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export type ChargeRefundedResult = {
  status: number;
  body: Record<string, unknown>;
};

/** Handle charge.refunded — legacy stock path unchanged; enrichment is observational only. */
export async function handleChargeRefundedEvent(opts: {
  sb: SupabaseClient;
  stripe: Stripe;
  event: Stripe.Event;
  charge: Stripe.Charge;
}): Promise<ChargeRefundedResult> {
  const { sb, stripe, event, charge } = opts;
  const paymentIntentId = safeStr(charge.payment_intent).trim();
  if (!paymentIntentId) {
    return { status: 200, body: { received: true, note: "no PI on charge" } };
  }

  const orderSessionId = await resolveOrderSessionFromPaymentIntent(stripe, sb, paymentIntentId);
  if (!orderSessionId) {
    console.error("[stripe-webhook] charge.refunded: could not find order for PI", paymentIntentId);
    return { status: 200, body: { received: true, warning: "Order not found for refund" } };
  }

  const totalRefundedCents = charge.amount_refunded ?? 0;
  const totalChargedCents = charge.amount ?? 0;
  const isFullRefund = totalRefundedCents >= totalChargedCents;
  const latestRefundId = charge.refunds?.data?.[0]?.id ?? null;

  const refundPatch = {
    refund_status: isFullRefund ? "full" : "partial",
    refund_amount_cents: totalRefundedCents,
    refunded_at: new Date().toISOString(),
    stripe_refund_id: latestRefundId,
    stripe_payment_intent_id: paymentIntentId,
    updated_at: new Date().toISOString(),
  };

  const { error: refErr } = await sb
    .from("orders_raw")
    .update(refundPatch)
    .eq("stripe_checkout_session_id", orderSessionId);

  if (refErr) {
    console.error("[stripe-webhook] refund update failed", refErr);
    return { status: 500, body: { error: "Failed to update refund", detail: refErr } };
  }

  console.log(
    `[stripe-webhook] Refund recorded: ${orderSessionId} → ${isFullRefund ? "FULL" : "PARTIAL"} $${(totalRefundedCents / 100).toFixed(2)}`,
  );

  let refundDetailEnrichment = { upserted: 0, failed: 0, refundsProcessed: 0 };
  try {
    refundDetailEnrichment = await enrichRefundDetailsFromChargeEvent({
      sb,
      stripe,
      charge,
      sessionId: orderSessionId,
      paymentIntentId,
    });
    if (refundDetailEnrichment.upserted > 0 || refundDetailEnrichment.failed > 0) {
      console.log(
        `[stripe-webhook] refund detail enrichment session=${orderSessionId} processed=${refundDetailEnrichment.refundsProcessed} upserted=${refundDetailEnrichment.upserted} failed=${refundDetailEnrichment.failed}`,
      );
    }
  } catch (enrichErr) {
    console.error("[stripe-webhook] refund detail enrichment failed (non-fatal):", enrichErr);
  }

  if (isFullRefund) {
    try {
      const kkMode = await getKkReservationMode(sb);
      const refundDedup = await claimStripeInventoryDedup(
        sb,
        event.id,
        DEDUP_REFUND_STOCK_RESTORE,
        orderSessionId,
      );

      if (!refundDedup.claimed) {
        console.log(
          `[stripe-webhook] refund inventory dedup skip event=${event.id} session=${orderSessionId}`,
        );
      } else if (kkMode === "reserve_only") {
        const released = await releaseKkActiveReservations(sb, orderSessionId, latestRefundId);
        if (released > 0) {
          console.log(
            `[stripe-webhook] active reservations released: ${released} for ${orderSessionId}`,
          );
        }
      } else {
        const { data: orderLines } = await sb
          .from("line_items_raw")
          .select("product_id, variant, variant_id, quantity")
          .eq("stripe_checkout_session_id", orderSessionId);

        for (const li of orderLines || []) {
          const qty = li.quantity || 1;
          const variantRow = await resolveDbLineVariant(sb, li);
          if (!variantRow) continue;

          await restoreVariantStockForRefund(sb, variantRow, qty, orderSessionId);
          console.log(
            `[stripe-webhook] stock refund: ${li.product_id || li.variant_id}/${li.variant} (+${qty})`,
          );
        }

        const released = await releaseKkShadowReservations(sb, orderSessionId, latestRefundId);
        if (released > 0) {
          console.log(
            `[stripe-webhook] shadow reservations released: ${released} for ${orderSessionId}`,
          );
        }
      }
    } catch (stockRefundErr) {
      console.error("[stripe-webhook] refund inventory failed (non-fatal):", stockRefundErr);
    }
  }

  return {
    status: 200,
    body: {
      received: true,
      type: "charge.refunded",
      orderSessionId,
      refund_status: refundPatch.refund_status,
      refund_amount_cents: totalRefundedCents,
      refund_details_upserted: refundDetailEnrichment.upserted,
    },
  };
}
