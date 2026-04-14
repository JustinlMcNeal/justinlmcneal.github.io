// supabase/functions/sms-subscribe/index.ts
// Public endpoint: collect phone, create coupon, send SMS, log consent
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

// ── Helpers ──────────────────────────────────────────────────

function generateCouponCode(prefix: string): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

/** Normalise any US phone input to E.164 +1XXXXXXXXXX */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// ── Main handler ─────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json();
    const { email, consent_text, page_url, user_agent } = body;
    const rawPhone = String(body.phone || "").trim();

    // ── Validate inputs ────────────────────────────────────
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return json({ error: "Invalid US phone number." }, 400);
    }
    if (!consent_text) {
      return json({ error: "Consent text is required." }, 400);
    }

    // ── Rate limiting (IP-based, 3/hour) ───────────────────
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("cf-connecting-ip")
            || null;

    const sb = createClient(supabaseUrl, serviceKey);

    if (ip) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await sb
        .from("sms_consent_logs")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ip)
        .gte("created_at", oneHourAgo);

      if ((count ?? 0) >= 3) {
        return json({ error: "Too many requests. Please try again later." }, 429);
      }
    }

    // ── Check for existing contact ─────────────────────────
    const { data: existing } = await sb
      .from("customer_contacts")
      .select("id, status, coupon_code")
      .eq("phone", phone)
      .maybeSingle();

    if (existing && existing.status === "active") {
      // Already subscribed — return existing coupon
      return json({
        success: true,
        already_subscribed: true,
        coupon_code: existing.coupon_code,
        message: "You're already subscribed! Here's your coupon.",
      });
    }

    // ── Load coupon config from site_settings ──────────────
    const { data: settingsRow } = await sb
      .from("site_settings")
      .select("value")
      .eq("key", "sms_coupon")
      .maybeSingle();

    const cfg = settingsRow?.value || {};
    const couponType      = cfg.type           || "percentage";
    const couponValue     = Number(cfg.value   || 15);
    const minOrderAmount  = Number(cfg.min_order_amount || 0);
    const expiryDays      = Number(cfg.expiry_days      || 2);
    const prefix          = cfg.prefix         || "SMS";
    const scopeType       = cfg.scope_type     || "all";

    // ── Generate unique coupon code ────────────────────────
    let couponCode = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCouponCode(prefix);
      const { data: dup } = await sb
        .from("promotions")
        .select("id")
        .eq("code", candidate)
        .maybeSingle();
      if (!dup) { couponCode = candidate; break; }
    }
    if (!couponCode) {
      return json({ error: "Could not generate unique code. Please try again." }, 500);
    }

    // ── Create promotion row ───────────────────────────────
    const now       = new Date();
    const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    const { error: promoErr } = await sb.from("promotions").insert({
      name:             `SMS Signup — ${couponCode}`,
      code:             couponCode,
      description:      `SMS signup coupon for ${phone}`,
      type:             couponType,
      value:            couponValue,
      scope_type:       scopeType,
      scope_data:       "{}",
      min_order_amount: minOrderAmount,
      usage_limit:      1,
      usage_count:      0,
      start_date:       now.toISOString(),
      end_date:         expiresAt.toISOString(),
      is_active:        true,
      is_public:        true,       // readable by anon for code lookup (requires_code prevents auto-apply)
      requires_code:    true,
    });

    if (promoErr) {
      console.error("[sms-subscribe] Promotion insert error:", promoErr.message);
      return json({ error: "Failed to create coupon." }, 500);
    }

    // ── Upsert contact ─────────────────────────────────────
    if (existing && existing.status === "unsubscribed") {
      // Re-subscribe
      const { error: updErr } = await sb
        .from("customer_contacts")
        .update({
          status:       "active",
          sms_consent:  true,
          coupon_code:  couponCode,
          email:        email || undefined,
          opted_in_at:  now.toISOString(),
          opted_out_at: null,
        })
        .eq("id", existing.id);

      if (updErr) {
        console.error("[sms-subscribe] Contact update error:", updErr.message);
        return json({ error: "Failed to update contact." }, 500);
      }
    } else {
      // New contact
      const { error: insErr } = await sb.from("customer_contacts").insert({
        phone,
        email:       email || null,
        status:      "active",
        sms_consent: true,
        source:      "landing_page_coupon",
        coupon_code: couponCode,
        opted_in_at: now.toISOString(),
      });

      if (insErr) {
        console.error("[sms-subscribe] Contact insert error:", insErr.message, insErr.details, insErr.hint);
        return json({ error: "Failed to save contact.", details: insErr.message }, 500);
      }
    }

    // ── Log consent ────────────────────────────────────────
    await sb.from("sms_consent_logs").insert({
      phone,
      consent_type: "opt_in",
      consent_text: consent_text,
      source:       "landing_page_coupon",
      page_url:     page_url || null,
      ip_address:   ip,
      user_agent:   user_agent || null,
    });

    // ── Fetch contact id for message log ───────────────────
    const { data: contact } = await sb
      .from("customer_contacts")
      .select("id")
      .eq("phone", phone)
      .single();

    // ── Compose & send SMS via Twilio directly ──────────────
    let discountLabel = "";
    if (couponType === "percentage") {
      discountLabel = `${couponValue}% off`;
    } else if (couponType === "fixed") {
      discountLabel = `$${couponValue} off`;
    } else {
      discountLabel = "a discount on";
    }

    let smsBody = `Karry Kraze: Your code ${couponCode} gets you ${discountLabel}`;
    if (minOrderAmount > 0) smsBody += ` orders $${minOrderAmount}+`;
    smsBody += `! Shop now: karrykraze.com\nReply STOP to opt out`;

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
    const formData  = new URLSearchParams();
    formData.set("To",   phone);
    formData.set("From", TWILIO_FROM);
    formData.set("Body", smsBody);
    if (WEBHOOK_URL) formData.set("StatusCallback", WEBHOOK_URL);

    const twilioResp = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
        "Content-Type":  "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const twilioData = await twilioResp.json();

    if (!twilioResp.ok) {
      console.error("[sms-subscribe] Twilio error:", JSON.stringify(twilioData));

      // Log failed attempt
      await sb.from("sms_messages").insert({
        phone,
        contact_id:    contact?.id || null,
        message_body:  smsBody,
        message_type:  "coupon_delivery",
        campaign:      "sms_signup_coupon",
        status:        "failed",
        error_code:    String(twilioData.code || twilioResp.status),
        error_message: twilioData.message || "Twilio API error",
      });

      return json({
        success: true,
        coupon_code: couponCode,
        sms_sent: false,
        message: "Coupon created but SMS delivery failed. Use your code at checkout!",
      });
    }

    // Log sent message
    await sb.from("sms_messages").insert({
      phone,
      contact_id:          contact?.id || null,
      message_body:        smsBody,
      message_type:        "coupon_delivery",
      campaign:            "sms_signup_coupon",
      status:              "sent",
      provider_message_sid: twilioData.sid,
      sent_at:             new Date().toISOString(),
    });

    return json({
      success: true,
      coupon_code: couponCode,
      sms_sent: true,
      message: "Check your phone for your coupon code!",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sms-subscribe] Unexpected error:", msg);
    return json({ error: msg }, 500);
  }
});
