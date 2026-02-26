// supabase/functions/lookup-orders/index.ts
// Looks up orders by email + name verification (no order number needed)
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

    const { email, first_name } = await req.json();

    if (!email || !first_name) {
      return json({ error: "Email and first name are required" }, 400);
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = String(first_name).trim().toLowerCase();

    // Find orders matching email
    const { data: orders, error: oErr } = await sb
      .from("orders_raw")
      .select(
        "stripe_checkout_session_id, kk_order_id, first_name, last_name, email, order_date, total_paid_cents, total_items"
      )
      .eq("email", cleanEmail)
      .order("order_date", { ascending: false });

    if (oErr) {
      console.error("[lookup-orders] query error:", oErr);
      return json({ error: "Could not look up orders" }, 500);
    }

    if (!orders || orders.length === 0) {
      return json({ error: "No orders found for this email address." }, 404);
    }

    // Verify first name matches at least one order (lightweight identity check)
    const nameMatch = orders.some(
      (o: any) =>
        String(o.first_name || "")
          .trim()
          .toLowerCase() === cleanName
    );

    if (!nameMatch) {
      return json(
        {
          error:
            "The name doesn't match our records. Please use the first name from your order.",
        },
        403
      );
    }

    // Get the session IDs for fetching line items
    const sessionIds = orders.map((o: any) => o.stripe_checkout_session_id);

    // Fetch all line items for these orders in one query
    const { data: allItems } = await sb
      .from("line_items_raw")
      .select("stripe_checkout_session_id, product_id, product_name, variant, quantity")
      .in("stripe_checkout_session_id", sessionIds);

    // Group items by session ID
    const itemsBySession = new Map<string, any[]>();
    for (const item of allItems || []) {
      const sid = item.stripe_checkout_session_id;
      if (!itemsBySession.has(sid)) itemsBySession.set(sid, []);
      itemsBySession.get(sid)!.push({
        product_id: item.product_id,
        product_name: item.product_name,
        variant: item.variant,
        quantity: item.quantity,
      });
    }

    // Fetch product images for all products
    const allProductIds = [
      ...new Set((allItems || []).map((i: any) => i.product_id).filter(Boolean)),
    ];
    let imageMap = new Map<string, string>();
    if (allProductIds.length) {
      const { data: products } = await sb
        .from("products")
        .select("code, primary_image_url, catalog_image_url")
        .in("code", allProductIds);

      for (const p of products || []) {
        const code = String((p as any).code);
        const img =
          (p as any).primary_image_url || (p as any).catalog_image_url || "";
        if (code && img) imageMap.set(code, img);
      }
    }

    // Check which products have been reviewed across all orders
    const { data: existingReviews } = await sb
      .from("reviews")
      .select("order_session_id, product_id, coupon_code")
      .in("order_session_id", sessionIds);

    const reviewMap = new Map<string, string | null>(); // key: session_product → coupon_code
    for (const r of existingReviews || []) {
      reviewMap.set(`${r.order_session_id}_${r.product_id}`, r.coupon_code);
    }

    // Build enriched order list
    const enrichedOrders = orders.map((o: any) => {
      const items = (itemsBySession.get(o.stripe_checkout_session_id) || []).map(
        (item: any) => {
          const key = `${o.stripe_checkout_session_id}_${item.product_id}`;
          const isReviewed = reviewMap.has(key);
          return {
            ...item,
            image_url: imageMap.get(item.product_id) || null,
            already_reviewed: isReviewed,
            coupon_code: isReviewed ? reviewMap.get(key) : null,
          };
        }
      );

      return {
        kk_order_id: o.kk_order_id,
        session_id: o.stripe_checkout_session_id,
        order_date: o.order_date,
        total_paid_cents: o.total_paid_cents,
        total_items: o.total_items,
        first_name: o.first_name,
        items,
      };
    });

    return json({
      success: true,
      customer_name: orders[0]?.first_name || cleanName,
      orders: enrichedOrders,
    });
  } catch (err) {
    console.error("[lookup-orders] Error:", err);
    return json({ error: (err as Error).message || "Server error" }, 500);
  }
});
