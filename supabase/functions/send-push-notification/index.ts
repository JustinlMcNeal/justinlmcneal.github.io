// supabase/functions/send-push-notification/index.ts
// Sends web push notifications to subscribed browsers
// Uses the Web Push protocol (VAPID + RFC 8291 encryption)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Web Push library for Deno
import webpush from "npm:web-push@3.6.7";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "POST required" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!vapidPublicKey || !vapidPrivateKey) {
      return json({ error: "VAPID keys not configured" }, 500);
    }

    webpush.setVapidDetails(
      "mailto:admin@karrykraze.com",
      vapidPublicKey,
      vapidPrivateKey
    );

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const {
      title = "KARRY KRAZE",
      body: notifBody = "",
      url = "/",
      image = null,
      tag = null,
      target = "all", // 'all' | 'admin' | 'customers'
      actions = null,
    } = body;

    // Fetch active subscriptions based on target
    let query = supabase
      .from("push_subscriptions")
      .select("id, endpoint, keys_p256dh, keys_auth")
      .eq("is_active", true);

    if (target === "admin") {
      query = query.eq("is_admin", true);
    } else if (target === "customers") {
      query = query.eq("is_admin", false);
    }

    const { data: subscriptions, error: fetchErr } = await query;

    if (fetchErr) {
      console.error("[send-push] Failed to fetch subscriptions:", fetchErr);
      return json({ error: "Failed to fetch subscriptions" }, 500);
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log("[send-push] No active subscriptions found for target:", target);
      return json({ success: true, sent: 0, failed: 0, message: "No subscriptions" });
    }

    const payload = JSON.stringify({
      title,
      body: notifBody,
      url,
      image,
      tag: tag || `kk-${Date.now()}`,
      actions: actions || [
        { action: "open", title: "Open" },
        { action: "dismiss", title: "Dismiss" },
      ],
    });

    let sent = 0;
    let failed = 0;
    const staleIds: string[] = [];

    // Send to all subscriptions in parallel (batches of 10)
    const batchSize = 10;
    for (let i = 0; i < subscriptions.length; i += batchSize) {
      const batch = subscriptions.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (sub) => {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys_p256dh,
              auth: sub.keys_auth,
            },
          };

          try {
            await webpush.sendNotification(pushSubscription, payload, {
              TTL: 86400, // 24 hours
              urgency: "normal",
            });
            return { id: sub.id, success: true };
          } catch (err: any) {
            console.error(`[send-push] Failed for ${sub.endpoint.slice(0, 50)}...`, err.statusCode || err.message);

            // 404 or 410 = subscription no longer valid
            if (err.statusCode === 404 || err.statusCode === 410) {
              staleIds.push(sub.id);
            }

            return { id: sub.id, success: false, error: err.statusCode || err.message };
          }
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value.success) sent++;
        else failed++;
      }
    }

    // Clean up stale subscriptions
    if (staleIds.length > 0) {
      const { error: delErr } = await supabase
        .from("push_subscriptions")
        .update({ is_active: false })
        .in("id", staleIds);

      if (delErr) {
        console.error("[send-push] Failed to deactivate stale subs:", delErr);
      } else {
        console.log(`[send-push] Deactivated ${staleIds.length} stale subscriptions`);
      }
    }

    // Update last_push_at for successful sends
    if (sent > 0) {
      const successIds = subscriptions
        .filter((s) => !staleIds.includes(s.id))
        .map((s) => s.id);

      if (successIds.length) {
        await supabase
          .from("push_subscriptions")
          .update({ last_push_at: new Date().toISOString() })
          .in("id", successIds);
      }
    }

    // Log the notification
    await supabase.from("push_notifications_log").insert({
      title,
      body: notifBody,
      url,
      image,
      tag: tag || null,
      target,
      sent_count: sent,
      failed_count: failed,
    });

    console.log(`[send-push] Done: ${sent} sent, ${failed} failed, ${staleIds.length} stale`);

    return json({
      success: true,
      sent,
      failed,
      stale_removed: staleIds.length,
      total_subscriptions: subscriptions.length,
    });
  } catch (err) {
    console.error("[send-push] Error:", err);
    return json({ error: String(err) }, 500);
  }
});
