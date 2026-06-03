import { $, getSuccessDom, setHtml, setText, show } from "./successDom.js";
import { cents, escHtml } from "./successUtils.js";

export function spawnConfetti() {
  const container = $("confettiContainer");
  if (!container) return;

  const colors = ["#f58f86", "#f6dcc6", "#FFD700", "#FF69B4", "#87CEEB", "#98FB98"];
  const count = 40;

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 1.5}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    piece.style.width = `${6 + Math.random() * 8}px`;
    piece.style.height = `${6 + Math.random() * 8}px`;
    container.appendChild(piece);
  }

  setTimeout(() => {
    container.innerHTML = "";
  }, 5000);
}

export function showOrderId(oid) {
  if (!oid) return;
  const { orderId, orderIdWrap } = getSuccessDom();
  setText(orderId, oid);
  show(orderIdWrap);
}

export function renderOrderDetails(order, items = []) {
  if (!order) return;

  renderOrderItems(items);
  renderOrderTotals(order);
  renderShippingAddress(order);
  show($("orderDetailsSection"));
}

function renderOrderItems(items) {
  const itemsList = $("orderItemsList");
  if (!items?.length || !itemsList) return;

  setHtml(itemsList, items.map((item) => `
        <div class="flex justify-between items-start gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-bold truncate">${escHtml(item.product_name)}</div>
            ${(item.variant_title || item.variant) ? `<div class="text-[10px] text-gray-500">${escHtml(item.variant_title || item.variant)}</div>` : ""}
            <div class="text-[10px] text-gray-400">Qty: ${item.quantity}</div>
          </div>
          <div class="text-sm font-bold whitespace-nowrap">
            ${cents((item.post_discount_unit_price_cents || item.unit_price_cents) * item.quantity)}
          </div>
        </div>
      `).join(""));
}

function renderOrderTotals(order) {
  const {
    orderSubtotal,
    orderTax,
    orderShipping,
    orderTotal,
    orderSavingsRow,
    orderSavings,
  } = getSuccessDom();

  setText(orderSubtotal, cents(order.subtotal_paid_cents || order.subtotal_original_cents));
  setText(orderTax, cents(order.tax_cents));
  setText(orderShipping, order.shipping_paid_cents ? cents(order.shipping_paid_cents) : "Free");
  setText(orderTotal, cents(order.total_paid_cents));

  if (order.order_savings_total_cents > 0 && orderSavingsRow && orderSavings) {
    setText(orderSavings, "-" + cents(order.order_savings_total_cents));
    show(orderSavingsRow);
  }
}

function renderShippingAddress(order) {
  if (!order.street_address && !order.city) return;

  const { shippingAddressBlock, shippingAddress } = getSuccessDom();
  if (!shippingAddressBlock || !shippingAddress) return;

  const parts = [
    [order.first_name, order.last_name].filter(Boolean).join(" "),
    order.street_address,
    [order.city, order.state, order.zip].filter(Boolean).join(", "),
    order.country && order.country !== "US" ? order.country : null,
  ].filter(Boolean);

  setHtml(shippingAddress, parts.map((p) => escHtml(p)).join("<br>"));
  show(shippingAddressBlock);
}
