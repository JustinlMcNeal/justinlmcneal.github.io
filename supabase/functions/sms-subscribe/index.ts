// supabase/functions/sms-subscribe/index.ts
// Public endpoint: collect phone, create coupon, send SMS, log consent
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

// ── Helpers ──────────────────────────────────────────────────

function generateCouponCode(prefix: string): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

/** Generate a short code for click tracking links */
function generateShortCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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
        contact_id: existing.id,
        coupon_code: existing.coupon_code,
        message: "You're already subscribed! Here's your coupon.",
      });
    }

    // ── Handle re-subscribe (was unsubscribed) ─────────────
    const wasUnsubscribed = existing?.status === "unsubscribed";
    let reuseCoupon: string | null = null;

    if (wasUnsubscribed && existing.coupon_code) {
      // Check if their old coupon still exists and its state
      const { data: oldPromo } = await sb
        .from("promotions")
        .select("id, code, usage_count, usage_limit, end_date, is_active")
        .eq("code", existing.coupon_code)
        .maybeSingle();

      if (oldPromo) {
        const isUsed = (oldPromo.usage_count ?? 0) >= (oldPromo.usage_limit ?? 1);
        const isExpired = oldPromo.end_date && new Date(oldPromo.end_date) < new Date();

        if (isUsed) {
          // They already used their coupon — no new one
          // Re-subscribe them but don't create a new coupon
          await sb
            .from("customer_contacts")
            .update({
              status: "active",
              sms_consent: true,
              email: email || undefined,
              opted_in_at: new Date().toISOString(),
              opted_out_at: null,
            })
            .eq("id", existing.id);

          await sb.from("sms_consent_logs").insert({
            phone,
            consent_type: "opt_in",
            consent_text: consent_text,
            source: "landing_page_coupon",
            page_url: page_url || null,
            ip_address: ip,
            user_agent: user_agent || null,
          });

          return json({
            success: true,
            already_redeemed: true,
            was_unsubscribed: true,
            contact_id: existing.id,
            message: "Welcome back! Your signup coupon was already used.",
          });
        } else if (!isExpired && oldPromo.is_active) {
          // Coupon still valid — reuse it
          reuseCoupon = oldPromo.code;
        }
        // If expired + unused, fall through to create a new one
      }
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

    // ── Generate unique coupon code (skip if reusing) ─────
    let couponCode = reuseCoupon || "";
    const now       = new Date();

    if (!reuseCoupon) {
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
        is_public:        true,
        requires_code:    true,
      });

      if (promoErr) {
        console.error("[sms-subscribe] Promotion insert error:", promoErr.message);
        return json({ error: "Failed to create coupon." }, 500);
      }
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

    // ── Compose SMS body ────────────────────────────────────
    let discountLabel = "";
    if (couponType === "percentage") {
      discountLabel = `${couponValue}% off`;
    } else if (couponType === "fixed") {
      discountLabel = `$${couponValue} off`;
    } else {
      discountLabel = "a discount on";
    }

    // Generate short code for click tracking
    const shortCode = generateShortCode();
    const trackingUrl = `karrykraze.com/r/?c=${shortCode}`;
    const targetUrl = "https://karrykraze.com/pages/catalog.html";

    let smsBody = `Karry Kraze: Your code ${couponCode} gets you ${discountLabel}`;
    if (minOrderAmount > 0) smsBody += ` orders $${minOrderAmount}+`;
    smsBody += `! Expires in ${expiryDays * 24}hrs. Shop now: ${trackingUrl}\nReply STOP to opt out`;

    // ── Route through send-sms wrapper ─────────────────────
    // send-sms handles: Twilio call, sms_messages insert, sms_sends insert,
    // last_sms_sent_at update, and StatusCallback registration.
    // skip_caps: true — the subscribe event is the consent action itself;
    // the welcome SMS must always send regardless of prior send history.
    let smsSent = false;
    try {
      const sendRes = await fetch(
        `${supabaseUrl}/functions/v1/send-sms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            to:                  phone,
            body:                smsBody,
            message_type:        "coupon_delivery",
            intent:              "marketing",
            campaign:            "sms_signup_coupon",
            contact_id:          contact?.id ?? null,
            skip_caps:           true,
            flow:                "signup",
            send_reason:         "new_subscriber_coupon",
            short_code:          shortCode,
            redirect_url:        targetUrl,
            user_state_snapshot: { source: "landing_page_coupon", is_resubscribe: !!existing },
          }),
        }
      );
      const sendData = await sendRes.json();
      smsSent = sendRes.ok && sendData.success === true;
      if (!smsSent) {
        console.warn("[sms-subscribe] send-sms did not succeed:", JSON.stringify(sendData));
      }
    } catch (smsErr: unknown) {
      console.error("[sms-subscribe] send-sms call failed:",
        smsErr instanceof Error ? smsErr.message : String(smsErr));
    }

    return json({
      success: true,
      contact_id: contact?.id || null,
      coupon_code: couponCode,
      sms_sent: smsSent,
      was_unsubscribed: wasUnsubscribed,
      message: smsSent
        ? "Check your phone for your coupon code!"
        : "Coupon created but SMS delivery failed. Use your code at checkout!",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sms-subscribe] Unexpected error:", msg);
    return json({ error: msg }, 500);
  }
});
