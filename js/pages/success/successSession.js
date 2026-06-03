// Session helpers keep checkout/session assumptions in one place.

export function getOrderIdFromPageParams(params) {
  const orderId = params?.orderId || null;
  if (!orderId) {
    console.warn("[success] missing order id param");
  }
  return orderId;
}

export function getCheckoutSessionId(order) {
  const sessionId = order?.stripe_checkout_session_id || null;
  if (!sessionId && order) {
    console.warn("[success] order is missing stripe checkout session id");
  }
  return sessionId;
}
