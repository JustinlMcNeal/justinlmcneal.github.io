// DOM IDs used by pages/success.html.

export const SUCCESS_DOM_IDS = Object.freeze({
  confettiContainer: "confettiContainer",
  orderId: "orderId",
  orderIdWrap: "orderIdWrap",
  orderDetailsSection: "orderDetailsSection",
  orderItemsList: "orderItemsList",
  orderSubtotal: "orderSubtotal",
  orderTax: "orderTax",
  orderShipping: "orderShipping",
  orderTotal: "orderTotal",
  orderSavingsRow: "orderSavingsRow",
  orderSavings: "orderSavings",
  shippingAddressBlock: "shippingAddressBlock",
  shippingAddress: "shippingAddress",
  smsOptinCard: "smsOptinCard",
  smsOptinPhone: "smsOptinPhone",
  smsOptinConsent: "smsOptinConsent",
  smsOptinBtn: "smsOptinBtn",
  smsOptinStatus: "smsOptinStatus",
});

export function $(id) {
  return document.getElementById(id);
}

export function show(el) {
  el?.classList.remove("hidden");
}

export function hide(el) {
  el?.classList.add("hidden");
}

export function setText(el, value) {
  if (el) el.textContent = value;
}

export function setHtml(el, value) {
  if (el) el.innerHTML = value;
}

export function getSuccessDom() {
  return Object.fromEntries(
    Object.entries(SUCCESS_DOM_IDS).map(([key, id]) => [key, $(id)])
  );
}
