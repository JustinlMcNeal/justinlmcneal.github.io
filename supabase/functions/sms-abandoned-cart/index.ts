// supabase/functions/sms-abandoned-cart/index.ts
// Cron-triggered: detects abandoned carts and sends 3-step SMS sequence.
// Step 1 (30 min): plain reminder, no discount
// Step 2 (6 hr):   urgency / social proof
// Step 3 (24 hr):  discount offer (15% off $40+)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function generateShortCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateCouponCode(prefix: string): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

/** Route SMS through send-sms wrapper */
async function sendViaSendSms(opts: {
  to: string;
  body: string;
  message_type: string;
  intent: string;
  campaign: string;
  contact_id: string;
  flow: string;
  send_reason: string;
  short_code: string;
  redirect_url: string;
  user_state_snapshot: Record<string, unknown>;
}): Promise<"sent" | "skipped" | "failed"> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(opts),
    });
    const data = await res.json();
    if (data.blocked === true) return "skipped";
    if (res.ok && data.success === true) return "sent";
    console.warn("[sms-abandoned-cart] send-sms did not succeed:", JSON.stringify(data));
    return "failed";
  } catch (err: unknown) {
    console.error("[sms-abandoned-cart] send-sms call failed:",
      err instanceof Error ? err.message : String(err));
    return "failed";
  }
}

// ── Cart item name for SMS body ─────────────────────────────
function topItemName(cartData: Array<{name?: string}>): string {
  if (!cartData || cartData.length === 0) return "your items";
  const first = cartData[0]?.name || "your items";
  if (cartData.length === 1) return first;
  return `${first} + ${cartData.length - 1} more`;
}

