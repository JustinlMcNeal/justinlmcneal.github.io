// /js/admin/lineItemsOrders/workspaceOverview.js
// Renders the Overview tab HTML for the order workspace.
// Owns: customer info, shipping address, line-item list with product images.
import { sh, fmtDate } from "./workspaceUtils.js";
import { esc, moneyFromCents } from "./dom.js";

export function renderOverview(order, lineItems) {
  const customer = `${order.first_name || ""} ${order.last_name || ""}`.trim() || "—";
  const addr =
    [order.street_address, order.city, order.state, order.zip, order.country]
      .filter(Boolean)
      .join(", ") || "—";

  let html = '<div class="p-3 sm:p-6 space-y-6">';

  // Section 1: Customer Info
  html += `<section>
    ${sh("Customer Information")}
    <div class="grid sm:grid-cols-2 gap-4">
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Name</div>
        <div class="font-black text-lg">${esc(customer)}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Email</div>
        <div class="font-mono text-sm break-all">${esc(order.email || "—")}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Phone</div>
        <div class="font-mono text-sm">${esc(order.phone || "—")}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Order Date</div>
        <div class="text-sm">${esc(fmtDate(order.order_date))}</div>
      </div>
    </div>
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  // Section 2: Shipping Address
  html += `<section>
    ${sh("Shipping Address")}
    <div class="border-4 border-black p-4">
      <div class="text-sm leading-relaxed">${esc(addr)}</div>
    </div>
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  // Section 3: Items Ordered
  const itemsHtml =
    lineItems.length === 0
      ? '<div class="text-gray-500 text-sm">No line items found</div>'
      : lineItems
          .map((li) => {
            const qty = Number(li.quantity ?? 1);
            const unitCents = li.post_discount_unit_price_cents ?? li.unit_price_cents;
            const lineTotalCents = unitCents != null ? unitCents * qty : null;
            const imgHtml = li.product_image_url
              ? `<img src="${esc(li.product_image_url)}" class="w-12 h-12 sm:w-16 sm:h-16 object-cover border-2 border-black flex-shrink-0" onerror="this.outerHTML='<div class=\\'w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 border-2 border-black flex items-center justify-center text-[10px] text-gray-400 flex-shrink-0\\'>📦</div>'" />`
              : `<div class="w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 border-2 border-black flex items-center justify-center text-[10px] text-gray-400 flex-shrink-0">📦</div>`;
            return `<div class="border-4 border-black p-3 sm:p-4 flex gap-3 sm:gap-4">
              ${imgHtml}
              <div class="flex-1 min-w-0">
                ${
                  li.product_slug
                    ? `<a href="/pages/product.html?slug=${encodeURIComponent(li.product_slug)}" target="_blank" class="font-black text-sm line-clamp-2 text-kkpink hover:underline cursor-pointer">${esc(li.product_name || li.product_id || "Unknown Product")}</a>`
                    : `<span class="font-black text-sm line-clamp-2">${esc(li.product_name || li.product_id || "Unknown Product")}</span>`
                }
                ${li.variant ? `<div class="text-xs text-gray-500 mt-1">Variant: ${esc(li.variant)}</div>` : ""}
                <div class="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 mt-2 text-xs sm:text-sm">
                  <span>Qty: <strong>${qty}</strong></span>
                  <span>Price: <strong>${moneyFromCents(unitCents)}</strong></span>
                  <span>Revenue: <strong>${moneyFromCents(lineTotalCents)}</strong></span>
                </div>
                ${
                  li.cpi_cents
                    ? `<div class="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 mt-1 text-[11px] sm:text-xs text-red-600">
                  <span>CPI: ${moneyFromCents(li.cpi_cents)}/ea</span>
                  <span>×${qty} = <strong>${moneyFromCents(li.line_cost_cents)}</strong></span>
                </div>`
                    : ""
                }
              </div>
            </div>`;
          })
          .join("");

  html += `<section>
    ${sh(`Items Ordered (${lineItems.length})`)}
    <div class="space-y-3">${itemsHtml}</div>
  </section>`;

  html += "</div>";
  return html;
}
