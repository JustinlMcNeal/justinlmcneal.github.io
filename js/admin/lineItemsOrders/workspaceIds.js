// /js/admin/lineItemsOrders/workspaceIds.js
// Renders the IDs tab HTML for the order workspace.
// Owns: technical identifier display with copy buttons.
import { sh } from "./workspaceUtils.js";
import { esc } from "./dom.js";

export function renderIds(order) {
  const ids = [
    { label: "KK Order ID", value: order.kk_order_id },
    { label: "Stripe Session", value: order.stripe_checkout_session_id },
    { label: "Payment Intent", value: order.stripe_payment_intent_id },
    { label: "Stripe Customer", value: order.stripe_customer_id },
  ].filter((item) => item.value);

  let html = '<div class="p-3 sm:p-6">';
  html += sh("Technical IDs");
  html += '<div class="space-y-3">';

  if (ids.length === 0) {
    html += '<div class="text-gray-500 text-sm">No IDs available.</div>';
  } else {
    html += ids
      .map(
        (item) =>
          `<div class="border-4 border-black p-4 flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">${esc(item.label)}</div>
        <div class="font-mono text-sm break-all">${esc(item.value)}</div>
      </div>
      <button type="button" data-copy="${esc(item.value)}"
        class="flex-shrink-0 border-4 border-black bg-white px-3 py-1 text-[10px] font-black uppercase tracking-wider hover:bg-black hover:text-white transition-colors">
        Copy
      </button>
    </div>`
      )
      .join("");
  }

  html += "</div></div>";
  return html;
}
