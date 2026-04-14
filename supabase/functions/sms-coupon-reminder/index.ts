// supabase/functions/sms-coupon-reminder/index.ts
// Cron-triggered: sends coupon reminders (24h) and coupon escalations (expired → 20% upgrade)
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
  const etHour = (now.getUTCHours() - 4 + 24) % 24;
  return etHour >= 21 || etHour < 9;
}

/** Generate a unique coupon code */
function generateCouponCode(prefix: string): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

/** Send SMS via Twilio, log to sms_messages + sms_sends, update last_sms_sent_at */
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
    console.error(`[sms-coupon-reminder] Failed to send to ${opts.phone}:`, twilioData.message);
  }

  return twilioResp.ok;
}

/** Check if contact passes frequency cap (6hr gap) */
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (isQuietHours()) {
      return json({ skipped: true, reason: "quiet_hours" });
    }

    const sb = createClient(supabaseUrl, serviceKey);
    const results = { reminders: { sent: 0, skipped: 0 }, escalations: { sent: 0, skipped: 0 } };

    // ═══════════════════════════════════════════════════════
    // PASS 1: COUPON REMINDERS (24h since signup, coupon still valid)
    // ═══════════════════════════════════════════════════════
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: reminderContacts } = await sb
      .from("customer_contacts")
      .select("id, phone, coupon_code")
      .eq("status", "active")
      .eq("sms_consent", true)
      .not("coupon_code", "is", null)
      .lte("opted_in_at", twentyFourHoursAgo)
      .gte("opted_in_at", fortyEightHoursAgo);

    for (const contact of reminderContacts || []) {
      // Already sent a reminder?
      const { count } = await sb
        .from("sms_sends")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", contact.id)
        .eq("flow", "coupon_reminder");

      if ((count ?? 0) > 0) { results.reminders.skipped++; continue; }

      // Coupon still valid and unused?
      const { data: promo } = await sb
        .from("promotions")
        .select("id, usage_count, is_active, end_date")
        .eq("code", contact.coupon_code)
        .maybeSingle();

      if (!promo || !promo.is_active || (promo.usage_count ?? 0) > 0) {
        results.reminders.skipped++; continue;
      }
      if (promo.end_date && new Date(promo.end_date) < new Date()) {
        results.reminders.skipped++; continue;
      }

      // Frequency cap
      if (!(await passesFrequencyCap(sb, contact.id))) {
        results.reminders.skipped++; continue;
      }

      const shortCode = generateShortCode();
      const trackingUrl = `karrykraze.com/r/?c=${shortCode}`;
      const targetUrl = "https://karrykraze.com/pages/catalog.html";

      const smsBody = `Karry Kraze: Don't forget your code ${contact.coupon_code}! ` +
        `It expires soon. Shop now: ${trackingUrl}\n` +
        `Reply STOP to opt out`;

      const ok = await sendAndLog(sb, {
        phone: contact.phone,
        contactId: contact.id,
        smsBody,
        shortCode,
        targetUrl,
        campaign: "coupon_reminder",
        flow: "coupon_reminder",
        sendReason: "unused_coupon_24h",
        messageType: "reminder",
        snapshot: { coupon_code: contact.coupon_code, hours_since_signup: 24 },
      });

      if (ok) results.reminders.sent++; else results.reminders.skipped++;
    }

    // ═══════════════════════════════════════════════════════
    // PASS 2: COUPON ESCALATION (coupon expired unused → upgrade to 20%)
    // ═══════════════════════════════════════════════════════
    // Find contacts whose coupon expired, was never used, and who haven't
    // received an escalation yet (lifetime limit: 1 escalation per phone ever)

    const { data: allActive } = await sb
      .from("customer_contacts")
      .select("id, phone, coupon_code")
      .eq("status", "active")
      .eq("sms_consent", true)
      .not("coupon_code", "is", null);

    for (const contact of allActive || []) {
      // Check if coupon exists and is expired + unused
      const { data: promo } = await sb
        .from("promotions")
        .select("id, code, usage_count, is_active, end_date, value, type, min_order_amount")
        .eq("code", contact.coupon_code)
        .maybeSingle();

      if (!promo) { results.escalations.skipped++; continue; }

      const isUsed = (promo.usage_count ?? 0) > 0;
      const isExpired = promo.end_date && new Date(promo.end_date) < new Date();

      // Only escalate if coupon expired AND was never used
      if (!isExpired || isUsed) { results.escalations.skipped++; continue; }

      // LIFETIME CHECK: has this phone EVER received an escalation?
      const { count: escalationCount } = await sb
        .from("sms_sends")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", contact.id)
        .eq("flow", "coupon_escalation");

      if ((escalationCount ?? 0) > 0) { results.escalations.skipped++; continue; }

      // Frequency cap
      if (!(await passesFrequencyCap(sb, contact.id))) {
        results.escalations.skipped++; continue;
      }

      // Generate new escalated coupon: 20% off $40+, 48hr expiry
      let newCode = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateCouponCode("SMS");
        const { data: dup } = await sb
          .from("promotions")
          .select("id")
          .eq("code", candidate)
          .maybeSingle();
        if (!dup) { newCode = candidate; break; }
      }
      if (!newCode) { results.escalations.skipped++; continue; }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 48hr

      const { error: promoErr } = await sb.from("promotions").insert({
        name:             `SMS Escalation — ${newCode}`,
        code:             newCode,
        description:      `Escalated coupon for ${contact.phone} (original: ${promo.code})`,
        type:             "percentage",
        value:            20,
        scope_type:       "all",
        scope_data:       "{}",
        min_order_amount: promo.min_order_amount ?? 40,
        usage_limit:      1,
        usage_count:      0,
        start_date:       now.toISOString(),
        end_date:         expiresAt.toISOString(),
        is_active:        true,
        is_public:        true,
        requires_code:    true,
      });

      if (promoErr) {
        console.error("[sms-coupon-reminder] escalation promo error:", promoErr.message);
        results.escalations.skipped++;
        continue;
      }

      // Update contact's coupon_code to the new one
      await sb.from("customer_contacts")
        .update({ coupon_code: newCode })
        .eq("id", contact.id);

      // Deactivate old coupon
      await sb.from("promotions")
        .update({ is_active: false })
        .eq("id", promo.id);

      const shortCode = generateShortCode();
      const trackingUrl = `karrykraze.com/r/?c=${shortCode}`;
      const targetUrl = "https://karrykraze.com/pages/catalog.html";

      const smsBody = `Karry Kraze: We upgraded your discount! Use code ${newCode} for 20% off ` +
        `orders $${promo.min_order_amount ?? 40}+. Expires in 48hrs! ${trackingUrl}\n` +
        `Reply STOP to opt out`;

      const ok = await sendAndLog(sb, {
        phone: contact.phone,
        contactId: contact.id,
        smsBody,
        shortCode,
        targetUrl,
        campaign: "coupon_escalation",
        flow: "coupon_escalation",
        sendReason: "expired_coupon_upgrade",
        messageType: "coupon_delivery",
        snapshot: {
          original_coupon: promo.code,
          original_value: promo.value,
          escalated_value: 20,
          hours_since_signup: Math.round((Date.now() - new Date(contact.coupon_code).getTime()) / 3600000) || "unknown",
        },
      });

      if (ok) results.escalations.sent++; else results.escalations.skipped++;
    }

    console.log(`[sms-coupon-reminder] Done:`, JSON.stringify(results));

    return json({
      ...results,
      message: `Reminders: ${results.reminders.sent} sent, ${results.reminders.skipped} skipped. ` +
        `Escalations: ${results.escalations.sent} sent, ${results.escalations.skipped} skipped.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sms-coupon-reminder] error:", msg);
    return json({ error: msg }, 500);
  }
});
