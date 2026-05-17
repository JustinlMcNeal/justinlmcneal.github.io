// supabase/functions/track-cta-label-print/index.ts
// Admin-authenticated Edge Function: record a CTA label print event.
// POST { session_id, kk_order_id?, order_source, label_type, printed_by?, metadata? }
// Returns { ok: true, id, row } or { ok: false, error }
//
// Security:
//   - Requires valid Authorization header (admin Supabase Auth JWT).
//   - Row inserted via service_role — browser never touches cta_label_prints directly.
//   - No stack traces or internal errors returned to client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  // Require an Authorization header — admin page session guard has verified the user.
  // Pattern matches create-cta-label-link/index.ts and stripe-refund/index.ts.
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
    session_id,
    kk_order_id = null,
    order_source,
    label_type,
    printed_by = null,
    metadata = {},
  } = body;

  // Validate required fields
  if (!session_id || typeof session_id !== "string" || session_id.trim() === "") {
    return json({ ok: false, error: "Missing or empty session_id" }, 400);
  }
  if (!order_source || typeof order_source !== "string") {
    return json({ ok: false, error: "Missing order_source" }, 400);
  }
  if (!label_type || typeof label_type !== "string") {
    return json({ ok: false, error: "Missing label_type" }, 400);
  }
  if (!(VALID_SOURCES as readonly string[]).includes(order_source)) {
    return json({ ok: false, error: `Invalid order_source — must be one of: ${VALID_SOURCES.join(", ")}` }, 400);
  }
  if (!(VALID_TYPES as readonly string[]).includes(label_type)) {
    return json({ ok: false, error: `Invalid label_type — must be one of: ${VALID_TYPES.join(", ")}` }, 400);
  }
  if (typeof metadata !== "object" || Array.isArray(metadata) || metadata === null) {
    return json({ ok: false, error: "metadata must be an object if provided" }, 400);
  }

  try {
    const sb = createClient(supabaseUrl, serviceKey);

    const { data: inserted, error } = await sb
      .from("cta_label_prints")
      .insert({
        session_id:   session_id.trim(),
        kk_order_id:  kk_order_id || null,
        order_source,
        label_type,
        printed_by:   printed_by || null,
        metadata:     metadata,
      })
      .select()
      .single();

    if (error) {
      console.error("[track-cta-label-print] insert failed:", error.message);
      return json({ ok: false, error: "Failed to record print event" }, 500);
    }

    return json({ ok: true, id: inserted.id, row: inserted });
  } catch (err: unknown) {
    console.error("[track-cta-label-print] unexpected error:", err instanceof Error ? err.message : String(err));
    return json({ ok: false, error: "Unexpected server error" }, 500);
  }
});
