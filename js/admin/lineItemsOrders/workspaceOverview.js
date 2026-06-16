// /js/admin/lineItemsOrders/workspaceOverview.js
// Renders the Overview tab HTML for the order workspace.
// Owns: customer info, shipping address, line-item list with product images.
import { sh, fmtDate } from "./workspaceUtils.js";
import { esc, moneyFromCents } from "./dom.js";
import {
  localAddressIssues,
  customerDisplayName,
  shippingNameWarnings,
  toPrintableName,
} from "./shippingAddress.js";

/** @param {{ first_name?: string|null, last_name?: string|null, email?: string|null, phone_number?: string|null, phone?: string|null, order_date?: string|null }} order @param {{ pendingSave?: boolean }} [opts] */
export function renderCustomerInfoSection(order, opts = {}) {
  const customer = customerDisplayName(order) || "—";
  const nameWarnings = shippingNameWarnings(order);
  const printable = toPrintableName(customerDisplayName(order));
  const pendingNote = opts.pendingSave
    ? `<p class="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Unsaved — click Save Address below</p>`
    : "";

  let html = `<div class="grid sm:grid-cols-2 gap-4">
      <div class="border-4 border-black p-4 sm:col-span-2">
        <div class="flex flex-wrap items-start justify-between gap-2 mb-1">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60">Name (on label)</div>
          <div class="flex flex-wrap gap-2">
            <button type="button" data-edit-name-for-label class="text-[10px] font-black uppercase tracking-wide text-kkpink hover:underline">Edit name for label</button>
            ${
              nameWarnings.length && printable
                ? `<button type="button" data-use-printable-name class="text-[10px] font-black uppercase tracking-wide text-blue-700 hover:underline">Use printable name</button>`
                : ""
            }
          </div>
        </div>
        <div class="font-black text-lg break-words" data-customer-name-display>${esc(customer)}</div>
        ${pendingNote}
        ${
          nameWarnings.length
            ? `<div class="mt-3 border-4 border-amber-400 bg-amber-50 p-3 text-xs text-amber-900">
            <span class="font-black uppercase tracking-wider">Label name warning</span>
            <ul class="mt-1 list-disc pl-4 space-y-0.5">${nameWarnings.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
            ${
              printable
                ? `<p class="mt-2">Suggested printable: <strong>${esc(printable)}</strong></p>`
                : ""
            }
          </div>`
            : ""
        }
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Email</div>
        <div class="font-mono text-sm break-all">${esc(order.email || "—")}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Phone</div>
        <div class="font-mono text-sm">${esc(order.phone_number || order.phone || "—")}</div>
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Order Date</div>
        <div class="text-sm">${esc(fmtDate(order.order_date))}</div>
      </div>
    </div>`;
  return html;
}

export function renderOverview(order, lineItems, opts = {}) {
  const focusLineItemId = opts.focusLineItemId || null;
  const addrIssues = localAddressIssues(order);

  let html = '<div class="p-3 sm:p-6 space-y-6">';

  // Section 1: Customer Info
  html += `<section>
    ${sh("Customer Information")}
    <div id="customerInfoMount">${renderCustomerInfoSection(order)}</div>
  </section>
  <div class="border-t-4 border-gray-100"></div>`;

  // Section 2: Shipping Address (editable + Shippo validation)
  html += `<section id="shippingAddressSection">
    ${sh("Shipping Address")}
    <p class="text-xs text-black/55 mb-3">First and last name here print on the shipping label. Save, then validate before buying a label on Fulfillment.</p>
    ${
      addrIssues.length
        ? `<div class="mb-3 border-4 border-amber-400 bg-amber-50 p-3 text-xs text-amber-900">
        <span class="font-black uppercase tracking-wider">Possible issue on file</span>
        <ul class="mt-1 list-disc pl-4 space-y-0.5">${addrIssues.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      </div>`
        : ""
    }
    <div id="addrStatusMount" class="mb-3"></div>
    <div class="grid sm:grid-cols-2 gap-4 border-4 border-black p-4">
      <div>
        <label for="addrFirstName" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">First name</label>
        <input id="addrFirstName" type="text" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="addrLastName" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Last name</label>
        <input id="addrLastName" type="text" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div class="sm:col-span-2">
        <label for="addrStreet" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Street address</label>
        <input id="addrStreet" type="text" placeholder="123 Main St" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="addrCity" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">City</label>
        <input id="addrCity" type="text" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="addrState" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">State</label>
        <input id="addrState" type="text" maxlength="2" placeholder="GA" class="w-full border-[4px] border-black px-3 py-2 text-sm uppercase outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="addrZip" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">ZIP</label>
        <input id="addrZip" type="text" placeholder="30240" class="w-full border-[4px] border-black px-3 py-2 text-sm outline-none focus:border-kkpink transition-colors" />
      </div>
      <div>
        <label for="addrCountry" class="block text-[11px] font-black uppercase tracking-[.12em] mb-1 text-black/70">Country</label>
        <input id="addrCountry" type="text" maxlength="2" placeholder="US" class="w-full border-[4px] border-black px-3 py-2 text-sm uppercase outline-none focus:border-kkpink transition-colors" />
      </div>
    </div>
    <div class="mt-3 flex flex-wrap gap-2">
      <button type="button" data-save-address class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-black bg-black text-white hover:bg-kkpink hover:border-kkpink transition">
        Save Address
      </button>
      <button type="button" data-validate-address class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-blue-600 text-blue-700 hover:bg-blue-600 hover:text-white transition">
        Validate Address
      </button>
    </div>
    <p id="addrActionMsg" class="hidden mt-2 text-xs font-bold"></p>
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
            const isFocused =
              focusLineItemId &&
              String(li.stripe_line_item_id || "") === String(focusLineItemId);
            const focusCls = isFocused ? " ring-4 ring-kkpink ring-offset-2" : "";
            return `<div class="border-4 border-black p-3 sm:p-4 flex gap-3 sm:gap-4${focusCls}" data-ws-line-item="${esc(String(li.stripe_line_item_id || ""))}">
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
                  <span>Landed CPI: ${moneyFromCents(li.cpi_cents)}/ea</span>
                  <span>×${qty} = <strong>${moneyFromCents(li.line_cost_cents)}</strong></span>
                  <span class="text-[10px] font-black uppercase tracking-wide text-black/50">${esc(li.cost_source_label || "CPI")}</span>
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
