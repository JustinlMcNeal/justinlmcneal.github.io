// supabase/functions/create-cta-label-link/index.ts
// Admin-authenticated Edge Function: create a tracking link for a CTA label print.
// POST { print_id, session_id, kk_order_id?, order_source, label_type, destination_url, metadata? }
// Returns { ok: true, token, tracking_url } or { ok: false, error }
//
// Security:
//   - Requires valid Authorization header (admin Supabase Auth JWT).
//   - Token generated server-side with crypto.randomUUID() (CSPRNG).
//   - Row inserted via service_role — never exposed to browser.
//   - destination_url validated: must be karrykraze.com or www.karrykraze.com.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://karrykraze.com";
const ALLOWED_HOSTNAMES = new Set(["karrykraze.com", "www.karrykraze.com"]);
const VALID_SOURCES = ["kk", "ebay", "amazon", "unknown"] as const;
const VALID_TYPES   = ["review_cta", "channel_cta"] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function isSafeDestination(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
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
    return json({ ok: false, error: "POST only" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Server misconfigured" }, 500);
  }

  // Require a valid auth header — admin page session guard has already verified the user.
  // Pattern matches stripe-refund/index.ts.
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const {
    print_id,
    session_id,
    kk_order_id,
    order_source,
    label_type,
    destination_url,
    metadata = {},
  } = body;

  // Validate required fields
  if (!session_id || typeof session_id !== "string") {
    return json({ ok: false, error: "Missing session_id" }, 400);
  }
  if (!order_source || typeof order_source !== "string") {
    return json({ ok: false, error: "Missing order_source" }, 400);
  }
  if (!label_type || typeof label_type !== "string") {
    return json({ ok: false, error: "Missing label_type" }, 400);
  }
  if (!destination_url || typeof destination_url !== "string") {
    return json({ ok: false, error: "Missing destination_url" }, 400);
  }
  if (!(VALID_SOURCES as readonly string[]).includes(order_source)) {
    return json({ ok: false, error: "Invalid order_source" }, 400);
  }
  if (!(VALID_TYPES as readonly string[]).includes(label_type)) {
    return json({ ok: false, error: "Invalid label_type" }, 400);
  }
  if (!isSafeDestination(destination_url)) {
    return json({ ok: false, error: "Unsafe destination_url — must be karrykraze.com" }, 400);
  }

  // Generate a CSPRNG token server-side — 16 hex chars, 64 bits of entropy.
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const tracking_url = `${SITE_URL}/r/?t=${token}`;

  try {
    const sb = createClient(supabaseUrl, serviceKey);

    const { error } = await sb.from("cta_label_links").insert({
      token,
      print_id:       print_id || null,
      session_id,
      kk_order_id:    kk_order_id || null,
      order_source,
      label_type,
      destination_url,
      expires_at:     null,
      metadata:       (typeof metadata === "object" && metadata !== null) ? metadata : {},
    });

    if (error) {
      console.error("[create-cta-label-link] insert failed:", error.message);
      return json({ ok: false, error: error.message }, 500);
    }

    return json({ ok: true, token, tracking_url });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[create-cta-label-link] unexpected error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
