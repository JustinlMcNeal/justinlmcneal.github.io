// supabase/functions/stripe-refresh-refund-details/index.ts

// Admin-only: fetch Stripe refunds for an order and cache observational rows only.

// POST { stripe_checkout_session_id }



import Stripe from "npm:stripe@17.7.0";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {

  enrichOrderRefundDetails,

  fetchAllRefundsForPaymentIntent,

  summarizeRefunds,

  syncOrdersRawRefundSummary,

} from "../_shared/stripeRefundDetails.ts";



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



  if (req.method !== "POST") return json({ error: "POST only" }, 405);



  try {

    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");

    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRole) {

      return json({ error: "Server misconfigured" }, 500);

    }



    const authHeader = req.headers.get("authorization");

    if (!authHeader) return json({ error: "Unauthorized" }, 401);



    const body = await req.json();

    const sessionId = (body.stripe_checkout_session_id || body.source_order_id || "").trim();

    if (!sessionId) return json({ error: "Missing stripe_checkout_session_id" }, 400);

    if (sessionId.startsWith("amazon_") || sessionId.startsWith("ebay_")) {

      return json({ error: "Stripe refresh supports KK Store orders only" }, 400);

    }



    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });



    const { data: orderRow, error: orderErr } = await supabaseAdmin

      .from("orders_raw")

      .select("stripe_checkout_session_id, stripe_payment_intent_id, total_paid_cents")

      .eq("stripe_checkout_session_id", sessionId)

      .maybeSingle();



    if (orderErr) return json({ error: orderErr.message }, 500);

    if (!orderRow) return json({ error: "Order not found" }, 404);



    let paymentIntentId = orderRow.stripe_payment_intent_id as string | null;

    if (!paymentIntentId) {

      const sess = await stripe.checkout.sessions.retrieve(sessionId);

      paymentIntentId = typeof sess.payment_intent === "string"

        ? sess.payment_intent

        : (sess.payment_intent as Stripe.PaymentIntent | null)?.id ?? null;

      if (paymentIntentId) {

        await supabaseAdmin

          .from("orders_raw")

          .update({ stripe_payment_intent_id: paymentIntentId })

          .eq("stripe_checkout_session_id", sessionId);

      }

    }



    if (!paymentIntentId) return json({ error: "Could not determine payment intent" }, 400);



    const refunds = await fetchAllRefundsForPaymentIntent(stripe, paymentIntentId);

    const enrich = await enrichOrderRefundDetails({

      sb: supabaseAdmin,

      sessionId,

      paymentIntentId,

      refunds,

      syncSource: "admin_refresh",

    });



    const totalPaid = Number(orderRow.total_paid_cents ?? 0);

    const summary = summarizeRefunds(refunds, totalPaid);

    await syncOrdersRawRefundSummary(supabaseAdmin, sessionId, summary, paymentIntentId);



    return json({

      ok: true,

      session_id: sessionId,

      refunds_fetched: refunds.length,

      refunds_upserted: enrich.upserted,

      refunds_failed: enrich.failed,

      total_refunded_cents: summary.totalRefunded,

      refund_status: summary.refundStatus,

      message: "Refund details refreshed — no stock or workflow changes",

    });

  } catch (err: unknown) {

    console.error("[stripe-refresh-refund-details]", err);

    const msg = err instanceof Error ? err.message : String(err);

    return json({ error: msg }, 500);

  }

});

