// supabase/functions/sms-welcome-series/index.ts
// Cron-triggered: sends 2-step welcome series after signup.
// Day 2: Value/discovery message (no discount)
// Day 5: 10% off conversion push (only if no purchase yet)
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

/** Check 6-hour gap between marketing SMS */
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
    console.error(`[sms-welcome-series] Failed to send to ${opts.phone}:`, twilioData.message);
  }

  return twilioResp.ok;
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
    if (isQuietHours()) {
      return json({ skipped: true, reason: "quiet_hours" });
    }

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

      // ── Frequency cap ──────────────────────────────────────
      if (!(await passesFrequencyCap(sb, contact.id))) {
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

        const sent = await sendAndLog(sb, {
          phone: contact.phone,
          contactId: contact.id,
          smsBody,
          shortCode,
          targetUrl,
          campaign: "welcome_series",
          flow: "welcome_series",
          sendReason: "welcome_day_2",
          messageType: "welcome_discovery",
          snapshot,
        });

        if (sent) results.day2_sent++;
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

        const sent = await sendAndLog(sb, {
          phone: contact.phone,
          contactId: contact.id,
          smsBody,
          shortCode,
          targetUrl,
          campaign: "welcome_series",
          flow: "welcome_series",
          sendReason: "welcome_day_5",
          messageType: "welcome_conversion",
          snapshot: { ...snapshot, coupon_code: couponCode },
        });

        if (sent) results.day5_sent++;
      }
    }

    return json({ results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sms-welcome-series] Unexpected error:", msg);
    return json({ error: msg }, 500);
  }
});