// Minimum cart value (cents) to trigger abandoned cart SMS
const MIN_CART_VALUE_CENTS = 1500; // $15

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const sb = createClient(supabaseUrl, serviceKey);
    const now = Date.now();
    const results = { step1: 0, step2: 0, step3: 0, skipped: 0, purchased: 0, expired: 0 };

    // ─────────────────────────────────────────────────────────
    // Find all active carts that might be abandoned
    // ─────────────────────────────────────────────────────────
    const { data: carts, error: cartsErr } = await sb
      .from("saved_carts")
      .select("id, contact_id, phone, cart_data, cart_value_cents, item_count, updated_at, abandoned_step, last_sms_at, abandoned_at, step_1_sent_at, step_2_sent_at, step_3_sent_at, abandon_count")
      .eq("status", "active")
      .gte("cart_value_cents", MIN_CART_VALUE_CENTS)
      .order("updated_at", { ascending: true });

    if (cartsErr) {
      console.error("[sms-abandoned-cart] Query error:", cartsErr.message);
      return json({ error: cartsErr.message }, 500);
    }
    if (!carts || carts.length === 0) {
      return json({ results, message: "No active carts" });
    }

    for (const cart of carts) {
      const updatedAt = new Date(cart.updated_at).getTime();
      const sinceUpdate = now - updatedAt;
      const sinceLastSms = cart.last_sms_at ? now - new Date(cart.last_sms_at).getTime() : Infinity;

      // ── Verify contact is still active + opted in ─────────
      const { data: contact } = await sb
        .from("customer_contacts")
        .select("id, status, sms_consent")
        .eq("id", cart.contact_id)
        .maybeSingle();

      if (!contact || contact.status !== "active" || !contact.sms_consent) {
        results.skipped++;
        continue;
      }

      // ── Suppress repeat abandoners (3+ prior abandoned carts) ──
      if ((cart.abandon_count || 0) >= 3) {
        results.skipped++;
        continue;
      }

      // ── Check if contact purchased since cart was last updated ──
      const { data: recentOrder } = await sb
        .from("orders_raw")
        .select("id")
        .eq("phone_number", cart.phone)
        .gte("order_date", cart.updated_at)
        .limit(1)
        .maybeSingle();

      if (recentOrder) {
        // They purchased — mark cart as purchased
        await sb
          .from("saved_carts")
          .update({ status: "purchased", purchased_at: new Date().toISOString() })
          .eq("id", cart.id);
        results.purchased++;
        continue;
      }

      // ── Expire very old carts (3+ days) ───────────────────
      if (sinceUpdate > 3 * 24 * 60 * 60 * 1000) {
        await sb
          .from("saved_carts")
          .update({ status: "expired" })
          .eq("id", cart.id);
        results.expired++;
        continue;
      }

      // ── Determine which step to execute ────────────────────
      const cartItems = topItemName(cart.cart_data as Array<{name?: string}>);
      const cartValue = (cart.cart_value_cents / 100).toFixed(2);
      const shortCode = generateShortCode();
      const trackingUrl = `karrykraze.com/r/?c=${shortCode}`;
      const targetUrl = "https://karrykraze.com/pages/catalog.html";

      const snapshot = {
        cart_value_cents: cart.cart_value_cents,
        item_count: cart.item_count,
        abandoned_step: cart.abandoned_step,
        minutes_since_update: Math.round(sinceUpdate / 60000),
      };

      // ── STEP 1: 30min reminder (no discount) ──────────────
      if (cart.abandoned_step === 0 && sinceUpdate >= 30 * 60 * 1000) {
        const smsBody = `Karry Kraze: You left ${cartItems} in your cart ($${cartValue}). Complete your order: ${trackingUrl}\nReply STOP to opt out`;

        const result = await sendViaSendSms({
          to:                  cart.phone,
          body:                smsBody,
          message_type:        "abandoned_cart_reminder",
          intent:              "marketing",
          campaign:            "abandoned_cart",
          contact_id:          cart.contact_id,
          flow:                "abandoned_cart",
          send_reason:         "cart_abandoned_30min",
          short_code:          shortCode,
          redirect_url:        targetUrl,
          user_state_snapshot: snapshot,
        });
        const sent = result === "sent";
        if (!sent) results.skipped++;

        if (sent) {
          const sentAt = new Date().toISOString();
          await sb.from("saved_carts").update({
            abandoned_step: 1,
            last_sms_at: sentAt,
            abandoned_at: cart.abandoned_at || sentAt,  // Set once on first detection
            step_1_sent_at: sentAt,
          }).eq("id", cart.id);
          results.step1++;
        }
      }

      // ── STEP 2: 6hr urgency (stronger copy) ───────────────
      else if (cart.abandoned_step === 1 && sinceUpdate >= 6 * 60 * 60 * 1000 && sinceLastSms >= 6 * 60 * 60 * 1000) {
        // Duplicate send guard: skip if already sent
        if (cart.step_2_sent_at) { results.skipped++; continue; }

        const smsBody = `Karry Kraze: Almost gone \ud83d\udc40 ${cartItems} been selling fast. Don't miss out: ${trackingUrl}\nReply STOP to opt out`;

        const result = await sendViaSendSms({
          to:                  cart.phone,
          body:                smsBody,
          message_type:        "abandoned_cart_urgency",
          intent:              "marketing",
          campaign:            "abandoned_cart",
          contact_id:          cart.contact_id,
          flow:                "abandoned_cart",
          send_reason:         "cart_abandoned_6hr_urgency",
          short_code:          shortCode,
          redirect_url:        targetUrl,
          user_state_snapshot: snapshot,
        });
        const sent = result === "sent";
        if (!sent) results.skipped++;

        if (sent) {
          const sentAt = new Date().toISOString();
          await sb.from("saved_carts").update({
            abandoned_step: 2,
            last_sms_at: sentAt,
            step_2_sent_at: sentAt,
          }).eq("id", cart.id);
          results.step2++;
        }
      }

      // ── STEP 3: 24hr discount offer ───────────────────────
      else if (cart.abandoned_step === 2 && sinceUpdate >= 24 * 60 * 60 * 1000 && sinceLastSms >= 6 * 60 * 60 * 1000) {
        // Duplicate send guard: skip if already sent
        if (cart.step_3_sent_at) { results.skipped++; continue; }

        // High-value cart override: $75+ gets flat $5 off (no minimum) instead of 15%
        const isHighValue = cart.cart_value_cents >= 7500;
        const couponPrefix = isHighValue ? "ACV" : "AC";

        // Generate unique abandoned-cart coupon
        let couponCode = "";
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = generateCouponCode(couponPrefix);
          const { data: dup } = await sb
            .from("promotions")
            .select("id")
            .eq("code", candidate)
            .maybeSingle();
          if (!dup) { couponCode = candidate; break; }
        }

        if (!couponCode) {
          console.error("[sms-abandoned-cart] Failed to generate coupon code");
          results.skipped++;
          continue;
        }

        const expiresAt = new Date(now + 48 * 60 * 60 * 1000).toISOString();

        const promoPayload = isHighValue
          ? {
              name:             `Abandoned Cart HV — ${couponCode}`,
              code:             couponCode,
              description:      `High-value abandoned cart coupon for ${cart.phone}`,
              type:             "fixed" as const,
              value:            5,
              scope_type:       "all",
              scope_data:       "{}",
              min_order_amount: 0,
              usage_limit:      1,
              usage_count:      0,
              start_date:       new Date().toISOString(),
              end_date:         expiresAt,
              is_active:        true,
              is_public:        true,
              requires_code:    true,
            }
          : {
              name:             `Abandoned Cart — ${couponCode}`,
              code:             couponCode,
              description:      `Abandoned cart coupon for ${cart.phone}`,
              type:             "percentage" as const,
              value:            15,
              scope_type:       "all",
              scope_data:       "{}",
              min_order_amount: 40,
              usage_limit:      1,
              usage_count:      0,
              start_date:       new Date().toISOString(),
              end_date:         expiresAt,
              is_active:        true,
              is_public:        true,
              requires_code:    true,
            };

        const { error: promoErr } = await sb.from("promotions").insert(promoPayload);

        if (promoErr) {
          console.error("[sms-abandoned-cart] Coupon create error:", promoErr.message);
          results.skipped++;
          continue;
        }

        const offerText = isHighValue
          ? `Use ${couponCode} for $5 off your order`
          : `Use ${couponCode} for 15% off orders $40+`;
        const smsBody = `Karry Kraze: We saved your cart! ${offerText}. Expires in 48hrs: ${trackingUrl}\nReply STOP to opt out`;

        const result = await sendViaSendSms({
          to:                  cart.phone,
          body:                smsBody,
          message_type:        "abandoned_cart_discount",
          intent:              "marketing",
          campaign:            "abandoned_cart",
          contact_id:          cart.contact_id,
          flow:                "abandoned_cart",
          send_reason:         "cart_abandoned_24hr_discount",
          short_code:          shortCode,
          redirect_url:        targetUrl,
          user_state_snapshot: { ...snapshot, coupon_code: couponCode, high_value: isHighValue },
        });
        const sent = result === "sent";
        if (!sent) results.skipped++;

        if (sent) {
          const sentAt = new Date().toISOString();
          await sb.from("saved_carts").update({
            abandoned_step: 3,
            last_sms_at: sentAt,
            step_3_sent_at: sentAt,
          }).eq("id", cart.id);
          results.step3++;
        }
      }
    }

    return json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sms-abandoned-cart] Unexpected error:", msg);
    return json({ error: msg }, 500);
  }
});
