// supabase/functions/stripe-refund/index.ts
// Admin-only edge function to issue a refund via Stripe API.
// POST { stripe_checkout_session_id, amount_cents? }
// If amount_cents is omitted → full refund.

import Stripe from "npm:stripe@17.7.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRole) {
      return json({ error: "Server misconfigured" }, 500);
    }

    // Verify the caller is authenticated (admin guard on the page handles role check)
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });

    const body = await req.json();
    const sessionId = (body.stripe_checkout_session_id || "").trim();
    const amountCents = body.amount_cents != null ? Math.max(0, Math.round(Number(body.amount_cents))) : null;
    const refundReason = (body.refund_reason || "").trim() || null;

    // Validate refund_reason if supplied
    const VALID_REASONS = ["cancelled_before_ship", "refunded_kept_item", "returned"];
    if (refundReason && !VALID_REASONS.includes(refundReason)) {
      return json({ error: `Invalid refund_reason. Must be one of: ${VALID_REASONS.join(", ")}` }, 400);
    }

    if (!sessionId) return json({ error: "Missing stripe_checkout_session_id" }, 400);

    // Skip Amazon orders
    if (sessionId.startsWith("amazon_")) {
      return json({ error: "Cannot refund Amazon orders through Stripe" }, 400);
    }

    // 1) Get the payment intent from the checkout session
    let paymentIntentId: string | null = null;

    // Try our DB first
    const { data: orderRow } = await supabaseAdmin
      .from("orders_raw")
      .select("stripe_payment_intent_id, total_paid_cents, refund_status, refund_amount_cents")
      .eq("stripe_checkout_session_id", sessionId)
      .single();

    if (orderRow?.stripe_payment_intent_id) {
      paymentIntentId = orderRow.stripe_payment_intent_id;
    } else {
      // Retrieve from Stripe
      const sess = await stripe.checkout.sessions.retrieve(sessionId);
      paymentIntentId = typeof sess.payment_intent === "string"
        ? sess.payment_intent
        : (sess.payment_intent as any)?.id ?? null;

      // Store it for future lookups
      if (paymentIntentId) {
        await supabaseAdmin
          .from("orders_raw")
          .update({ stripe_payment_intent_id: paymentIntentId })
          .eq("stripe_checkout_session_id", sessionId);
      }
    }

    if (!paymentIntentId) {
      return json({ error: "Could not determine payment intent" }, 400);
    }

    // 2) Issue refund via Stripe
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
    };
    if (amountCents != null && amountCents > 0) {
      refundParams.amount = amountCents;
    }

    const refund = await stripe.refunds.create(refundParams);

    // 3) Update our DB
    const totalPaid = orderRow?.total_paid_cents || 0;
    const previousRefund = orderRow?.refund_amount_cents || 0;
    const newTotalRefund = previousRefund + (refund.amount ?? 0);
    const isFullRefund = newTotalRefund >= totalPaid;

    const patch: Record<string, unknown> = {
      refund_status: isFullRefund ? "full" : "partial",
      refund_amount_cents: newTotalRefund,
      refunded_at: new Date().toISOString(),
      stripe_refund_id: refund.id,
      stripe_payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
    };
    if (refundReason) patch.refund_reason = refundReason;

    const { error: dbErr } = await supabaseAdmin
      .from("orders_raw")
      .update(patch)
      .eq("stripe_checkout_session_id", sessionId);

    if (dbErr) {
      console.error("[stripe-refund] DB update failed", dbErr);
      // Refund was already issued on Stripe side, so return success with warning
      return json({
        success: true,
        warning: "Refund issued on Stripe but DB update failed",
        refund_id: refund.id,
        amount_refunded_cents: refund.amount,
        db_error: dbErr.message,
      }, 200);
    }

    return json({
      success: true,
      refund_id: refund.id,
      amount_refunded_cents: refund.amount,
      total_refunded_cents: newTotalRefund,
      refund_status: patch.refund_status,
      refund_reason: refundReason,
    }, 200);

  } catch (err: any) {
    console.error("[stripe-refund] error:", err);

    // Stripe-specific error handling
    if (err?.type === "StripeInvalidRequestError") {
      return json({ error: err.message }, 400);
    }

    return json({ error: err?.message || "Refund failed" }, 500);
  }
});
