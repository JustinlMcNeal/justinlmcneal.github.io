// supabase/functions/cta-label-redirect/index.ts
// QR scan tracking redirect: /r/?t={token} → log scan event → 302 to destination_url
// Public endpoint — no customer login required.
// Service role used for all DB writes; raw IP never stored (SHA-256 hash only).
//
// Pattern follows sms-redirect/index.ts closely.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL    = "https://karrykraze.com";

const REDIRECT_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Robots-Tag":  "noindex",
} as const;

function fallbackRedirect() {
  return new Response(null, {
    status: 302,
    headers: { Location: SITE_URL, ...REDIRECT_HEADERS },
  });
}

async function hashIp(ip: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const url   = new URL(req.url);
    const token = url.searchParams.get("t") || "";

    if (!token) return fallbackRedirect();

    const sb = createClient(supabaseUrl, serviceKey);

    // Look up the tracking link by token
    const { data: link, error: linkErr } = await sb
      .from("cta_label_links")
      .select("id, print_id, session_id, order_source, label_type, destination_url, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkErr || !link) {
      console.warn("[cta-label-redirect] token lookup failed:", linkErr?.message ?? "not found");
      return fallbackRedirect();
    }

    // Check expiry (expires_at NULL = never expires)
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      console.warn("[cta-label-redirect] token expired:", token);
      return fallbackRedirect();
    }

    const destination = link.destination_url || SITE_URL;

    // Extract raw IP — use first value from x-forwarded-for (leftmost = client)
    const rawIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
               || req.headers.get("cf-connecting-ip")
               || req.headers.get("x-real-ip")
               || null;

    // Fire-and-forget scan insert — never block the redirect
    const ipHashPromise = rawIp ? hashIp(rawIp) : Promise.resolve(null);

    ipHashPromise.then(async (ip_hash) => {
      const { error: scanErr } = await sb.from("cta_label_scans").insert({
        token,
        link_id:      link.id,
        print_id:     link.print_id || null,
        session_id:   link.session_id || null,
        order_source: link.order_source || null,
        label_type:   link.label_type || null,
        user_agent:   req.headers.get("user-agent") || null,
        ip_hash,
        referrer:     req.headers.get("referer") || null,
        metadata:     {},
      });
      if (scanErr) {
        console.warn("[cta-label-redirect] scan insert failed:", scanErr.message);
      }
    }).catch((err: unknown) => {
      console.warn("[cta-label-redirect] scan insert error:", err instanceof Error ? err.message : String(err));
    });

    return new Response(null, {
      status: 302,
      headers: { Location: destination, ...REDIRECT_HEADERS },
    });

  } catch (err: unknown) {
    console.error("[cta-label-redirect] unexpected error:", err instanceof Error ? err.message : String(err));
    return fallbackRedirect();
  }
});
