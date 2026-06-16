// Admin: update shipping address on orders_raw (used before label purchase).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeShippingAddress } from "../_shared/shippoAddressValidation.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body?.stripe_checkout_session_id || "").trim();
    if (!sessionId) return json({ error: "Missing stripe_checkout_session_id" }, 400);

    const normalized = normalizeShippingAddress({
      first_name: body?.first_name,
      last_name: body?.last_name,
      street_address: body?.street_address,
      city: body?.city,
      state: body?.state,
      zip: body?.zip,
      country: body?.country,
    });

    if (!normalized.street_address || !normalized.city || !normalized.state || !normalized.zip) {
      return json({ error: "Street, city, state, and ZIP are required." }, 400);
    }

    const sb = createClient(supabaseUrl, serviceKey);
    const patch = {
      first_name: normalized.first_name,
      last_name: normalized.last_name,
      street_address: normalized.street_address,
      city: normalized.city,
      state: normalized.state,
      zip: normalized.zip,
      country: normalized.country,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sb
      .from("orders_raw")
      .update(patch)
      .eq("stripe_checkout_session_id", sessionId)
      .select(
        "kk_order_id, stripe_checkout_session_id, first_name, last_name, street_address, city, state, zip, country",
      )
      .single();

    if (error) {
      console.error("[update-order-shipping-address]", error.message);
      return json({ error: error.message }, 500);
    }

    return json({ success: true, order: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[update-order-shipping-address]", msg);
    return json({ error: msg }, 500);
  }
});
