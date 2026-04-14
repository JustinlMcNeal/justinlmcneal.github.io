// supabase/functions/send-sms/index.ts
// Internal Twilio SMS sending utility — used by other edge functions
// Enforces: frequency caps, quiet hours, consent checks (marketing only)
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

/** Check if current time is within quiet hours (9 PM - 9 AM ET) */
function isQuietHours(): boolean {
  const now = new Date();
  const etHour = (now.getUTCHours() - 4 + 24) % 24;
  return etHour >= 21 || etHour < 9;
}

interface SendRequest {
  to:            string;   // E.164 phone
  body:          string;   // message text
  message_type:  string;   // 'coupon_delivery' | 'reminder' | 'campaign' | 'transactional'
  intent?:       string;   // 'marketing' | 'transactional' | 'system' — defaults to 'marketing'
  campaign?:     string;   // e.g. 'sms_signup_coupon'
  contact_id?:   string;   // UUID of customer_contacts row
  skip_caps?:    boolean;  // caller already checked caps (e.g. sms-subscribe first message)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const payload = await req.json() as SendRequest;
    const { to, body, message_type, campaign, contact_id } = payload;
    const intent = payload.intent || "marketing";
    const skipCaps = payload.skip_caps === true;

    if (!to || !body || !message_type) {
      return json({ error: "Missing required fields: to, body, message_type" }, 400);
    }

    const sb = createClient(supabaseUrl, serviceKey);

    // ── Marketing guardrails (skipped for transactional/system) ──
    if (intent === "marketing" && !skipCaps) {
      // 1. Quiet hours
      if (isQuietHours()) {
        return json({ blocked: true, reason: "quiet_hours", message: "Marketing SMS blocked: quiet hours (9 PM – 9 AM ET)" });
      }

      // 2. Consent + status check
      if (contact_id) {
        const { data: contact } = await sb
          .from("customer_contacts")
          .select("status, sms_consent, last_sms_sent_at")
          .eq("id", contact_id)
          .single();

        if (contact) {
          if (contact.status !== "active" || !contact.sms_consent) {
            return json({ blocked: true, reason: "no_consent", message: "Contact is not opted in" });
          }

          // 3. Frequency cap: min 6 hours between marketing SMS
          if (contact.last_sms_sent_at) {
            const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
            if (new Date(contact.last_sms_sent_at) > sixHoursAgo) {
              return json({ blocked: true, reason: "frequency_cap", message: "Min 6 hours between marketing SMS" });
            }
          }
        }
      }

      // 4. Daily cap: max 1 marketing SMS per day per phone
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const { count: todayCount } = await sb
        .from("sms_sends")
        .select("id", { count: "exact", head: true })
        .eq("phone", to)
        .eq("intent", "marketing")
        .gte("created_at", todayStart.toISOString());

      if ((todayCount ?? 0) >= 1) {
        return json({ blocked: true, reason: "daily_cap", message: "Max 1 marketing SMS per day" });
      }

      // 5. Weekly cap: max 4 marketing SMS per week per phone
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: weekCount } = await sb
        .from("sms_sends")
        .select("id", { count: "exact", head: true })
        .eq("phone", to)
        .eq("intent", "marketing")
        .gte("created_at", weekAgo);

      if ((weekCount ?? 0) >= 4) {
        return json({ blocked: true, reason: "weekly_cap", message: "Max 4 marketing SMS per week" });
      }
    }

    // ── Send via Twilio REST API ──────────────────────────────
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
    const formData  = new URLSearchParams();
    formData.set("To",   to);
    formData.set("From", TWILIO_FROM);
    formData.set("Body", body);
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
      console.error("[send-sms] Twilio error:", JSON.stringify(twilioData));

      // Log the failed attempt
      await sb.from("sms_messages").insert({
        phone:        to,
        contact_id:   contact_id || null,
        message_body: body,
        message_type,
        campaign:     campaign || null,
        status:       "failed",
        error_code:   String(twilioData.code   || twilioResp.status),
        error_message: twilioData.message || "Twilio API error",
      });

      return json({ error: "SMS send failed", details: twilioData.message }, 502);
    }

    // ── Log the sent message ─────────────────────────────────
    const { data: msgRow, error: dbErr } = await sb.from("sms_messages").insert({
      phone:               to,
      contact_id:          contact_id || null,
      message_body:        body,
      message_type,
      campaign:            campaign || null,
      status:              "sent",
      provider_message_sid: twilioData.sid,
      sent_at:             new Date().toISOString(),
    }).select("id").single();

    if (dbErr) console.error("[send-sms] DB log error:", dbErr.message);

    // Log to sms_sends for analytics
    if (msgRow) {
      await sb.from("sms_sends").insert({
        phone:          to,
        contact_id:     contact_id || null,
        campaign:       campaign || null,
        flow:           campaign || message_type,
        send_reason:    message_type,
        intent,
        outcome:        "pending",
        cost:           0.0079,
        sms_message_id: msgRow.id,
      });
    }

    // Update last_sms_sent_at for frequency caps
    if (contact_id && intent === "marketing") {
      await sb.from("customer_contacts")
        .update({ last_sms_sent_at: new Date().toISOString() })
        .eq("id", contact_id);
    }

    return json({
      success: true,
      message_sid: twilioData.sid,
      status:      twilioData.status,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-sms] Unexpected error:", msg);
    return json({ error: msg }, 500);
  }
});
