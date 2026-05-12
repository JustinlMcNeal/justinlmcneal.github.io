// supabase/functions/sms-welcome-series/index.ts
// Cron-triggered: sends 2-step welcome series after signup.
// Day 2: Value/discovery message (no discount)
// Day 5: 10% off conversion push (only if no purchase yet)
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

/** Route an SMS through the send-sms edge function. Returns 'sent', 'skipped', or 'failed'. */
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
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(opts),
    });
    const data = await res.json();
    if (data.blocked === true) return "skipped";
    if (res.ok && data.success === true) return "sent";
    console.warn("[sms-welcome-series] send-sms did not succeed:", JSON.stringify(data));
    return "failed";
  } catch (err: unknown) {
    console.error("[sms-welcome-series] send-sms call failed:",
      err instanceof Error ? err.message : String(err));
    return "failed";
  }
}

/** Check if a specific welcome step was already sent to this contact */
async function alreadySent(
  sb: ReturnType<typeof createClient>,
  contactId: string,
  sendReason: string
): Promise<boolean> {
  const { count } = await sb
    .from("sms_sends")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("send_reason", sendReason);
  return (count ?? 0) > 0;
}

/** Check if contact has an active abandoned cart (let that flow handle them) */
async function hasActiveAbandonedCart(
  sb: ReturnType<typeof createClient>,
  contactId: string
): Promise<boolean> {
  const { count } = await sb
    .from("saved_carts")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("status", "active")
    .gt("abandoned_step", 0);
  return (count ?? 0) > 0;
}

/** Check if contact has purchased since signup */
async function hasPurchased(
  sb: ReturnType<typeof createClient>,
  phone: string,
  since: string
): Promise<boolean> {
  const { count } = await sb
    .from("orders_raw")
    .select("id", { count: "exact", head: true })
    .eq("phone_number", phone)
    .gte("order_date", since);
  return (count ?? 0) > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const sb = createClient(supabaseUrl, serviceKey);
    const now = Date.now();
    const results = { day2_sent: 0, day5_sent: 0, skipped: 0 };

    // ─────────────────────────────────────────────────────────
    // Find contacts who signed up 2–7 days ago and are eligible
    // ─────────────────────────────────────────────────────────
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo   = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: contacts, error: contactsErr } = await sb
      .from("customer_contacts")
      .select("id, phone, created_at, fatigue_score")
      .eq("status", "active")
      .eq("sms_consent", true)
      .gte("created_at", sevenDaysAgo)
      .lte("created_at", twoDaysAgo)
      .order("created_at", { ascending: true });

    if (contactsErr) {
      console.error("[sms-welcome-series] Query error:", contactsErr.message);
      return json({ error: contactsErr.message }, 500);
    }
    if (!contacts || contacts.length === 0) {
      return json({ results, message: "No eligible contacts" });
    }

    const targetUrl = "https://karrykraze.com/pages/catalog.html";

    for (const contact of contacts) {
      const daysSinceSignup = (now - new Date(contact.created_at).getTime())
        / (24 * 60 * 60 * 1000);

      // ── Fatigue check ──────────────────────────────────────
      if ((contact.fatigue_score ?? 0) >= 8) {
        results.skipped++;
        continue;
      }

      // ── Skip if abandoned cart flow is active ──────────────
      if (await hasActiveAbandonedCart(sb, contact.id)) {
        results.skipped++;
        continue;
      }

      const snapshot = {
        days_since_signup: Math.round(daysSinceSignup * 10) / 10,
        fatigue_score: contact.fatigue_score ?? 0,
      };

      // ── DAY 2: Value / discovery (no discount) ────────────
      if (daysSinceSignup >= 2 && !(await alreadySent(sb, contact.id, "welcome_day_2"))) {
        const shortCode = generateShortCode();
        const trackingUrl = `karrykraze.com/r/?c=${shortCode}`;

        const smsBody = `Karry Kraze: See what everyone's grabbing right now \u{1F440}\n${trackingUrl}\nReply STOP to opt out`;

        const result = await sendViaSendSms({
          to:                  contact.phone,
          body:                smsBody,
          message_type:        "welcome_discovery",
          intent:              "marketing",
          campaign:            "welcome_series",
          contact_id:          contact.id,
          flow:                "welcome_series",
          send_reason:         "welcome_day_2",
          short_code:          shortCode,
          redirect_url:        targetUrl,
          user_state_snapshot: snapshot,
        });

        if (result === "sent") results.day2_sent++; else results.skipped++;
        continue; // Don't check Day 5 in same run
      }

      // ── DAY 5: Conversion push (10% off, only if no purchase) ─
      if (daysSinceSignup >= 5
        && await alreadySent(sb, contact.id, "welcome_day_2")
        && !(await alreadySent(sb, contact.id, "welcome_day_5"))) {

        // Suppress if they already purchased
        if (await hasPurchased(sb, contact.phone, contact.created_at)) {
          results.skipped++;
          continue;
        }

        // Generate unique WS coupon (10% off, no minimum, 48hr, single-use)
        let couponCode = "";
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = generateCouponCode("WS");
          const { data: dup } = await sb
            .from("promotions")
            .select("id")
            .eq("code", candidate)
            .maybeSingle();
          if (!dup) { couponCode = candidate; break; }
        }

        if (!couponCode) {
          console.error("[sms-welcome-series] Failed to generate coupon code");
          results.skipped++;
          continue;
        }

        const expiresAt = new Date(now + 48 * 60 * 60 * 1000).toISOString();

        const { error: promoErr } = await sb.from("promotions").insert({
          name:             `Welcome Series — ${couponCode}`,
          code:             couponCode,
          description:      `Welcome series Day 5 coupon for ${contact.phone}`,
          type:             "percentage",
          value:            10,
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
        });

        if (promoErr) {
          console.error("[sms-welcome-series] Coupon create error:", promoErr.message);
          results.skipped++;
          continue;
        }

        const shortCode = generateShortCode();
        const trackingUrl = `karrykraze.com/r/?c=${shortCode}`;

        const smsBody = `Karry Kraze: Still thinking about it? Here's 10% off — just for you. Use ${couponCode} at checkout: ${trackingUrl}\nExpires in 48hrs. Reply STOP to opt out`;

        const result = await sendViaSendSms({
          to:                  contact.phone,
          body:                smsBody,
          message_type:        "welcome_conversion",
          intent:              "marketing",
          campaign:            "welcome_series",
          contact_id:          contact.id,
          flow:                "welcome_series",
          send_reason:         "welcome_day_5",
          short_code:          shortCode,
          redirect_url:        targetUrl,
          user_state_snapshot: { ...snapshot, coupon_code: couponCode },
        });

        if (result === "sent") results.day5_sent++; else results.skipped++;
      }
    }

    return json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sms-welcome-series] Unexpected error:", msg);
    return json({ error: msg }, 500);
  }
});
