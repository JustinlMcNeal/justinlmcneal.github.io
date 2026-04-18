// supabase/functions/shippo-void-label/index.ts
// Void/refund an unused shipping label via Shippo.
// USPS allows void within 30 days if the label hasn't been scanned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { stripe_checkout_session_id } = await req.json();
    if (!stripe_checkout_session_id) return json({ error: "Missing stripe_checkout_session_id" }, 400);

    const sb = createClient(supabaseUrl, serviceKey);

    // ── 1. Look up the existing label ──
    const { data: shipment, error: fetchErr } = await sb
      .from("fulfillment_shipments")
      .select("shippo_transaction_id, label_status, tracking_number")
      .eq("stripe_checkout_session_id", stripe_checkout_session_id)
      .single();

    if (fetchErr || !shipment) return json({ error: "Shipment not found" }, 404);
    if (!shipment.shippo_transaction_id) return json({ error: "No Shippo label to void" }, 400);
    if (shipment.label_status === "voided") return json({ success: true, already_voided: true });
    if (shipment.label_status === "shipped" || shipment.label_status === "delivered") {
      return json({ error: "Cannot void — label has already been scanned by carrier" }, 400);
    }

    // ── 2. Request refund from Shippo ──
    const res = await fetch(`${SHIPPO_BASE}/refunds/`, {
      method: "POST",
      headers: {
        "Authorization": `ShippoToken ${shippoKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ transaction: shipment.shippo_transaction_id }),
    });

    const refund = await res.json();
    if (!res.ok) {
      const msg = typeof refund === "object" ? JSON.stringify(refund) : String(refund);
      throw new Error(`Shippo refund failed (${res.status}): ${msg}`);
    }

    // Shippo refund statuses: QUEUED, PENDING, SUCCESS, ERROR
    const refundStatus = refund.status || "UNKNOWN";

    // ── 3. Update fulfillment_shipments ──
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("fulfillment_shipments")
      .update({
        label_status: "voided",
        updated_at: nowIso,
      })
      .eq("stripe_checkout_session_id", stripe_checkout_session_id);

    if (updateErr) {
      console.error("[shippo-void-label] DB update error:", updateErr.message);
    }

    // ── 4. Delete label from storage (optional cleanup) ──
    try {
      const { data: ship } = await sb
        .from("fulfillment_shipments")
        .select("label_url, kk_order_id")
        .eq("stripe_checkout_session_id", stripe_checkout_session_id)
        .single();

      if (ship?.label_url) {
        await sb.storage.from("labels").remove([ship.label_url]);
      }
    } catch (cleanupErr: unknown) {
      console.error("[shippo-void-label] storage cleanup:", cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
    }

    return json({
      success: true,
      data: {
        refund_status: refundStatus,
        tracking_number: shipment.tracking_number,
      },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[shippo-void-label] error:", msg);
    return json({ error: msg }, 500);
  }
});
