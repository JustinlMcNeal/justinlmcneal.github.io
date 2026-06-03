const trackedPurchases = new Set();

export function trackPurchase(order) {
  if (!order) return;

  const trackingKey = order.kk_order_id || order.stripe_checkout_session_id || "unknown";
  if (trackedPurchases.has(trackingKey)) return;
  trackedPurchases.add(trackingKey);

  if (typeof fbq === "function") {
    fbq("track", "Purchase", {
      content_type: "product",
      value: (order.total_paid_cents || 0) / 100,
      currency: "USD",
    });
  }
}
