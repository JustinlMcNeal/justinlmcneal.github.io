// supabase/functions/send-sms/index.ts
// Internal Twilio SMS sending utility — used by other edge functions
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

interface SendRequest {
  to:            string;   // E.164 phone
  body:          string;   // message text
  message_type:  string;   // 'coupon_delivery' | 'reminder' | 'campaign' | 'transactional'
  campaign?:     string;   // e.g. 'sms_signup_coupon'
  contact_id?:   string;   // UUID of customer_contacts row
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { to, body, message_type, campaign, contact_id } = await req.json() as SendRequest;

    if (!to || !body || !message_type) {
      return json({ error: "Missing required fields: to, body, message_type" }, 400);
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
      const sb = createClient(supabaseUrl, serviceKey);
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
    const sb = createClient(supabaseUrl, serviceKey);
    const { error: dbErr } = await sb.from("sms_messages").insert({
      phone:               to,
      contact_id:          contact_id || null,
      message_body:        body,
      message_type,
      campaign:            campaign || null,
      status:              "sent",
      provider_message_sid: twilioData.sid,
      sent_at:             new Date().toISOString(),
    });

    if (dbErr) console.error("[send-sms] DB log error:", dbErr.message);

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
