// supabase/functions/coupon-upgrade/index.ts
// Public endpoint: phone enrollment → generate personal upgrade code → send SMS → enroll in SMS marketing
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

/** Normalise any US phone input to E.164 +1XXXXXXXXXX */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Generate a unique upgrade code like VIP-X4F9J2 */
function generateUpgradeCode(prefix: string): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  const cleanPrefix = String(prefix || "VIP")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "VIP";
  return `${cleanPrefix}-${suffix}`;
}

/** Generate a short tracking code */
function generateShortCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Main handler ─────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json();
    const { promo_id, consent_text, page_url, user_agent } = body;
    const rawPhone = String(body.phone || "").trim();

    // ── Validate inputs ────────────────────────────────────
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return json({ error: "Invalid US phone number." }, 400);
    }
    if (!promo_id) {
      return json({ error: "promo_id is required." }, 400);
    }
    if (!consent_text) {
      return json({ error: "consent_text is required." }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("cf-connecting-ip")
            || null;

    const sb = createClient(supabaseUrl, serviceKey);

    // ── Rate limiting (IP-based, 3/hour) ───────────────────
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

    // ── Load the base promotion ────────────────────────────
    const { data: promo, error: promoErr } = await sb
      .from("promotions")
      .select("id, name, type, value, coupon_upgrade_enabled, coupon_upgrade_value, coupon_upgrade_prefix, coupon_upgrade_expiry_days, coupon_upgrade_consent, is_active, coupon_landing_enabled")
      .eq("id", promo_id)
      .maybeSingle();

    if (promoErr || !promo) {
      return json({ error: "Promotion not found." }, 404);
    }
    if (!promo.is_active || !promo.coupon_landing_enabled) {
      return json({ error: "This promotion is not active." }, 400);
    }
    if (!promo.coupon_upgrade_enabled) {
      return json({ error: "Coupon upgrade is not enabled for this promotion." }, 400);
    }

    const upgradeValue = Number(promo.coupon_upgrade_value || 0);
    if (upgradeValue <= 0) {
      return json({ error: "Upgrade is not configured correctly." }, 400);
    }

    // ── Check if this phone already has an upgrade for this promo ─
    const { data: existing } = await sb
      .from("coupon_upgrades")
      .select("upgrade_code")
      .eq("promo_id", promo_id)
      .eq("phone", phone)
      .maybeSingle();

    if (existing) {
      return json({
        success: true,
        already_upgraded: true,
        coupon_code: existing.upgrade_code,
        message: "You already have an upgrade code! Check your texts or use the code below.",
      });
    }

    // ── Generate a unique upgrade code ─────────────────────
    const prefix = String(promo.coupon_upgrade_prefix || "VIP");
    let upgradeCode = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateUpgradeCode(prefix);
      const { data: dup } = await sb
        .from("promotions")
        .select("id")
        .eq("code", candidate)
        .maybeSingle();
      if (!dup) { upgradeCode = candidate; break; }
    }
    if (!upgradeCode) {
      return json({ error: "Could not generate a unique code. Please try again." }, 500);
    }

    // ── Create the personal upgrade promotion row ──────────
    const now       = new Date();
    const expiryDays = Number(promo.coupon_upgrade_expiry_days || 7);
    const expiresAt  = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    const { data: upgPromo, error: upgPromoErr } = await sb
      .from("promotions")
      .insert({
        name:             `Upgrade — ${promo.name || promo_id} — ${phone.slice(-4)}`,
        code:             upgradeCode,
        description:      `Personal upgrade coupon for ${phone}`,
        type:             promo.type,
        value:            upgradeValue,
        scope_type:       "all",
        scope_data:       "{}",
        min_order_amount: 0,
        usage_limit:      1,
        usage_count:      0,
        start_date:       now.toISOString(),
        end_date:         expiresAt.toISOString(),
        is_active:        true,
        is_public:        false,
        requires_code:    true,
      })
      .select("id")
      .single();

    if (upgPromoErr) {
      console.error("[coupon-upgrade] Promotion insert error:", upgPromoErr.message);
      return json({ error: "Failed to create upgrade coupon." }, 500);
    }

    // ── Insert coupon_upgrades row ─────────────────────────
    const { error: upgradeRowErr } = await sb
      .from("coupon_upgrades")
      .insert({
        promo_id,
        phone,
        upgrade_code:     upgradeCode,
        upgrade_promo_id: upgPromo.id,
      });

    if (upgradeRowErr) {
      console.error("[coupon-upgrade] coupon_upgrades insert error:", upgradeRowErr.message);
      // Don't block — code was created, clean up best-effort
    }

    // ── Upsert customer_contacts (subscribe to SMS) ────────
    const { data: contact } = await sb
      .from("customer_contacts")
      .select("id, status, coupon_code")
      .eq("phone", phone)
      .maybeSingle();

    let contactId: string | null = null;

    if (contact) {
      const { data: updated } = await sb
        .from("customer_contacts")
        .update({
          status:          "active",
          sms_consent:     true,
          opted_in_at:     now.toISOString(),
          opted_out_at:    null,
          last_sms_sent_at: now.toISOString(),
          coupon_code:     upgradeCode,
        })
        .eq("id", contact.id)
        .select("id")
        .single();
      contactId = updated?.id || contact.id;
    } else {
      const { data: newContact } = await sb
        .from("customer_contacts")
        .insert({
          phone,
          status:          "active",
          sms_consent:     true,
          source:          "coupon_upgrade",
          coupon_code:     upgradeCode,
          opted_in_at:     now.toISOString(),
          last_sms_sent_at: now.toISOString(),
        })
        .select("id")
        .single();
      contactId = newContact?.id || null;
    }

    // ── Log consent ────────────────────────────────────────
    await sb.from("sms_consent_logs").insert({
      phone,
      consent_type: "opt_in",
      consent_text: consent_text,
      source:       "coupon_upgrade",
      page_url:     page_url || null,
      ip_address:   ip,
      user_agent:   user_agent || null,
    });

    // ── Compose SMS body ───────────────────────────────────
    const promoType = String(promo.type || "").toLowerCase();
    let discountLabel = "";
    if (promoType === "percentage") discountLabel = `${upgradeValue}% off`;
    else if (promoType === "fixed") discountLabel = `$${upgradeValue} off`;
    else discountLabel = "your upgraded discount";

    const shortCode = generateShortCode();
    const trackingUrl = `karrykraze.com/r/?c=${shortCode}`;

    const smsBody =
      `Karry Kraze: Your upgraded code ${upgradeCode} gets you ${discountLabel}! ` +
      `Expires in ${expiryDays * 24}hrs. Shop: ${trackingUrl}\nReply STOP to opt out`;

    // ── Send via send-sms wrapper ──────────────────────────
    const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        to:                  phone,
        body:                smsBody,
        message_type:        "coupon_delivery",
        intent:              "marketing",
        campaign:            "coupon_upgrade",
        contact_id:          contactId,
        flow:                "upgrade",
        send_reason:         "coupon_upgrade_enrollment",
        short_code:          shortCode,
        redirect_url:        "https://karrykraze.com/pages/catalog.html",
        user_state_snapshot: { promo_id, source: "coupon_upgrade" },
        skip_caps:           true,
      }),
    });

    let smsSent = false;
    try {
      const smsData = await smsRes.json();
      smsSent = smsRes.ok && smsData.success === true;
      if (!smsSent) {
        console.error("[coupon-upgrade] send-sms did not succeed:", JSON.stringify(smsData));
      }
    } catch (err: unknown) {
      console.error("[coupon-upgrade] send-sms response parse error:",
        err instanceof Error ? err.message : String(err));
    }

    return json({
      success:          true,
      already_upgraded: false,
      coupon_code:      upgradeCode,
      sms_sent:         smsSent,
      message:          smsSent
        ? "Check your phone for your upgraded code!"
        : "Upgrade code created! SMS delivery failed — use the code shown below.",
    });

  } catch (err: unknown) {
    console.error("[coupon-upgrade] Unhandled error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
