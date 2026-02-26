// supabase/functions/verify-order/index.ts
// Verifies an order by email + KK order ID, returns the line items for review
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const { email, order_id } = await req.json();

    if (!email || !order_id) {
      return json({ error: "Email and order number are required" }, 400);
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanOrderId = String(order_id).trim().toUpperCase();

    // Look up the order by kk_order_id + email
    const { data: order, error: oErr } = await sb
      .from("orders_raw")
      .select("stripe_checkout_session_id, kk_order_id, email, first_name, order_date")
      .eq("kk_order_id", cleanOrderId)
      .eq("email", cleanEmail)
      .single();

    if (oErr || !order) {
      console.log("[verify-order] Not found:", cleanOrderId, cleanEmail);
      return json({ error: "Order not found. Please check your email and order number." }, 404);
    }

    // Get line items for this order
    const { data: items, error: liErr } = await sb
      .from("line_items_raw")
      .select("product_id, product_name, variant, quantity")
      .eq("stripe_checkout_session_id", order.stripe_checkout_session_id);

    if (liErr) {
      console.error("[verify-order] line items fetch failed:", liErr);
      return json({ error: "Could not fetch order items" }, 500);
    }

    // Check which items already have reviews
    const { data: existingReviews } = await sb
      .from("reviews")
      .select("product_id")
      .eq("order_session_id", order.stripe_checkout_session_id);

    const reviewedProducts = new Set(
      (existingReviews || []).map((r: any) => r.product_id)
    );

    // Enrich items with product images
    const productCodes = (items || [])
      .map((it: any) => it.product_id)
      .filter(Boolean);

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
    }));

    return json({
      success: true,
      order: {
        kk_order_id: order.kk_order_id,
        session_id: order.stripe_checkout_session_id,
        email: order.email,
        first_name: order.first_name,
        order_date: order.order_date,
      },
      items: enrichedItems,
    });
  } catch (err) {
    console.error("[verify-order] Error:", err);
    return json({ error: (err as Error).message || "Server error" }, 500);
  }
});
