// Validate an order shipping address (local heuristics + Shippo USPS validation).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  formatValidationError,
  normalizeShippingAddress,
  type ShippingAddressFields,
  validateShippingAddressWithShippo,
} from "../_shared/shippoAddressValidation.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const shippoKey = Deno.env.get("SHIPPO_API_KEY")!;

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
    if (!shippoKey) return json({ error: "SHIPPO_API_KEY not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body?.stripe_checkout_session_id || "").trim();

    let addr: ShippingAddressFields;

    if (sessionId) {
      const sb = createClient(supabaseUrl, serviceKey);
      const { data: order, error } = await sb
        .from("orders_raw")
        .select(
          "first_name, last_name, street_address, city, state, zip, country",
        )
        .eq("stripe_checkout_session_id", sessionId)
        .single();

      if (error || !order) {
        return json({ error: "Order not found", detail: error?.message }, 404);
      }
      addr = order;
    } else {
      addr = {
        first_name: body?.first_name,
        last_name: body?.last_name,
        street_address: body?.street_address,
        city: body?.city,
        state: body?.state,
        zip: body?.zip,
        country: body?.country,
      };
    }

    const normalized = normalizeShippingAddress(addr);
    const result = await validateShippingAddressWithShippo(normalized, shippoKey);

    return json({
      success: true,
      is_valid: result.is_valid,
      local_issues: result.local_issues,
      messages: result.messages,
      suggested: result.suggested ?? null,
      normalized,
      error: result.is_valid ? null : formatValidationError(result),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[shippo-validate-address]", msg);
    return json({ error: msg }, 500);
  }
});
