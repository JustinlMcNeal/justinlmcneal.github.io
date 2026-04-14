// supabase/functions/twilio-webhook/index.ts
// Receives Twilio callbacks: delivery status updates + inbound STOP messages
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);

// ── Twilio signature validation ─────────────────────────────

function validateTwilioSignature(url: string, params: Record<string, string>, signature: string): boolean {
  // Build the data string: URL + sorted params concatenated
  const keys = Object.keys(params).sort();
  let data = url;
  for (const key of keys) {
    data += key + params[key];
  }

  const computed = hmac("sha1", TWILIO_TOKEN, data, "utf8", "base64") as string;
  // Constant-time comparison
  if (computed.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

// ── Helpers ──────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw; // return as-is if can't normalize
}

Deno.serve(async (req) => {
  // No CORS needed — Twilio server-to-server only
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // ── Parse form-encoded body ────────────────────────────
    const formText = await req.text();
    const params: Record<string, string> = {};
    for (const pair of formText.split("&")) {
      const [key, val] = pair.split("=").map(decodeURIComponent);
      if (key) params[key] = val || "";
    }

    // ── Validate Twilio signature ──────────────────────────
    const signature = req.headers.get("X-Twilio-Signature") || "";
    const webhookUrl = `${supabaseUrl}/functions/v1/twilio-webhook`;

    if (!validateTwilioSignature(webhookUrl, params, signature)) {
      console.warn("[twilio-webhook] Invalid signature — rejecting request");
      return new Response("Forbidden", { status: 403 });
    }

    const sb = createClient(supabaseUrl, serviceKey);

    // ── Determine callback type ────────────────────────────
    const messageSid    = params.MessageSid    || params.SmsSid || "";
    const messageStatus = params.MessageStatus || params.SmsStatus || "";
    const inboundBody   = (params.Body || "").trim().toUpperCase();
    const from          = params.From || "";

    // ═══ INBOUND MESSAGE (opt-out handling) ════════════════
    if (inboundBody && STOP_WORDS.has(inboundBody)) {
      const phone = normalizePhone(from);
      console.log(`[twilio-webhook] STOP received from ${phone}`);

      // Update contact status
      const { data: contact } = await sb
        .from("customer_contacts")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();

      if (contact) {
        await sb
          .from("customer_contacts")
          .update({
            status:       "unsubscribed",
            sms_consent:  false,
            opted_out_at: new Date().toISOString(),
          })
          .eq("id", contact.id);

        // Log consent change
        await sb.from("sms_consent_logs").insert({
          phone,
          consent_type: "opt_out",
          consent_text: `User replied: ${inboundBody}`,
          source:       "twilio_stop",
        });

        console.log(`[twilio-webhook] Contact ${contact.id} unsubscribed`);
      } else {
        console.log(`[twilio-webhook] STOP from unknown phone: ${phone}`);
      }

      // Twilio handles the STOP auto-reply via Advanced Opt-Out
      return new Response("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    // ═══ DELIVERY STATUS UPDATE ════════════════════════════
    if (messageSid && messageStatus) {
      const statusMap: Record<string, string> = {
        queued:      "queued",
        sent:        "sent",
        delivered:   "delivered",
        undelivered: "undelivered",
        failed:      "failed",
      };

      const mappedStatus = statusMap[messageStatus] || null;
      if (mappedStatus) {
        const updates: Record<string, unknown> = { status: mappedStatus };
        if (mappedStatus === "delivered") updates.delivered_at = new Date().toISOString();
        if (mappedStatus === "failed" || mappedStatus === "undelivered") {
          updates.error_code    = params.ErrorCode    || null;
          updates.error_message = params.ErrorMessage || null;
        }

        const { error: updErr } = await sb
          .from("sms_messages")
          .update(updates)
          .eq("provider_message_sid", messageSid);

        if (updErr) {
          console.error("[twilio-webhook] Status update error:", updErr.message);
        } else {
          console.log(`[twilio-webhook] Message ${messageSid} → ${mappedStatus}`);
        }

        // If message bounced, mark contact as bounced
        if (mappedStatus === "undelivered" || mappedStatus === "failed") {
          const errorCode = params.ErrorCode || "";
          // 30005 = unknown destination, 30006 = landline, 21610 = unsubscribed
          if (["30005", "30006", "21610"].includes(errorCode)) {
            const { data: msgRow } = await sb
              .from("sms_messages")
              .select("phone")
              .eq("provider_message_sid", messageSid)
              .maybeSingle();

            if (msgRow?.phone) {
              await sb
                .from("customer_contacts")
                .update({ status: "bounced", sms_consent: false })
                .eq("phone", msgRow.phone);

              console.log(`[twilio-webhook] Contact ${msgRow.phone} marked bounced (${errorCode})`);
            }
          }
        }
      }
    }

    return new Response("<Response></Response>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[twilio-webhook] Unexpected error:", msg);
    // Return 200 to prevent Twilio retries on our errors
    return new Response("<Response></Response>", {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }
});
