// supabase/functions/sms-coupon-reminder/index.ts
// Cron-triggered: finds subscribers with unused coupons after 24h, sends reminder SMS
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

/** Generate a short code for click tracking links */
function generateShortCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Check if current time is within quiet hours (9 PM - 9 AM ET) */
function isQuietHours(): boolean {
  const now = new Date();
  // Convert to ET (approximate: UTC-4 for EDT, UTC-5 for EST)
  const etHour = (now.getUTCHours() - 4 + 24) % 24;
  return etHour >= 21 || etHour < 9;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // Enforce quiet hours — don't send marketing SMS outside 9 AM - 9 PM
    if (isQuietHours()) {
      return json({ skipped: true, reason: "quiet_hours" });
    }

    const sb = createClient(supabaseUrl, serviceKey);

    // Find contacts who:
    // 1. Have a coupon code (signed up via SMS)
    // 2. Signed up more than 24 hours ago
    // 3. Are still active
    // 4. Have SMS consent
    // 5. Haven't had a reminder sent yet (check sms_sends for flow='coupon_reminder')
    // 6. Coupon hasn't been used (usage_count = 0 on promotions)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Get contacts who subscribed 24-48h ago with unused coupons
    const { data: contacts, error: fetchErr } = await sb
      .from("customer_contacts")
      .select("id, phone, coupon_code")
      .eq("status", "active")
      .eq("sms_consent", true)
      .not("coupon_code", "is", null)
      .lte("opted_in_at", twentyFourHoursAgo)
      .gte("opted_in_at", fortyEightHoursAgo);

    if (fetchErr) {
      console.error("[sms-coupon-reminder] fetch contacts error:", fetchErr.message);
      return json({ error: "Failed to fetch contacts" }, 500);
    }

    if (!contacts || contacts.length === 0) {
      return json({ sent: 0, message: "No eligible contacts" });
    }

    let sent = 0;
    let skipped = 0;

    for (const contact of contacts) {
      // Check if reminder already sent for this contact
      const { count: reminderCount } = await sb
        .from("sms_sends")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", contact.id)
        .eq("flow", "coupon_reminder");

      if ((reminderCount ?? 0) > 0) {
        skipped++;
        continue;
      }

      // Check coupon is still active and unused
      const { data: promo } = await sb
        .from("promotions")
        .select("id, usage_count, is_active, end_date")
        .eq("code", contact.coupon_code)
        .maybeSingle();

      if (!promo || !promo.is_active || (promo.usage_count ?? 0) > 0) {
        skipped++;
        continue;
      }

      // Check coupon hasn't expired
      if (promo.end_date && new Date(promo.end_date) < new Date()) {
        skipped++;
        continue;
      }

      // Check frequency cap: at least 6 hours since last SMS
      const { data: lastSend } = await sb
        .from("customer_contacts")
        .select("last_sms_sent_at")
        .eq("id", contact.id)
        .single();

      if (lastSend?.last_sms_sent_at) {
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
        if (new Date(lastSend.last_sms_sent_at) > sixHoursAgo) {
          skipped++;
          continue;
        }
      }

      // Generate click tracking
      const shortCode = generateShortCode();
      const trackingUrl = `karrykraze.com/r/?c=${shortCode}`;
      const targetUrl = "https://karrykraze.com/pages/catalog.html";

      const smsBody = `Karry Kraze: Don't forget your code ${contact.coupon_code}! ` +
        `It expires soon. Shop now: ${trackingUrl}\n` +
        `Reply STOP to opt out`;

      // Send via Twilio
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
      const formData = new URLSearchParams();
      formData.set("To", contact.phone);
      formData.set("From", TWILIO_FROM);
      formData.set("Body", smsBody);
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

      // Log message
      const { data: msgRow } = await sb.from("sms_messages").insert({
        phone:               contact.phone,
        contact_id:          contact.id,
        message_body:        smsBody,
        message_type:        "reminder",
        campaign:            "coupon_reminder",
        status,
        provider_message_sid: twilioData.sid || null,
        error_code:          !twilioResp.ok ? String(twilioData.code || twilioResp.status) : null,
        error_message:       !twilioResp.ok ? (twilioData.message || "Twilio API error") : null,
        sent_at:             twilioResp.ok ? new Date().toISOString() : null,
        short_code:          shortCode,
        redirect_url:        targetUrl,
      }).select("id").single();

      // Log sms_sends
      if (msgRow) {
        await sb.from("sms_sends").insert({
          phone:           contact.phone,
          contact_id:      contact.id,
          campaign:        "coupon_reminder",
          flow:            "coupon_reminder",
          send_reason:     "unused_coupon_24h",
          intent:          "marketing",
          outcome:         "pending",
          cost:            0.0079,
          sms_message_id:  msgRow.id,
          user_state_snapshot: { coupon_code: contact.coupon_code, hours_since_signup: 24 },
        });
      }

      // Update last_sms_sent_at
      if (twilioResp.ok) {
        await sb.from("customer_contacts")
          .update({ last_sms_sent_at: new Date().toISOString() })
          .eq("id", contact.id);
        sent++;
      }

      if (!twilioResp.ok) {
        console.error(`[sms-coupon-reminder] Failed to send to ${contact.phone}:`, twilioData.message);
      }
    }

    console.log(`[sms-coupon-reminder] Done: sent=${sent}, skipped=${skipped}, total=${contacts.length}`);

    return json({
      sent,
      skipped,
      total: contacts.length,
      message: `Processed ${contacts.length} contacts: ${sent} sent, ${skipped} skipped`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sms-coupon-reminder] error:", msg);
    return json({ error: msg }, 500);
  }
});
