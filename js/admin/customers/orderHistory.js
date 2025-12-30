// /js/admin/customers/orderHistory.js
// (Reserved for future enhancements: clicking an order row, linking to Orders page, etc.)
export function buildOrderLink(kkOrderId) {
  if (!kkOrderId) return null;
  // Example: if your Orders page supports ?q= query
  return `/pages/admin/lineItemsOrders.html?q=${encodeURIComponent(kkOrderId)}`;
}
