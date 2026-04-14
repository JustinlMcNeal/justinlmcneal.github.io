// supabase/functions/sms-abandoned-cart/index.ts
// Cron-triggered: detects abandoned carts and sends 3-step SMS sequence.
// Step 1 (30 min): plain reminder, no discount
// Step 2 (6 hr):   urgency / social proof
// Step 3 (24 hr):  discount offer (15% off $40+)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM  = Deno.env.get("TWILIO_FROM_NUMBER")!;
const WEBHOOK_URL  = Deno.env.get("TWILIO_WEBHOOK_URL") || "";

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

function isQuietHours(): boolean {
  const now = new Date();
  const etHour = (now.getUTCHours() - 4 + 24) % 24;
  return etHour >= 21 || etHour < 9;
}

/** Check 6hr gap */
async function passesFrequencyCap(
  sb: ReturnType<typeof createClient>,
  contactId: string
): Promise<boolean> {
  const { data } = await sb
    .from("customer_contacts")
    .select("last_sms_sent_at")
    .eq("id", contactId)
    .single();

  if (data?.last_sms_sent_at) {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    if (new Date(data.last_sms_sent_at) > sixHoursAgo) return false;
  }
  return true;
}

/** Send SMS and log to sms_messages + sms_sends */
async function sendAndLog(
  sb: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    contactId: string;
    smsBody: string;
    shortCode: string;
    targetUrl: string;
    campaign: string;
    flow: string;
    sendReason: string;
    messageType: string;
    snapshot: Record<string, unknown>;
  }
): Promise<boolean> {
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const formData = new URLSearchParams();
  formData.set("To", opts.phone);
  formData.set("From", TWILIO_FROM);
  formData.set("Body", opts.smsBody);
  if (WEBHOOK_URL) formData.set("StatusCallback", WEBHOOK_URL);

  const twilioResp = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  const twilioData = await twilioResp.json();
  const status = twilioResp.ok ? "sent" : "failed";

  const { data: msgRow } = await sb.from("sms_messages").insert({
    phone:               opts.phone,
    contact_id:          opts.contactId,
    message_body:        opts.smsBody,
    message_type:        opts.messageType,
    campaign:            opts.campaign,
    status,
    provider_message_sid: twilioData.sid || null,
    error_code:          !twilioResp.ok ? String(twilioData.code || twilioResp.status) : null,
    error_message:       !twilioResp.ok ? (twilioData.message || "Twilio API error") : null,
    sent_at:             twilioResp.ok ? new Date().toISOString() : null,
    short_code:          opts.shortCode,
    redirect_url:        opts.targetUrl,
  }).select("id").single();

  if (msgRow) {
    await sb.from("sms_sends").insert({
      phone:           opts.phone,
      contact_id:      opts.contactId,
      campaign:        opts.campaign,
      flow:            opts.flow,
      send_reason:     opts.sendReason,
      intent:          "marketing",
      outcome:         "pending",
      cost:            0.0079,
      sms_message_id:  msgRow.id,
      user_state_snapshot: opts.snapshot,
    });
  }

  if (twilioResp.ok) {
    await sb.from("customer_contacts")
      .update({ last_sms_sent_at: new Date().toISOString() })
      .eq("id", opts.contactId);
  } else {
    console.error(`[sms-abandoned-cart] Failed to send to ${opts.phone}:`, twilioData.message);
  }

  return twilioResp.ok;
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
    if (isQuietHours()) {
      return json({ skipped: true, reason: "quiet_hours" });
    }

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

      // ── Frequency cap check ────────────────────────────────
      if (!(await passesFrequencyCap(sb, cart.contact_id))) {
        results.skipped++;
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

      let sent = false;

      // ── STEP 1: 30min reminder (no discount) ──────────────
      if (cart.abandoned_step === 0 && sinceUpdate >= 30 * 60 * 1000) {
        const smsBody = `Karry Kraze: You left ${cartItems} in your cart ($${cartValue}). Complete your order: ${trackingUrl}\nReply STOP to opt out`;

        sent = await sendAndLog(sb, {
          phone: cart.phone,
          contactId: cart.contact_id,
          smsBody,
          shortCode,
          targetUrl,
          campaign: "abandoned_cart",
          flow: "abandoned_cart",
          sendReason: "cart_abandoned_30min",
          messageType: "abandoned_cart_reminder",
          snapshot,
        });

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

        sent = await sendAndLog(sb, {
          phone: cart.phone,
          contactId: cart.contact_id,
          smsBody,
          shortCode,
          targetUrl,
          campaign: "abandoned_cart",
          flow: "abandoned_cart",
          sendReason: "cart_abandoned_6hr_urgency",
          messageType: "abandoned_cart_urgency",
          snapshot,
        });

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

        sent = await sendAndLog(sb, {
          phone: cart.phone,
          contactId: cart.contact_id,
          smsBody,
          shortCode,
          targetUrl,
          campaign: "abandoned_cart",
          flow: "abandoned_cart",
          sendReason: "cart_abandoned_24hr_discount",
          messageType: "abandoned_cart_discount",
          snapshot: { ...snapshot, coupon_code: couponCode, high_value: isHighValue },
        });

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
