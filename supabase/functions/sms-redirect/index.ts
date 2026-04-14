// supabase/functions/sms-redirect/index.ts
// Click tracking redirect: /r/{short_code} → log click → 302 redirect to target URL
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL    = "https://karrykraze.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const url = new URL(req.url);

    // Extract short_code from path: /sms-redirect/{short_code}
    // or from query param: ?code={short_code}
    const pathParts = url.pathname.split("/").filter(Boolean);
    const shortCode = pathParts[pathParts.length - 1] === "sms-redirect"
      ? url.searchParams.get("code") || ""
      : pathParts[pathParts.length - 1] || url.searchParams.get("code") || "";

    if (!shortCode || shortCode === "sms-redirect") {
      return new Response("Missing redirect code", { status: 400 });
    }

    const sb = createClient(supabaseUrl, serviceKey);

    // Look up the message by short_code
    const { data: msg, error: msgErr } = await sb
      .from("sms_messages")
      .select("id, phone, redirect_url, contact_id")
      .eq("short_code", shortCode)
      .maybeSingle();

    if (msgErr || !msg) {
      console.error("[sms-redirect] lookup failed:", msgErr?.message || "not found");
      // Fallback to homepage
      return new Response(null, {
        status: 302,
        headers: { Location: SITE_URL },
      });
    }

    const targetUrl = msg.redirect_url || SITE_URL;

    // Log click event (fire-and-forget, don't block redirect)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("cf-connecting-ip")
            || null;

    // Find the corresponding sms_send
    const { data: send } = await sb
      .from("sms_sends")
      .select("id")
      .eq("sms_message_id", msg.id)
      .maybeSingle();

    // Insert click event
    sb.from("sms_events").insert({
      event_type:     "sms_clicked",
      phone:          msg.phone,
      sms_message_id: msg.id,
      sms_send_id:    send?.id || null,
      metadata: {
        ip,
        user_agent: req.headers.get("user-agent") || null,
        redirect_url: targetUrl,
        clicked_at: new Date().toISOString(),
      },
    }).then(({ error }) => {
      if (error) console.error("[sms-redirect] event insert failed:", error.message);
    });

    // Update customer_contacts.last_click_at (for attribution window)
    if (msg.phone) {
      sb.from("customer_contacts")
        .update({ last_sms_sent_at: new Date().toISOString() })
        .eq("phone", msg.phone)
        .then(({ error }) => {
          if (error) console.error("[sms-redirect] contact update failed:", error.message);
        });
    }

    // 302 redirect to target
    return new Response(null, {
      status: 302,
      headers: {
        Location: targetUrl,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sms-redirect] error:", msg);
    return new Response(null, {
      status: 302,
      headers: { Location: SITE_URL },
    });
  }
});
