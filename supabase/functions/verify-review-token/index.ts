// supabase/functions/verify-review-token/index.ts
// Verifies a JWT review token (signed with REVIEW_TOKEN_SECRET),
// returns order + product data, checks if already reviewed,
// updates clicked_at on review_requests for funnel tracking.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

/**
 * Minimal HMAC-SHA256 JWT verify for Deno (no external deps).
 * Only supports HS256.
 */
async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;

  // Verify header is HS256
  try {
    const header = JSON.parse(atob(headerB64.replace(/-/g, "+").replace(/_/g, "/")));
    if (header.alg !== "HS256") return null;
  } catch {
    return null;
  }

  // Import key
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // Decode signature (base64url)
  const sigStr = sigB64.replace(/-/g, "+").replace(/_/g, "/");
  const sigBin = Uint8Array.from(atob(sigStr), (c) => c.charCodeAt(0));

  // Verify
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBin,
    enc.encode(`${headerB64}.${payloadB64}`)
  );

  if (!valid) return null;

  // Decode payload
  const payloadStr = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
  const payload = JSON.parse(payloadStr);

  // Check expiry
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const reviewSecret = Deno.env.get("REVIEW_TOKEN_SECRET");

    if (!reviewSecret) {
      console.error("[verify-review-token] REVIEW_TOKEN_SECRET not set");
      return json({ error: "Server configuration error" }, 500);
    }

    const sb = createClient(supabaseUrl, serviceKey);
    const { token } = await req.json();

    if (!token || typeof token !== "string") {
      return json({ error: "Token is required" }, 400);
    }

    // Verify JWT
    const payload = await verifyJwt(token, reviewSecret);
    if (!payload) {
      return json({ success: false, error: "Invalid or expired token" }, 401);
    }

    const orderSessionId = payload.oid as string;
    const productId = payload.pid as string;
    const email = payload.email as string;

    if (!orderSessionId || !email) {
      return json({ success: false, error: "Invalid token payload" }, 400);
    }

    // Update clicked_at on review_requests (track SMS→click conversion)
    // Use token_hash to find the row — hash the token for lookup
    const tokenHashBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token)
    );
    const tokenHash = Array.from(new Uint8Array(tokenHashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await sb
      .from("review_requests")
      .update({ clicked_at: new Date().toISOString(), status: "clicked" })
      .eq("token_hash", tokenHash)
      .is("clicked_at", null);

    // Check if already reviewed
    const { data: existingReview } = await sb
      .from("reviews")
      .select("id, coupon_code")
      .eq("order_session_id", orderSessionId)
      .eq("product_id", productId)
      .single();

    if (existingReview) {
      // Return existing review + coupon info
      let couponInfo = null;
      if (existingReview.coupon_code) {
        const { data: coupon } = await sb
          .from("review_coupons")
          .select("code, discount_type, discount_value, expires_at")
          .eq("code", existingReview.coupon_code)
          .single();
        couponInfo = coupon;
      }

      return json({
        success: true,
        already_reviewed: true,
        coupon_code: couponInfo?.code || existingReview.coupon_code,
        coupon_discount_type: couponInfo?.discount_type || null,
        coupon_discount_value: couponInfo?.discount_value || null,
      });
    }

    // Look up the order
    const { data: order, error: oErr } = await sb
      .from("orders_raw")
      .select("stripe_checkout_session_id, kk_order_id, email, first_name, order_date")
      .eq("stripe_checkout_session_id", orderSessionId)
      .single();

    if (oErr || !order) {
      return json({ success: false, error: "Order not found" }, 404);
    }

    // Verify email matches
    if (order.email?.toLowerCase() !== email.toLowerCase()) {
      return json({ success: false, error: "Email mismatch" }, 403);
    }

    // Get line items
    const { data: items } = await sb
      .from("line_items_raw")
      .select("product_id, product_name, variant, quantity")
      .eq("stripe_checkout_session_id", orderSessionId);

    // Check which items already have reviews
    const { data: existingReviews } = await sb
      .from("reviews")
      .select("product_id, coupon_code")
      .eq("order_session_id", orderSessionId);

    const reviewedProducts = new Set(
      (existingReviews || []).map((r: any) => r.product_id)
    );
    const couponByProduct = new Map(
      (existingReviews || [])
        .filter((r: any) => r.coupon_code)
        .map((r: any) => [r.product_id, r.coupon_code])
    );

    // Enrich with product images
    const productCodes = (items || []).map((it: any) => it.product_id).filter(Boolean);
    let imageMap = new Map<string, string>();
    if (productCodes.length) {
      const { data: products } = await sb
        .from("products")
        .select("code, primary_image_url, catalog_image_url")
        .in("code", productCodes);

      for (const p of products || []) {
        const code = String((p as any).code);
        const img = (p as any).primary_image_url || (p as any).catalog_image_url || "";
        if (code && img) imageMap.set(code, img);
      }
    }

    const enrichedItems = (items || []).map((it: any) => ({
      product_id: it.product_id,
      product_name: it.product_name,
      variant: it.variant,
      quantity: it.quantity,
      image_url: imageMap.get(it.product_id) || null,
      already_reviewed: reviewedProducts.has(it.product_id),
      coupon_code: couponByProduct.get(it.product_id) || null,
    }));

    return json({
      success: true,
      already_reviewed: false,
      email: order.email,
      target_product_id: productId || null,
      order: {
        kk_order_id: order.kk_order_id,
        session_id: order.stripe_checkout_session_id,
        first_name: order.first_name,
        order_date: order.order_date,
      },
      items: enrichedItems,
    });
  } catch (err: unknown) {
    console.error("[verify-review-token] Error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
