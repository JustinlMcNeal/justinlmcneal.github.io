import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { getCheckoutSessionId } from "./successSession.js";

export async function loadOrderDetails(oid) {
  if (!oid) return { order: null, items: [] };

  try {
    const order = await fetchOrderById(oid);
    if (!order) return { order: null, items: [] };

    const items = await fetchOrderLineItems(order);
    return { order, items };
  } catch (err) {
    console.error("[success] error loading order details:", err);
    return { order: null, items: [] };
  }
}

async function fetchOrderById(oid) {
  const sb = getSupabaseClient();
  const { data: order, error: orderErr } = await sb
    .from("orders_raw")
    .select("*")
    .eq("kk_order_id", oid)
    .single();

  if (orderErr || !order) {
    console.warn("[success] could not load order:", orderErr);
    return null;
  }

  return order;
}

async function fetchOrderLineItems(order) {
  const sessionId = getCheckoutSessionId(order);
  if (!sessionId) return [];

  const sb = getSupabaseClient();
  const { data: items, error: itemsErr } = await sb
    .from("line_items_raw")
    .select("product_name, variant, variant_title, quantity, unit_price_cents, post_discount_unit_price_cents")
    .eq("stripe_checkout_session_id", sessionId);

  if (itemsErr) {
    console.warn("[success] could not load order line items:", itemsErr);
    return [];
  }

  return Array.isArray(items) ? items : [];
}
