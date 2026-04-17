// supabase/functions/send-review-request/index.ts
// Generates review JWT, sends SMS via Twilio, logs to sms_sends + review_requests.
// Called from admin panel "Send Review Requests" button.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID   = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM  = Deno.env.get("TWILIO_FROM_NUMBER")!;
const WEBHOOK_URL  = Deno.env.get("TWILIO_WEBHOOK_URL") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/* ── JWT helpers (HS256, no external deps) ── */
function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signJwt(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const enc = new TextEncoder();

  const headerB64 = btoa(JSON.stringify(header))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${headerB64}.${payloadB64}`)
  );

  return `${headerB64}.${payloadB64}.${base64url(sig)}`;
}

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ── SMS via Twilio ── */
async function sendSms(phone: string, body: string): Promise<{ ok: boolean; sid?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const form = new URLSearchParams();
  form.set("To", phone);
  form.set("From", TWILIO_FROM);
  form.set("Body", body);
  if (WEBHOOK_URL) form.set("StatusCallback", WEBHOOK_URL);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const data = await resp.json();
  return { ok: resp.ok, sid: data.sid };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const reviewSecret = Deno.env.get("REVIEW_TOKEN_SECRET");
    if (!reviewSecret) {
      return json({ error: "REVIEW_TOKEN_SECRET not configured" }, 500);
    }

    const sb = createClient(supabaseUrl, serviceKey);
    const body = await req.json();

    // Accept either a single order or a batch trigger
    // Single: { order_session_id, product_id, phone, email, first_name, product_name }
    // Batch:  { batch: true, days_ago?: number } — auto-finds eligible orders
    if (body.batch) {
      return await handleBatch(sb, reviewSecret, body.days_ago);
    }

    return await handleSingle(sb, reviewSecret, body);
  } catch (err: unknown) {
    console.error("[send-review-request] Error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function handleSingle(
  sb: ReturnType<typeof createClient>,
  reviewSecret: string,
  body: {
    order_session_id: string;
    product_id: string;
    phone: string;
    email: string;
    first_name?: string;
    product_name?: string;
    order_date?: string;
  }
): Promise<Response> {
  const { order_session_id, product_id, phone, email, first_name, product_name, order_date } = body;

  if (!order_session_id || !product_id || !phone || !email) {
    return json({ error: "Missing required fields: order_session_id, product_id, phone, email" }, 400);
  }

  // Check if already requested (UNIQUE constraint will also catch this)
  const { data: existing } = await sb
    .from("review_requests")
    .select("id")
    .eq("order_session_id", order_session_id)
    .eq("product_id", product_id)
    .single();

  if (existing) {
    return json({ error: "Review request already sent for this product on this order", skipped: true }, 409);
  }

  // Check if already reviewed
  const { data: existingReview } = await sb
    .from("reviews")
    .select("id")
    .eq("order_session_id", order_session_id)
    .eq("product_id", product_id)
    .single();

  if (existingReview) {
    return json({ error: "Product already reviewed on this order", skipped: true }, 409);
  }

  // Get review settings for discount info
  const { data: couponRow } = await sb
    .from("review_settings")
    .select("value")
    .eq("key", "coupon")
    .single();
  const couponSettings = couponRow?.value || { value: 5, type: "percentage" };
  const discountText = couponSettings.type === "percentage"
    ? `${couponSettings.value}%`
    : `$${couponSettings.value}`;

  // Generate JWT (30-day expiry)
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const token = await signJwt(
    { oid: order_session_id, pid: product_id, email, exp },
    reviewSecret
  );

  const tokenHash = await sha256hex(token);

  // Generate short code for clean SMS links
  const shortCode = crypto.randomUUID().replace(/-/g, "").slice(0, 10);

  // Build SMS
  const name = first_name || "there";
  const prodName = product_name || "your purchase";
  const link = `https://karrykraze.com/pages/leave-review.html?r=${shortCode}`;
  const dateLine = order_date
    ? ` from your ${new Date(order_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} order`
    : "";
  const smsBody = `Karry Kraze: Hi ${name}! How are you liking your ${prodName}${dateLine}? We'd love to hear your thoughts — leave a quick review & get ${discountText} off your next order:\n${link}\n\nReply STOP to opt out`;

  // Send SMS
  const smsResult = await sendSms(phone, smsBody);

  // Insert review_requests row
  const { error: insertErr } = await sb
    .from("review_requests")
    .insert({
      order_session_id,
      product_id,
      phone,
      token_hash: tokenHash,
      short_code: shortCode,
      sent_at: new Date().toISOString(),
      status: smsResult.ok ? "sent" : "failed",
    });

  if (insertErr) {
    console.error("[send-review-request] review_requests insert failed:", insertErr);
  }

  // Log to sms_sends
  if (smsResult.ok) {
    await sb.from("sms_sends").insert({
      phone,
      campaign: "review_request",
      flow: "review_request",
      send_reason: `Review request for ${prodName}`,
      intent: "marketing",
      outcome: "pending",
      cost: 0.0079,
    }).then(({ error }) => {
      if (error) console.warn("[send-review-request] sms_sends log failed:", error);
    });
  }

  return json({
    success: true,
    sent: smsResult.ok,
    twilio_sid: smsResult.sid,
  });
}

