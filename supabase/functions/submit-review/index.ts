// supabase/functions/submit-review/index.ts
// Accepts a review submission, saves it, and generates a reward coupon
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

function generateCouponCode(prefix: string): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const {
      order_session_id,
      product_id,
      product_name,
      reviewer_email,
      reviewer_name,
      rating,
      title,
      review_body,
      photo_url,
    } = body;

    // Validate required fields
    if (!order_session_id) return json({ error: "Missing order_session_id" }, 400);
    if (!product_id) return json({ error: "Missing product_id" }, 400);
    if (!reviewer_email) return json({ error: "Missing reviewer_email" }, 400);
    if (!rating || rating < 1 || rating > 5)
      return json({ error: "Rating must be 1-5" }, 400);

    // Verify the order exists and email matches
    const { data: order, error: oErr } = await sb
      .from("orders_raw")
      .select("stripe_checkout_session_id, email")
      .eq("stripe_checkout_session_id", order_session_id)
      .single();

    if (oErr || !order) {
      return json({ error: "Order not found" }, 404);
    }

    if (order.email?.toLowerCase() !== reviewer_email.trim().toLowerCase()) {
      return json({ error: "Email does not match this order" }, 403);
    }

    // Check for existing review (unique constraint will also catch this)
    const { data: existing } = await sb
      .from("reviews")
      .select("id")
      .eq("order_session_id", order_session_id)
      .eq("product_id", product_id)
      .single();

    if (existing) {
      return json({ error: "You've already submitted a review for this item on this order" }, 409);
    }

    // Get review settings (auto-approve, coupon config)
    const { data: moderationRow } = await sb
      .from("review_settings")
      .select("value")
      .eq("key", "moderation")
      .single();
    const modSettings = moderationRow?.value || { auto_approve: false };

    const { data: couponRow } = await sb
      .from("review_settings")
      .select("value")
      .eq("key", "coupon")
      .single();
    const couponSettings = couponRow?.value || {
      enabled: true,
      type: "percentage",
      value: 5,
      prefix: "THANKS",
      expiry_days: 30,
      single_use: true,
      min_order_amount: 0,
    };

    const reviewStatus = modSettings.auto_approve ? "approved" : "pending";

    // Generate coupon code up front (will be delivered when review is approved)
    let couponCode: string | null = null;
    if (couponSettings.enabled) {
      couponCode = generateCouponCode(couponSettings.prefix || "THANKS");
    }

    // Insert the review
    const { data: review, error: rErr } = await sb
      .from("reviews")
      .insert({
        order_session_id,
        product_id,
        product_name: product_name || null,
        reviewer_email: reviewer_email.trim().toLowerCase(),
        reviewer_name: reviewer_name?.trim() || null,
        rating: Number(rating),
        title: title?.trim() || null,
        body: review_body?.trim() || null,
        photo_url: photo_url || null,
        status: reviewStatus,
        coupon_code: couponCode,
      })
      .select("id, status, coupon_code")
      .single();

    if (rErr) {
      console.error("[submit-review] Insert failed:", rErr);
      if (rErr.code === "23505") {
        return json({ error: "You've already reviewed this item on this order" }, 409);
      }
      return json({ error: "Failed to save review" }, 500);
    }

    // Create coupon record if enabled
    let couponDetails = null;
    if (couponCode && review) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + (couponSettings.expiry_days || 30));

      const { data: coupon, error: cErr } = await sb
        .from("review_coupons")
        .insert({
          review_id: review.id,
          code: couponCode,
          discount_type: couponSettings.type || "percentage",
          discount_value: couponSettings.value || 5,
          min_order: couponSettings.min_order_amount || 0,
          single_use: couponSettings.single_use ?? true,
          expires_at: expiresAt.toISOString(),
          reviewer_email: reviewer_email.trim().toLowerCase(),
        })
        .select("code, discount_type, discount_value, expires_at")
        .single();

      if (cErr) {
        console.error("[submit-review] Coupon insert failed:", cErr);
        // Non-fatal — review is still saved
      } else {
        couponDetails = coupon;
      }
    }

    // Determine response based on status
    const isApproved = reviewStatus === "approved";

    return json({
      success: true,
      review_id: review?.id,
      status: reviewStatus,
      message: isApproved
        ? "Thank you for your review! Here's your reward coupon."
        : "Thank you! Your review is pending approval. You'll receive your coupon once approved.",
      coupon: isApproved ? couponDetails : null,
      coupon_pending: !isApproved && couponSettings.enabled,
    });
  } catch (err) {
    console.error("[submit-review] Error:", err);
    return json({ error: (err as Error).message || "Server error" }, 500);
  }
});
