// supabase/functions/cart-sync/index.ts
// Public endpoint — syncs localStorage cart state to saved_carts for abandonment detection.
// Called from cartStore.js when an SMS subscriber modifies their cart.
// Uses cart_hash for change detection + updated_at for stale write guard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Deterministic cart hash: sorted by id, only identity+qty fields */
async function computeCartHash(cart: Array<Record<string, unknown>>): Promise<string> {
  const normalized = cart
    .map(item => `${item.id}:${item.variant || ""}:${item.qty || 1}`)
    .sort()
    .join("|");
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { contact_id, cart } = await req.json();

    // ── Validate ─────────────────────────────────────────────
    if (!contact_id || typeof contact_id !== "string") {
      return json({ error: "contact_id required" }, 400);
    }
    if (!Array.isArray(cart)) {
      return json({ error: "cart must be an array" }, 400);
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Verify contact exists and is active ──────────────────
    const { data: contact, error: contactErr } = await sb
      .from("customer_contacts")
      .select("id, phone, status")
      .eq("id", contact_id)
      .maybeSingle();

    if (contactErr || !contact) {
      return json({ error: "Invalid contact" }, 400);
    }

    // ── Calculate cart value ──────────────────────────────────
    const cartValueCents = Math.round(
      cart.reduce((sum: number, item: { price?: number; qty?: number }) => {
        return sum + (Number(item.price || 0) * Math.max(1, Number(item.qty || 1))) * 100;
      }, 0)
    );
    const itemCount = cart.reduce((sum: number, item: { qty?: number }) => {
      return sum + Math.max(1, Number(item.qty || 1));
    }, 0);

    // Sanitize cart_data: only keep fields needed for SMS messaging
    const sanitizedCart = cart.map((item: Record<string, unknown>) => ({
      id:         item.id || null,
      product_id: item.product_id || null,
      name:       item.name || "Item",
      price:      Number(item.price || 0),
      variant:    item.variant || "",
      qty:        Math.max(1, Number(item.qty || 1)),
      image:      item.image || "",
      slug:       item.slug || null,
    }));

    // ── Handle empty cart = mark purchased or clear ─────────
    if (cart.length === 0) {
      // Empty cart — could be after purchase or manual clear.
      // Mark any active cart as expired (purchased detection handled separately by stripe-webhook).
      await sb
        .from("saved_carts")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("contact_id", contact_id)
        .eq("status", "active");

      return json({ success: true, action: "cleared" });
    }

    // ── Upsert saved cart ─────────────────────────────────────
    const cartHash = await computeCartHash(sanitizedCart);

    // Check for existing active cart
    const { data: existingCart } = await sb
      .from("saved_carts")
      .select("id, cart_hash, updated_at")
      .eq("contact_id", contact_id)
      .eq("status", "active")
      .maybeSingle();

    const now = new Date().toISOString();

    if (existingCart) {
      // Skip if cart hasn't actually changed (same hash)
      if (existingCart.cart_hash === cartHash) {
        return json({ success: true, action: "unchanged" });
      }

      // Stale write guard: only update if our timestamp is newer
      // (protects against multiple tabs sending out-of-order)
      const existingTime = new Date(existingCart.updated_at).getTime();
      const nowTime = new Date(now).getTime();
      if (nowTime < existingTime) {
        return json({ success: true, action: "stale_skip" });
      }

      // Real change — update cart, reset abandonment step
      await sb
        .from("saved_carts")
        .update({
          cart_data:       sanitizedCart,
          cart_value_cents: cartValueCents,
          item_count:      itemCount,
          cart_hash:       cartHash,
          updated_at:      now,
          abandoned_step:  0,  // Reset — cart was just touched
          abandoned_at:    null, // Reset abandonment marker
          step_1_sent_at:  null,
          step_2_sent_at:  null,
          step_3_sent_at:  null,
        })
        .eq("id", existingCart.id);
    } else {
      // Check for prior abandoned/expired carts from same phone (repeat abandoner)
      const { count } = await sb
        .from("saved_carts")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", contact_id)
        .in("status", ["expired", "abandoned"]);

      // Create new cart
      await sb
        .from("saved_carts")
        .insert({
          contact_id,
          phone:           contact.phone,
          cart_data:       sanitizedCart,
          cart_value_cents: cartValueCents,
          item_count:      itemCount,
          cart_hash:       cartHash,
          updated_at:      now,
          status:          "active",
          abandoned_step:  0,
          abandon_count:   count || 0,  // Carry forward abandon history
        });
    }

    return json({ success: true, action: existingCart ? "updated" : "created" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cart-sync] Error:", msg);
    return json({ error: msg }, 500);
  }
});