async function handleBatch(
  sb: ReturnType<typeof createClient>,
  reviewSecret: string,
  daysAgo?: number
): Promise<Response> {
  // Get review settings for delay
  const { data: settingsRows } = await sb
    .from("review_settings")
    .select("key, value")
    .in("key", ["sms_request", "coupon"]);

  const settings: Record<string, any> = {};
  for (const row of settingsRows || []) {
    settings[row.key] = row.value;
  }

  const normalDelay = settings.sms_request?.delay_days ?? daysAgo ?? 7;
  const mtoDelay = settings.sms_request?.mto_delay_days ?? 14;
  const maxProducts = 3;

  // Find eligible orders:
  // 1. Orders from X days ago
  // 2. Customer has SMS subscription (phone in sms_subscribers)
  // 3. No existing review_request for (order, product)
  // 4. No existing review for (order, product)

  const cutoffNormal = new Date();
  cutoffNormal.setDate(cutoffNormal.getDate() - normalDelay);
  const cutoffMto = new Date();
  cutoffMto.setDate(cutoffMto.getDate() - mtoDelay);

  // Get orders from the appropriate time window
  const { data: orders, error: ordErr } = await sb
    .from("orders_raw")
    .select("stripe_checkout_session_id, email, first_name, phone_number, order_date")
    .lte("order_date", cutoffNormal.toISOString().split("T")[0])
    .order("order_date", { ascending: false })
    .limit(100);

  if (ordErr || !orders?.length) {
    return json({ success: true, sent: 0, message: "No eligible orders found" });
  }

  let totalSent = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  for (const order of orders) {
    // Need a phone number from the order
    const phone = order.phone_number;

    if (!phone) {
      totalSkipped++;
      continue;
    }

    // Get line items for this order
    const { data: items } = await sb
      .from("line_items_raw")
      .select("product_id, product_name")
      .eq("stripe_checkout_session_id", order.stripe_checkout_session_id)
      .limit(maxProducts);

    if (!items?.length) continue;

    for (const item of items) {
      if (!item.product_id) continue;

      try {
        const result = await handleSingle(sb, reviewSecret, {
          order_session_id: order.stripe_checkout_session_id,
          product_id: item.product_id,
          phone,
          email: order.email,
          first_name: order.first_name,
          product_name: item.product_name,
          order_date: order.order_date,
        });

        const data = await result.json();
        if (data.success && data.sent) {
          totalSent++;
        } else {
          totalSkipped++;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${order.stripe_checkout_session_id}/${item.product_id}: ${msg}`);
        totalSkipped++;
      }
    }
  }

  return json({
    success: true,
    sent: totalSent,
    skipped: totalSkipped,
    errors: errors.length ? errors : undefined,
  });
}
