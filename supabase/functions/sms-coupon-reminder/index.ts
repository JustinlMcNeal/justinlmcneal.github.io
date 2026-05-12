// supabase/functions/sms-coupon-reminder/index.ts
// Cron-triggered: sends coupon reminders (24h) and coupon escalations (expired → 20% upgrade)
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

/** Generate a short code for click tracking links */
function generateShortCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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
    console.warn("[sms-coupon-reminder] send-sms did not succeed:", JSON.stringify(data));
    return "failed";
  } catch (err: unknown) {
    console.error("[sms-coupon-reminder] send-sms call failed:",
      err instanceof Error ? err.message : String(err));
    return "failed";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const sb = createClient(supabaseUrl, serviceKey);
    const results = { reminders: { sent: 0, skipped: 0 }, escalations: { sent: 0, skipped: 0 } };

    // ═══════════════════════════════════════════════════════
    // PASS 1: COUPON REMINDERS (24h since signup, coupon still valid)
    // ═══════════════════════════════════════════════════════
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: reminderContacts } = await sb
      .from("customer_contacts")
      .select("id, phone, coupon_code, opted_in_at")
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

      const shortCode = generateShortCode();
      const trackingUrl = `karrykraze.com/r/?c=${shortCode}`;
      const targetUrl = "https://karrykraze.com/pages/catalog.html";

      const smsBody = `Karry Kraze: Don't forget your code ${contact.coupon_code}! ` +
        `It expires soon. Shop now: ${trackingUrl}\n` +
        `Reply STOP to opt out`;

      const result = await sendViaSendSms({
        to:                  contact.phone,
        body:                smsBody,
        message_type:        "reminder",
        intent:              "marketing",
        campaign:            "coupon_reminder",
        contact_id:          contact.id,
        flow:                "coupon_reminder",
        send_reason:         "unused_coupon_24h",
        short_code:          shortCode,
        redirect_url:        targetUrl,
        user_state_snapshot: { coupon_code: contact.coupon_code, hours_since_signup: 24 },
      });

      if (result === "sent") results.reminders.sent++; else results.reminders.skipped++;
    }

    // ═══════════════════════════════════════════════════════
    // PASS 2: COUPON ESCALATION (coupon expired unused → upgrade to 20%)
    // ═══════════════════════════════════════════════════════
    // Find contacts whose coupon expired, was never used, and who haven't
    // received an escalation yet (lifetime limit: 1 escalation per phone ever)

    const { data: allActive } = await sb
      .from("customer_contacts")
      .select("id, phone, coupon_code, opted_in_at")
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

      const result = await sendViaSendSms({
        to:                  contact.phone,
        body:                smsBody,
        message_type:        "coupon_delivery",
        intent:              "marketing",
        campaign:            "coupon_escalation",
        contact_id:          contact.id,
        flow:                "coupon_escalation",
        send_reason:         "expired_coupon_upgrade",
        short_code:          shortCode,
        redirect_url:        targetUrl,
        user_state_snapshot: {
          original_coupon: promo.code,
          original_value: promo.value,
          escalated_value: 20,
          hours_since_signup: contact.opted_in_at
            ? Math.round((Date.now() - new Date(contact.opted_in_at).getTime()) / 3600000)
            : "unknown",
        },
      });

      if (result === "sent") results.escalations.sent++; else results.escalations.skipped++;
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
