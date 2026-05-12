// /js/admin/lineItemsOrders/index.js
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { els, wireDomHelpers, setStatus, setCountLabel, moneyFromCents } from "./dom.js";
import { state } from "./state.js";
import { fetchOrderSummaryPage, fetchOrderSummaryAllForExport, fetchOrderKpis, fetchOrderDetails, issueRefund, updateRefundReason, buyShippingLabel, voidShippingLabel, fetchPackagePresets, getSignedLabelUrl } from "./api.js";
import { renderOrdersRows } from "./renderTable.js";
import { downloadShipReadyCSV } from "./shipReadyCsv.js";
import { bindEditModal } from "./modalEditor.js";
import { wireAmazonImport } from "./amazonImport.js";


wireDomHelpers();

document.addEventListener("DOMContentLoaded", async () => {
  // Admin nav + footer first
  await initAdminNav("Orders");
  initFooter();

  // Set sticky toolbar top to match admin nav height
  requestAnimationFrame(() => {
    const navMount = document.getElementById('kkAdminNavMount');
    const toolbar = document.getElementById('toolbar');
    if (navMount && toolbar) toolbar.style.top = `${navMount.offsetHeight}px`;
  });

  // Defaults — check URL for ?q= search param (used by admin reviews order links)
  const urlQ = new URLSearchParams(window.location.search).get("q") || "";
  els.searchInput.value = urlQ;
  els.statusFilter.value = "";
  els.dateFrom.value = "";
  els.dateTo.value = "";

  // Bind modal
  state.modal = bindEditModal({
    modalEl: els.modal,
    onSaved: async () => {
      await reload({ hard: true });
    },
  });

  // Bind view modal
  bindViewModal();

  wireEvents();
  reload({ hard: true });
});

/* -------------------------
   VIEW MODAL
-------------------------- */
function bindViewModal() {
  const viewModal = document.getElementById("viewModal");
  const viewModalTitle = document.getElementById("viewModalTitle");
  const viewModalBody = document.getElementById("viewModalBody");
  const btnViewClose = document.getElementById("btnViewClose");

  if (!viewModal) return;

  btnViewClose?.addEventListener("click", () => {
    viewModal.classList.add("hidden");
  });

  state.openViewModal = async (row) => {
    if (!row?.stripe_checkout_session_id) return;

    viewModal.classList.remove("hidden");
    viewModalTitle.textContent = row.kk_order_id || "Order Details";
    viewModalBody.innerHTML = '<div class="text-center py-8 text-gray-500">Loading...</div>';

    try {
      const { order, lineItems, shipment } = await fetchOrderDetails(row.stripe_checkout_session_id);
      viewModalBody.innerHTML = renderOrderDetailsHtml(order, lineItems, shipment);

      // Wire refund button(s) inside the modal
      wireRefundButtons(viewModalBody, order, row);

      // Wire label action buttons (buy, print, void)
      wireLabelButtons(viewModalBody, order, shipment, row);
    } catch (err) {
      console.error(err);
      viewModalBody.innerHTML = `<div class="text-red-600 p-4">${err.message || "Failed to load order"}</div>`;
    }
  };
}

/* -------------------------
   REFUND SECTION BUILDER
   (extracted to avoid nested template literal issues)
-------------------------- */
function buildRefundSectionHtml(order, esc, money, formatDate) {
  let html = '<section>';
  html += '<div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">';
  html += '<span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">7</span>';
  html += 'Refund</div>';

  if (order.refund_status) {
    // Status cards
    const statusBorder = order.refund_status === "full" ? "border-red-400 bg-red-50" : "border-amber-400 bg-amber-50";
    const statusColor = order.refund_status === "full" ? "text-red-600" : "text-amber-600";
    const netRevenue = (order.total_paid_cents || 0) - (order.refund_amount_cents || 0);

    html += '<div class="grid sm:grid-cols-3 gap-4 mb-4">';
    html += `<div class="border-4 ${statusBorder} p-4">`;
    html += '<div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Status</div>';
    html += `<div class="font-black uppercase ${statusColor}">${esc(order.refund_status)} refund</div></div>`;
    html += '<div class="border-4 border-black p-4">';
    html += '<div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Refunded</div>';
    html += `<div class="font-black text-lg text-red-600">${money(order.refund_amount_cents)}</div></div>`;
    html += '<div class="border-4 border-black p-4 bg-emerald-50">';
    html += '<div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Net Revenue</div>';
    html += `<div class="font-black text-lg text-emerald-600">${money(netRevenue)}</div></div>`;
    html += '</div>';

    // Refund reason toggles
    html += '<div class="mb-4">';
    html += '<div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-2">Refund Reason</div>';
    html += '<div class="flex flex-wrap gap-2">';

    const reasons = [
      { key: "cancelled_before_ship", label: "🚫 Cancelled / Never Shipped", activeClass: "border-blue-600 bg-blue-600 text-white" },
      { key: "refunded_kept_item",    label: "🎁 Refunded · Kept Item",      activeClass: "border-amber-500 bg-amber-500 text-white" },
      { key: "returned",              label: "📦 Returned",                   activeClass: "border-purple-600 bg-purple-600 text-white" },
    ];
    for (const r of reasons) {
      const cls = order.refund_reason === r.key ? r.activeClass : "border-gray-300 text-gray-600 hover:border-black";
      html += `<button data-set-reason="${r.key}" class="px-3 py-2 text-[11px] font-black uppercase tracking-wider border-4 transition ${cls}">${r.label}</button>`;
    }
    html += '</div>';

    // Reason explanation
    const explanations = {
      cancelled_before_ship: "Product never shipped → profit = $0 (no costs incurred)",
      refunded_kept_item: "Customer kept the item → product cost + shipping are real losses",
      returned: "Customer returned item → product cost is sunk, no shipping loss",
    };
    const explanation = explanations[order.refund_reason] || "Select a reason to adjust how profit is calculated";
    html += `<div class="mt-2 text-[10px] text-gray-500">${explanation}</div>`;
    html += '</div>';

    if (order.refunded_at) {
      html += `<div class="text-xs text-gray-500 mb-4">Refunded on ${formatDate(order.refunded_at)}</div>`;
    }
  } else {
    html += '<div class="text-sm text-gray-400 mb-4">No refund issued.</div>';
  }

  // Action buttons
  if (order.source === "amazon") {
    html += '<div class="text-xs text-gray-400 italic">Refunds for Amazon orders must be handled through Amazon Seller Central.</div>';
  } else {
    html += '<div class="mt-3">';

    // Reason dropdown (only for new refunds)
    if (!order.refund_status) {
      html += '<div class="mb-4">';
      html += '<div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-2">Refund Reason (required)</div>';
      html += '<select data-refund-reason-select class="border-4 border-black px-3 py-2 text-sm w-full sm:w-auto focus:border-kkpink outline-none">';
      html += '<option value="">— Select reason —</option>';
      html += '<option value="cancelled_before_ship">🚫 Cancelled / Never Shipped</option>';
      html += '<option value="refunded_kept_item">🎁 Refunded · Customer Keeps Item</option>';
      html += '<option value="returned">📦 Returned by Customer</option>';
      html += '</select></div>';
    }

    html += '<div class="flex flex-wrap gap-3">';

    // Full refund button
    const fullDisabled = order.refund_status === "full" ? "disabled" : "";
    const fullLabel = order.refund_status === "full" ? "Fully Refunded" : "Issue Full Refund";
    html += `<button data-refund-full class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-red-600 text-red-600 hover:bg-red-600 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed" ${fullDisabled}>${fullLabel}</button>`;

    // Partial refund controls
    if (order.refund_status !== "full") {
      html += '<div class="flex items-center gap-2">';
      html += '<span class="text-[10px] font-black uppercase text-black/60">$</span>';
      html += '<input data-refund-amount type="number" step="0.01" min="0.01" placeholder="Amount" class="w-24 border-4 border-black px-2 py-1 text-sm font-mono focus:outline-none focus:border-blue-600" />';
      html += '<button data-refund-partial class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-amber-500 text-amber-600 hover:bg-amber-500 hover:text-white transition">Partial Refund</button>';
      html += '</div>';
    }

    html += '</div></div>';
  }

  html += '</section>';
  return html;
}

function renderOrderDetailsHtml(order, lineItems, shipment) {
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const money = (cents) => {
    if (cents == null) return "—";
    return "$" + (Number(cents) / 100).toFixed(2);
  };
  const formatDate = (d) => {
    if (!d) return "—";
    return new Date(d).toLocaleString();
  };

  const customer = `${order.first_name || ""} ${order.last_name || ""}`.trim() || "—";
  const email = order.email || "—";
  const phone = order.phone || "—";

  // Address - using actual field names from orders_raw
  const addr = [
    order.street_address,
    order.city,
    order.state,
    order.zip,
    order.country,
  ].filter(Boolean).join(", ") || "—";

  // Status
  const labelStatus = shipment?.label_status || "pending";
  const tracking = shipment?.tracking_number || "—";
  const carrier = shipment?.carrier || "—";

  // ── Build refund section HTML before the main template ──
  const refundSectionHtml = buildRefundSectionHtml(order, esc, money, formatDate);

  return `
    <!-- Customer Info -->
    <section>
      <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">
        <span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">1</span>
        Customer Information
      </div>
      <div class="grid sm:grid-cols-2 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Name</div>
          <div class="font-black text-lg">${esc(customer)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Email</div>
          <div class="font-mono text-sm break-all">${esc(email)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Phone</div>
          <div class="font-mono text-sm">${esc(phone)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Order Date</div>
          <div class="text-sm">${esc(formatDate(order.order_date))}</div>
        </div>
      </div>
    </section>

    <div class="border-t-4 border-gray-100"></div>

    <!-- Shipping Address -->
    <section>
      <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">
        <span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">2</span>
        Shipping Address
      </div>
      <div class="border-4 border-black p-4">
        <div class="text-sm leading-relaxed">${esc(addr)}</div>
      </div>
    </section>

    <div class="border-t-4 border-gray-100"></div>

    <!-- Order Items -->
    <section>
      <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">
        <span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">3</span>
        Items Ordered (${lineItems.length})
      </div>
      <div class="space-y-3">
        ${lineItems.length === 0 ? '<div class="text-gray-500 text-sm">No line items found</div>' : 
          lineItems.map(li => {
            const qty = Number(li.quantity ?? 1);
            const unitCents = li.post_discount_unit_price_cents ?? li.unit_price_cents;
            const lineTotalCents = unitCents != null ? unitCents * qty : null;
            const imgHtml = li.product_image_url 
              ? `<img src="${esc(li.product_image_url)}" class="w-12 h-12 sm:w-16 sm:h-16 object-cover border-2 border-black flex-shrink-0" onerror="this.outerHTML='<div class=\\'w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 border-2 border-black flex items-center justify-center text-[10px] text-gray-400 flex-shrink-0\\'>📦</div>'" />`
              : `<div class="w-12 h-12 sm:w-16 sm:h-16 bg-gray-100 border-2 border-black flex items-center justify-center text-[10px] text-gray-400 flex-shrink-0">📦</div>`;
            return `
            <div class="border-4 border-black p-3 sm:p-4 flex gap-3 sm:gap-4">
              ${imgHtml}
              <div class="flex-1 min-w-0">
                ${li.product_slug
                  ? `<a href="/pages/product.html?slug=${encodeURIComponent(li.product_slug)}" target="_blank"
                      class="font-black text-sm line-clamp-2 text-kkpink hover:underline cursor-pointer">${esc(li.product_name || li.product_id || "Unknown Product")}</a>`
                  : `<span class="font-black text-sm line-clamp-2">${esc(li.product_name || li.product_id || "Unknown Product")}</span>`
                }
                ${li.variant ? `<div class="text-xs text-gray-500 mt-1">Variant: ${esc(li.variant)}</div>` : ""}
                <div class="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 mt-2 text-xs sm:text-sm">
                  <span>Qty: <strong>${qty}</strong></span>
                  <span>Price: <strong>${money(unitCents)}</strong></span>
                  <span>Revenue: <strong>${money(lineTotalCents)}</strong></span>
                </div>
                ${li.cpi_cents ? `
                <div class="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 mt-1 text-[11px] sm:text-xs text-red-600">
                  <span>CPI: ${money(li.cpi_cents)}/ea</span>
                  <span>×${qty} = <strong>${money(li.line_cost_cents)}</strong></span>
                </div>` : ''}
              </div>
            </div>
          `}).join("")}
      </div>
    </section>

    <div class="border-t-4 border-gray-100"></div>

    <!-- Order Summary / eBay Financials -->
    ${(() => {
      const isEbay = order.stripe_checkout_session_id?.startsWith("ebay_api_");
      const ef = order.ebay_financials;

      if (isEbay) {
        // ─── eBay Section 4: Buyer Summary ────────────────────────────────
        const finStatus = ef?.finance_status || "missing";
        const hasEarnings = ef?.ebay_order_earnings_cents != null;
        const isEstimated = finStatus === "estimated"; // ad fee not yet billed (< 2 days)
        const isEstNoAdFee = finStatus === "estimated_no_ad_fee"; // old sale, no ad fee found
        const statusBadge = {
          complete:              '<span class="ml-2 border-[2px] border-emerald-500 text-emerald-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">✓ COMPLETE</span>',
          estimated:             '<span class="ml-2 border-[2px] border-amber-400 text-amber-700 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ EST · Ad fee pending</span>',
          estimated_no_ad_fee:   '<span class="ml-2 border-[2px] border-amber-300 text-amber-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ EST · No ad fee</span>',
          partial:               '<span class="ml-2 border-[2px] border-amber-400 text-amber-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">≈ PARTIAL</span>',
          pending_finances:      '<span class="ml-2 border-[2px] border-blue-300 text-blue-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">🕐 PENDING FINANCES</span>',
          missing:               '<span class="ml-2 border-[2px] border-gray-300 text-gray-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">? NO DATA</span>',
        }[finStatus] || "";

        let section4 = `
        <section>
          <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">
            <span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">4</span>
            eBay Order Summary${statusBadge}
          </div>
          <div class="grid sm:grid-cols-3 gap-4">
            <div class="border-4 border-black p-4">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Buyer Subtotal</div>
              <div class="font-black text-lg">${money(order.subtotal_paid_cents)}</div>
              <div class="text-[9px] text-black/40 mt-1">From eBay Fulfillment API</div>
            </div>
            <div class="border-4 border-black p-4">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">eBay Tax (Buyer)</div>
              <div class="font-black text-lg text-gray-500">${money(order.tax_cents)}</div>
              <div class="text-[9px] text-black/40 mt-1">eBay collects & remits — not our revenue</div>
            </div>
            <div class="border-4 border-black p-4 bg-black text-white">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-white/60 mb-1">Buyer Total</div>
              <div class="font-black text-lg">${money(order.total_paid_cents)}</div>
            </div>
          </div>
          ${hasEarnings ? `
          <div class="mt-4 grid sm:grid-cols-4 gap-4">
            <div class="border-4 border-black p-4">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">eBay Fees Total</div>
              <div class="font-black text-lg text-red-600">${money(ef.ebay_total_fee_cents)}</div>
              <div class="text-[9px] text-black/40 mt-1">FVF${ef.per_order_ad_fee_cents > 0 ? " + Promo" : ""}</div>
            </div>
            <div class="border-4 border-black p-4">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Final Value Fee</div>
              <div class="font-black text-red-600">${money(ef.fee_final_value_cents)}</div>
              <div class="text-[9px] text-black/40 mt-1">In SALE transaction</div>
            </div>
            <div class="border-4 ${isEstimated ? "border-amber-300 bg-amber-50" : "border-black"} p-4">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Promoted Listing</div>
              ${isEstimated
                ? `<div class="font-black text-amber-600">—</div><div class="text-[9px] text-amber-600 mt-1">Not yet billed (1-2 day lag)</div>`
                : `<div class="font-black text-red-600">${money(ef.per_order_ad_fee_cents || 0)}</div><div class="text-[9px] text-black/40 mt-1">Separate NON_SALE_CHARGE</div>`
              }
            </div>
            <div class="border-4 border-black p-4">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Other Fees</div>
              <div class="font-black text-red-600">${money((ef.fee_regulatory_cents || 0) + (ef.fee_international_cents || 0) + (ef.fee_other_cents || 0))}</div>
              <div class="text-[9px] text-black/40 mt-1">Regulatory + Intl + Other</div>
            </div>
          </div>
          <div class="mt-3 border-4 ${isEstimated ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"} p-4 flex items-center justify-between">
            <div>
              <div class="text-[10px] font-black uppercase tracking-[.18em] ${isEstimated ? "text-amber-700/70" : "text-emerald-700/70"} mb-1">
                eBay Seller Earnings${isEstimated ? " (BEFORE promo fee)" : ""}
              </div>
              <div class="font-black text-xl ${isEstimated ? "text-amber-700" : "text-emerald-700"}">${money(ef.ebay_order_earnings_cents)}</div>
              <div class="text-[9px] ${isEstimated ? "text-amber-600/60" : "text-emerald-600/60"} mt-1">
                SALE.amount ${ef.per_order_ad_fee_cents > 0 ? "− Promoted listing fee" : ""} · ${ef.finance_synced_at ? new Date(ef.finance_synced_at).toLocaleDateString() : "—"}
              </div>
              ${isEstimated ? `<div class="text-[9px] text-amber-700 mt-1 font-black">⚠ Promoted listing fee not yet captured — final earnings will be lower</div>` : ""}
            </div>
            <div class="text-[10px] font-black uppercase tracking-[.18em] ${isEstimated ? "text-amber-700/50" : "text-emerald-700/50"}">
              = SALE − ${isEstimated ? "?" : "all"} fees
            </div>
          </div>` : `
          <div class="mt-4 border-4 border-blue-200 bg-blue-50 p-4">
            <div class="font-black text-sm text-blue-700 uppercase tracking-wider">eBay Finance Data Not Yet Available</div>
            <div class="text-xs text-blue-600 mt-1">eBay Finance API transactions are typically available 1–2 days after a sale. Run the eBay Finance sync to populate this data. Until then, profit estimates use total_paid_cents which overstates revenue.</div>
          </div>`}
        </section>`;

        // ─── eBay Section 5: Cost & eBay Profit ──────────────────────────
        const profitCents = order.profit_cents; // null when estimated (ad fee unknown)
        const profitKnown = profitCents != null;
        const profitColor = Number(profitCents) > 0 ? "text-emerald-600" : "text-red-600";

        let section5 = `
        <section>
          <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">
            <span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">5</span>
            Cost & eBay Net Profit
          </div>
          ${isEstimated ? `
          <div class="mb-4 border-4 border-amber-400 bg-amber-50 p-3 flex items-center gap-3">
            <span class="text-lg">⚠</span>
            <div class="text-[11px] text-amber-800">
              <strong>Promoted listing fee pending</strong> — eBay typically bills the ad fee 1-2 days after a sale. Profit cannot be accurately computed until it is captured. Re-run the eBay Finance sync tomorrow.
            </div>
          </div>` : ""}
          <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="border-4 border-black p-4">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Product CPI</div>
              <div class="font-black text-lg text-red-600">${money(order.product_cpi_cents)}</div>
              <div class="text-[9px] text-black/50 mt-1">Unit + China Ship</div>
            </div>
            <div class="border-4 border-black p-4">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">USPS Label</div>
              <div class="font-black text-lg text-red-600">${money(shipment?.label_cost_cents)}</div>
            </div>
            <div class="border-4 border-black p-4">
              <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">eBay Earnings</div>
              <div class="font-black text-lg ${hasEarnings ? (isEstimated ? "text-amber-700" : "text-emerald-700") : "text-gray-400"}">
                ${hasEarnings ? money(ef.ebay_order_earnings_cents) : "—"}
              </div>
              <div class="text-[9px] text-black/50 mt-1">
                ${isEstimated ? "Before promo fee" : (hasEarnings ? "After all eBay fees" : "Not yet synced")}
              </div>
            </div>
            <div class="border-4 border-black p-4 ${profitKnown ? "bg-emerald-50" : "bg-amber-50 border-amber-300"}">
              <div class="text-[10px] font-black uppercase tracking-[.18em] ${profitKnown ? "text-emerald-700/60" : "text-amber-700/70"} mb-1">
                ${profitKnown ? "Net Profit" : "Profit (pending)"}
              </div>
              <div class="font-black text-lg ${profitKnown ? profitColor : "text-amber-600"}">
                ${profitKnown ? money(profitCents) : "—"}
              </div>
              ${!profitKnown ? '<div class="text-[9px] text-amber-700 mt-1">Ad fee not yet captured</div>' : ""}
            </div>
          </div>
          ${profitKnown ? `
          <div class="mt-3 text-[10px] text-black/50 leading-relaxed">
            <strong>Formula:</strong> eBay earnings (${money(ef.ebay_order_earnings_cents)}) − Product CPI (${money(order.product_cpi_cents)}) − USPS label (${money(shipment?.label_cost_cents)})${order.refund ? ` − Refund (${money(order.refund?.refund_amount_cents)})` : ""} = <strong>${money(profitCents)}</strong>
          </div>` : `
          <div class="mt-3 text-[10px] text-amber-700 leading-relaxed border-l-4 border-amber-400 pl-3">
            Best case (ignoring promo fee): ${money(ef.ebay_order_earnings_cents)} − ${money(order.product_cpi_cents)} − ${money(shipment?.label_cost_cents)} = <strong>${money((ef.ebay_order_earnings_cents || 0) - (order.product_cpi_cents || 0) - (shipment?.label_cost_cents || 0))}</strong> (overstated until ad fee is synced)
          </div>`}
        </section>`;

        return section4 + '\n    <div class="border-t-4 border-gray-100"></div>\n' + section5;
      }

      // ─── Standard (non-eBay) Sections 4 & 5 ────────────────────────────
      return `
    <!-- Order Summary -->
    <section>
      <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">
        <span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">4</span>
        Order Summary
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Subtotal</div>
          <div class="font-black text-lg">${money(order.subtotal_paid_cents)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Shipping</div>
          <div class="font-black text-lg">${money(order.shipping_paid_cents)}</div>
        </div>
        <div class="border-4 border-black p-4 bg-black text-white">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-white/60 mb-1">Total Paid</div>
          <div class="font-black text-lg">${money(order.total_paid_cents)}</div>
        </div>
      </div>
    </section>

    <div class="border-t-4 border-gray-100"></div>

    <!-- Cost & Profit -->
    <section>
      <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">
        <span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">5</span>
        Cost & Profit
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Product CPI</div>
          <div class="font-black text-lg text-red-600">${money(order.product_cpi_cents)}</div>
          <div class="text-[9px] text-black/50 mt-1">Unit + China Ship</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">USPS Label</div>
          <div class="font-black text-lg text-red-600">${money(shipment?.label_cost_cents)}</div>
        </div>
        <div class="border-4 border-black p-4 ${(() => {
          const shippingMargin = (order.shipping_paid_cents || 0) - (shipment?.label_cost_cents || 0);
          return shipment?.label_cost_cents ? (shippingMargin >= 0 ? 'bg-emerald-50' : 'bg-red-50') : '';
        })()}">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Shipping Margin</div>
          ${shipment?.label_cost_cents ? (() => {
            const margin = (order.shipping_paid_cents || 0) - (shipment.label_cost_cents || 0);
            const color = margin >= 0 ? 'text-emerald-600' : 'text-red-600';
            return `<div class="font-black text-lg ${color}">${money(margin)}</div>
            <div class="text-[9px] text-black/50 mt-1">${money(order.shipping_paid_cents)} paid − ${money(shipment.label_cost_cents)} label</div>`;
          })() : `<div class="font-black text-lg text-gray-400">—</div>
          <div class="text-[9px] text-black/50 mt-1">${money(order.shipping_paid_cents)} paid · no label yet</div>`}
        </div>
        <div class="border-4 border-black p-4 bg-emerald-50">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700/60 mb-1">Profit</div>
          <div class="font-black text-lg text-emerald-600">${money(order.profit_cents)}</div>
        </div>
      </div>
    </section>`;
    })()}

    <div class="border-t-4 border-gray-100"></div>

    <!-- Fulfillment Status -->
    <section>
      <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">
        <span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">6</span>
        Fulfillment
      </div>
      <div class="grid sm:grid-cols-3 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Status</div>
          <div class="font-black uppercase">${esc(labelStatus.replace(/_/g, " "))}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Carrier</div>
          <div class="font-black">${esc(carrier)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Tracking</div>
          ${shipment?.tracking_url
            ? `<a href="${esc(shipment.tracking_url)}" target="_blank" class="font-mono text-sm break-all text-kkpink hover:underline">${esc(tracking)}</a>`
            : `<div class="font-mono text-sm break-all">${esc(tracking)}</div>`}
        </div>
      </div>

      ${(() => {
        // "Not yet scanned" warning: label purchased > 24h ago, no carrier scan
        if (labelStatus === "label_purchased" && shipment?.label_purchased_at && !shipment?.in_transit_at) {
          const hoursAgo = (Date.now() - new Date(shipment.label_purchased_at).getTime()) / 3600000;
          if (hoursAgo > 24) {
            return `<div class="mt-4 border-4 border-amber-400 bg-amber-50 p-4 flex items-center gap-3">
              <span class="text-2xl">⚠️</span>
              <div>
                <div class="font-black text-sm text-amber-800 uppercase tracking-wider">Not Yet Scanned</div>
                <div class="text-xs text-amber-700 mt-1">Label purchased ${Math.floor(hoursAgo)}h ago — no carrier scan detected. Check if package was dropped off.</div>
              </div>
            </div>`;
          }
        }
        return "";
      })()}

      ${shipment?.in_transit_at || shipment?.delivered_at || shipment?.estimated_delivery ? `
      <div class="grid sm:grid-cols-3 gap-4 mt-4">
        ${shipment.in_transit_at ? `<div class="border-4 border-blue-200 p-4 bg-blue-50">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-blue-600/60 mb-1">Shipped</div>
          <div class="font-black text-sm text-blue-700">${new Date(shipment.in_transit_at).toLocaleDateString()}</div>
        </div>` : ""}
        ${shipment.estimated_delivery ? `<div class="border-4 border-amber-200 p-4 bg-amber-50">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-amber-600/60 mb-1">ETA</div>
          <div class="font-black text-sm text-amber-700">${new Date(shipment.estimated_delivery).toLocaleDateString()}</div>
        </div>` : ""}
        ${shipment.delivered_at ? `<div class="border-4 border-emerald-200 p-4 bg-emerald-50">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-emerald-600/60 mb-1">Delivered</div>
          <div class="font-black text-sm text-emerald-700">${new Date(shipment.delivered_at).toLocaleDateString()}</div>
        </div>` : ""}
      </div>
      ` : ""}

      <!-- Shippo Label Actions -->
      <div class="mt-4 flex flex-wrap gap-3" data-label-actions>
        ${labelStatus === "pending" || labelStatus === "voided" ? `
          <div class="flex items-center gap-2">
            <select data-preset-select class="border-4 border-black px-3 py-2 text-xs font-black uppercase focus:border-kkpink outline-none bg-white">
              <option value="">Loading presets…</option>
            </select>
            <button data-buy-label class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white transition">
              🏷️ Buy Label
            </button>
          </div>
        ` : ""}

        ${shipment?.label_url ? `
          <button data-print-label class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-blue-600 text-blue-700 hover:bg-blue-600 hover:text-white transition">
            🖨️ Print Label
          </button>
          <button data-reprint-label class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-gray-400 text-gray-600 hover:bg-gray-400 hover:text-white transition">
            🔄 Reprint
          </button>
        ` : ""}

        ${shipment?.shippo_transaction_id && labelStatus === "label_purchased" ? `
          <button data-void-label class="px-4 py-2 text-xs font-black uppercase tracking-wider border-4 border-red-600 text-red-600 hover:bg-red-600 hover:text-white transition">
            ✕ Void Label
          </button>
        ` : ""}
      </div>

      ${shipment?.label_cost_cents && labelStatus !== "voided" ? `
        <div class="mt-3 text-xs text-gray-500">Label cost: <strong>$${(shipment.label_cost_cents / 100).toFixed(2)}</strong> · ${esc(shipment.service || "")} · ${esc(shipment.carrier || "")}</div>
      ` : ""}
    </section>

    <!-- Refund Status / Actions -->
    ${refundSectionHtml}

    <div class="border-t-4 border-gray-100"></div>

    <!-- IDs (collapsed) -->
    <details class="border-4 border-gray-200 p-4">
      <summary class="text-[11px] font-black uppercase tracking-[.18em] text-gray-500 cursor-pointer">
        Technical IDs
      </summary>
      <div class="mt-3 space-y-2 text-xs font-mono text-gray-600">
        <div><strong>KK Order:</strong> ${esc(order.kk_order_id)}</div>
        <div><strong>Stripe Session:</strong> ${esc(order.stripe_checkout_session_id)}</div>
        <div><strong>Payment Intent:</strong> ${esc(order.stripe_payment_intent_id || "—")}</div>
        <div><strong>Stripe Customer:</strong> ${esc(order.stripe_customer_id || "—")}</div>
      </div>
    </details>
  `;
}

/* -------------------------
   REFUND BUTTON WIRING
-------------------------- */
function wireRefundButtons(container, order, row) {
  const btnFull = container.querySelector("[data-refund-full]");
  const btnPartial = container.querySelector("[data-refund-partial]");
  const amtInput = container.querySelector("[data-refund-amount]");
  const reasonSelect = container.querySelector("[data-refund-reason-select]");

  const totalCents = order.total_paid_cents || 0;
  const alreadyRefundedCents = order.refund_amount_cents || 0;
  const remainingCents = totalCents - alreadyRefundedCents;

  // Helper: get selected reason (from dropdown for new refunds)
  function getSelectedReason() {
    return reasonSelect?.value || null;
  }

  // Helper: require reason before issuing refund
  function requireReason() {
    const reason = getSelectedReason();
    if (!reason) {
      alert("Please select a refund reason before issuing the refund.");
      reasonSelect?.focus();
      return null;
    }
    return reason;
  }

  // --- Wire reason toggle buttons (for already-refunded orders) ---
  container.querySelectorAll("[data-set-reason]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reason = btn.getAttribute("data-set-reason");
      if (reason === order.refund_reason) return; // already set

      btn.textContent = "Saving…";
      try {
        await updateRefundReason(order.stripe_checkout_session_id, reason);
        // Refresh modal
        state.openViewModal(row);
      } catch (err) {
        alert("Failed to update reason: " + (err.message || err));
        state.openViewModal(row);
      }
    });
  });

  // --- Wire full refund button ---
  if (btnFull && !btnFull.disabled) {
    btnFull.addEventListener("click", async () => {
      const reason = order.refund_status ? null : requireReason();
      if (!order.refund_status && !reason) return;

      const dollars = (remainingCents / 100).toFixed(2);
      if (!confirm(`Issue a FULL refund of $${dollars} for order ${order.kk_order_id || order.stripe_checkout_session_id}?\n\nReason: ${reason || order.refund_reason || "—"}\n\nThis cannot be undone.`)) return;

      btnFull.disabled = true;
      btnFull.textContent = "Processing…";
      try {
        const result = await issueRefund(order.stripe_checkout_session_id, null, reason);
        alert(`Refund successful!\nRefund ID: ${result.refund_id}\nAmount: $${(result.amount_refunded_cents / 100).toFixed(2)}`);
        state.openViewModal(row);
      } catch (err) {
        alert("Refund failed: " + (err.message || err));
        btnFull.disabled = false;
        btnFull.textContent = "Issue Full Refund";
      }
    });
  }

  // --- Wire partial refund button ---
  if (btnPartial) {
    btnPartial.addEventListener("click", async () => {
      const reason = order.refund_status ? null : requireReason();
      if (!order.refund_status && !reason) return;

      const val = parseFloat(amtInput?.value);
      if (!val || val <= 0) {
        alert("Enter a valid refund amount.");
        amtInput?.focus();
        return;
      }
      const amountCents = Math.round(val * 100);
      if (amountCents > remainingCents) {
        alert(`Amount exceeds refundable balance of $${(remainingCents / 100).toFixed(2)}.`);
        return;
      }
      if (!confirm(`Issue a partial refund of $${val.toFixed(2)} for order ${order.kk_order_id || order.stripe_checkout_session_id}?\n\nReason: ${reason || order.refund_reason || "—"}\n\nThis cannot be undone.`)) return;

      btnPartial.disabled = true;
      btnPartial.textContent = "Processing…";
      try {
        const result = await issueRefund(order.stripe_checkout_session_id, amountCents, reason);
        alert(`Partial refund successful!\nRefund ID: ${result.refund_id}\nAmount: $${(result.amount_refunded_cents / 100).toFixed(2)}`);
        state.openViewModal(row);
      } catch (err) {
        alert("Refund failed: " + (err.message || err));
        btnPartial.disabled = false;
        btnPartial.textContent = "Partial Refund";
      }
    });
  }
}

/* -------------------------
   LABEL ACTION BUTTONS
-------------------------- */
async function wireLabelButtons(container, order, shipment, row) {
  const sessionId = order.stripe_checkout_session_id;

  // Populate package preset dropdown
  const presetSelect = container.querySelector("[data-preset-select]");
  if (presetSelect) {
    try {
      const presets = await fetchPackagePresets();
      presetSelect.innerHTML = presets.map(p =>
        `<option value="${p.id}" ${p.is_default ? "selected" : ""}>${p.name} (${p.length_in}×${p.width_in}${p.height_in ? "×" + p.height_in : ""})</option>`
      ).join("");
    } catch (e) {
      presetSelect.innerHTML = '<option value="">Failed to load</option>';
    }
  }

  // Buy Label button
  const btnBuy = container.querySelector("[data-buy-label]");
  if (btnBuy) {
    btnBuy.addEventListener("click", async () => {
      const presetId = presetSelect?.value || null;
      btnBuy.disabled = true;
      btnBuy.textContent = "⏳ Buying…";
      try {
        const result = await buyShippingLabel(sessionId, presetId);
        if (result.duplicate) {
          alert(`Label already exists!\nTracking: ${result.data.tracking_number}`);
        } else {
          alert(`Label purchased!\nTracking: ${result.data.tracking_number}\nCost: $${(result.data.label_cost_cents / 100).toFixed(2)}\nService: ${result.data.service}`);
        }
        state.openViewModal(row); // refresh modal
        await reload({ hard: true }); // refresh table
      } catch (err) {
        alert("Label purchase failed: " + (err.message || err));
        btnBuy.disabled = false;
        btnBuy.textContent = "🏷️ Buy Label";
      }
    });
  }

  // Print / Reprint Label buttons
  const btnPrint = container.querySelector("[data-print-label]");
  const btnReprint = container.querySelector("[data-reprint-label]");
  const handlePrint = async (btn) => {
    if (!shipment?.label_url) return;
    // Open popup immediately (synchronous) so browser trusts the user gesture
    const pw = window.open("", "printLabel", "width=500,height=750");
    if (!pw) { alert("Popup blocked — please allow popups for this site."); return; }
    pw.document.write("<!DOCTYPE html><html><head><title>Loading label…</title></head><body><p>Loading label…</p></body></html>");
    pw.document.close();

    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⏳ Loading…";
    try {
      const url = await getSignedLabelUrl(shipment.label_url);
      const isPng = shipment.label_url.endsWith(".png");

      if (isPng) {
        // PNG label — render as image with auto-print
        pw.document.open();
        pw.document.write(`<!DOCTYPE html><html><head><title>Print Label</title>
<style>
  @page { size: 4in 6in; margin: 0; }
  * { margin: 0; padding: 0; }
  body { display: flex; justify-content: center; background: #222; }
  img { max-width: 100%; height: auto; }
  @media print { body { background: #fff; } img { width: 4in; height: 6in; object-fit: contain; } }
</style></head><body>
<img src="${url}" onload="setTimeout(function(){window.print();},400)">
</body></html>`);
        pw.document.close();
      } else {
        // PDF label (legacy) — navigate directly to PDF
        pw.location.href = url;
      }
    } catch (err) {
      pw.close();
      alert("Failed to get label: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  };
  if (btnPrint) btnPrint.addEventListener("click", () => handlePrint(btnPrint));
  if (btnReprint) btnReprint.addEventListener("click", () => handlePrint(btnReprint));

  // Void Label button
  const btnVoid = container.querySelector("[data-void-label]");
  if (btnVoid) {
    btnVoid.addEventListener("click", async () => {
      if (!confirm(`Void label for order ${order.kk_order_id || sessionId}?\n\nTracking: ${shipment.tracking_number}\n\nThis will request a refund from the carrier.`)) return;

      btnVoid.disabled = true;
      btnVoid.textContent = "⏳ Voiding…";
      try {
        const result = await voidShippingLabel(sessionId);
        alert(`Label voided!\nRefund status: ${result.data.refund_status}`);
        state.openViewModal(row);
        await reload({ hard: true });
      } catch (err) {
        alert("Void failed: " + (err.message || err));
        btnVoid.disabled = false;
        btnVoid.textContent = "✕ Void Label";
      }
    });
  }
}

function wireEvents() {
  // Import Amazon orders (TSV drop)
  wireAmazonImport({
    buttonEl: els.btnImportAmazon,
    setStatus,
    showPreview: ({ fileName, parsed, onConfirm }) => {
      // populate preview panel
      if (els.amzFileName) els.amzFileName.textContent = fileName;
      if (els.amzTotalRows) els.amzTotalRows.textContent = parsed.total;
      if (els.amzValidCount) els.amzValidCount.textContent = parsed.valid.length;
      if (parsed.cancelled.length) {
        if (els.amzCancelledWrap) els.amzCancelledWrap.classList.remove("hidden");
        if (els.amzCancelledCount) els.amzCancelledCount.textContent = parsed.cancelled.length;
      } else {
        if (els.amzCancelledWrap) els.amzCancelledWrap.classList.add("hidden");
      }
      // hide result panel, show preview
      if (els.amazonResultPanel) els.amazonResultPanel.classList.add("hidden");
      if (els.amazonPreviewPanel) els.amazonPreviewPanel.classList.remove("hidden");

      // wire confirm (replace to remove old listeners)
      if (els.amzConfirmBtn) {
        const btn = els.amzConfirmBtn.cloneNode(true);
        els.amzConfirmBtn.parentNode.replaceChild(btn, els.amzConfirmBtn);
        els.amzConfirmBtn = btn;
        btn.addEventListener("click", () => {
          els.amazonPreviewPanel?.classList.add("hidden");
          onConfirm();
        });
      }
    },
    onImported: async (result) => {
      // populate result panel
      if (els.amzOrdersCount) els.amzOrdersCount.textContent = result.ordersInserted;
      if (els.amzLineItemsCount) els.amzLineItemsCount.textContent = result.lineItemsInserted;
      if (els.amzRevenue) els.amzRevenue.textContent = `$${(result.revenue / 100).toFixed(2)}`;
      if (els.amzSkippedCount) els.amzSkippedCount.textContent = result.skippedDuplicates;

      // breakdown
      if (els.amzBreakdownWrap && result.breakdown) {
        const lines = Object.entries(result.breakdown)
          .sort((a, b) => b[1].cents - a[1].cents)
          .map(([code, p]) => `<div>${code} — ${p.qty} units — $${(p.cents / 100).toFixed(2)}</div>`);
        els.amzBreakdownWrap.innerHTML = lines.length
          ? `<div class="font-bold mb-1">Product breakdown:</div>${lines.join("")}`
          : "";
      }

      // unmapped SKUs warning
      if (els.amzUnmappedWrap) {
        if (result.unmappedSkus?.length) {
          els.amzUnmappedWrap.classList.remove("hidden");
          els.amzUnmappedWrap.innerHTML = `<div class="font-bold">⚠️ Unmapped SKUs:</div>` +
            result.unmappedSkus.map(s => `<div class="ml-2">${s}</div>`).join("");
        } else {
          els.amzUnmappedWrap.classList.add("hidden");
        }
      }

      if (els.amazonResultPanel) els.amazonResultPanel.classList.remove("hidden");

      // Keep modal open so user can see the result; it auto-hides after 15s
      if (els.amazonImportModal) els.amazonImportModal.classList.remove("hidden");

      // auto-hide after 15s
      setTimeout(() => {
        els.amazonResultPanel?.classList.add("hidden");
        els.amazonImportModal?.classList.add("hidden");
      }, 15000);

      // refresh the orders table
      await reload({ hard: true });
    },
  });

  // Search (debounced)
  els.searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => reload({ hard: true }), 250);
  });

  // Search clear button
  if (els.btnSearchClear) {
    const updateSearchClearBtn = () => {
      const hasValue = els.searchInput.value.length > 0;
      els.btnSearchClear.classList.toggle('hidden', !hasValue);
      const iconSearch = document.getElementById('iconSearch');
      if (iconSearch) iconSearch.classList.toggle('hidden', hasValue);
    };
    els.searchInput.addEventListener('input', updateSearchClearBtn);
    els.btnSearchClear.addEventListener('click', () => {
      els.searchInput.value = '';
      updateSearchClearBtn();
      reload({ hard: true });
    });
    // Initialize (e.g. if URL has ?q= pre-filled)
    updateSearchClearBtn();
  }

  // Filters — also update mobile badge count on change
  els.statusFilter.addEventListener("change", () => { reload({ hard: true }); updateFilterBadge(); });
  els.dateFrom.addEventListener("change", () => { reload({ hard: true }); updateFilterBadge(); });
  els.dateTo.addEventListener("change", () => { reload({ hard: true }); updateFilterBadge(); });
  if (els.reviewFilter) els.reviewFilter.addEventListener("change", () => { reload({ hard: true }); updateFilterBadge(); });

  // Manual refresh
  els.btnRefresh.addEventListener("click", () => reload({ hard: true }));

  // Load more
  els.btnLoadMore.addEventListener("click", () => loadMore());

  // Export Orders CSV
  els.btnExportShipReady.addEventListener("click", async () => {
    els.exportDropdownPanel?.classList.add('hidden');
    try {
      setStatus("Preparing CSV…");
      const filters = readFilters();
      const rows = await fetchOrderSummaryAllForExport(filters);
      downloadShipReadyCSV(rows, { filenamePrefix: "kk-orders" });
      setStatus(`CSV downloaded (${rows.length} orders).`);
    } catch (e) {
      console.error(e);
      setStatus(`Export failed: ${e?.message || e}`, true);
    }
  });

  // ── Export dropdown toggle ────────────────────────────────────
  if (els.btnExportDropdown && els.exportDropdownPanel) {
    els.btnExportDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      els.exportDropdownPanel.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      els.exportDropdownPanel?.classList.add('hidden');
    });
  }

  // ── Amazon Import modal ───────────────────────────────────────
  const openAmazonImportModal = () => {
    els.exportDropdownPanel?.classList.add('hidden');
    els.amazonImportModal?.classList.remove('hidden');
  };
  const closeAmazonImportModal = () => {
    els.amazonImportModal?.classList.add('hidden');
  };
  document.getElementById('btnAmazonImportOpen')?.addEventListener('click', openAmazonImportModal);
  document.getElementById('btnAmazonImportModalClose')?.addEventListener('click', closeAmazonImportModal);
  document.getElementById('amazonImportModalBackdrop')?.addEventListener('click', closeAmazonImportModal);

  // Auto-open the modal on import complete so result panel shows
  // (already handled in onImported — just keep it visible in the modal)

  // ── Mobile Filter Bottom Sheet ────────────────────────────────
  function updateFilterBadge() {
    if (!els.btnFilterToggle) return;
    const badge = document.getElementById('filterBadge');
    if (!badge) return;
    const count = [
      els.statusFilter?.value,
      els.reviewFilter?.value,
      els.dateFrom?.value,
      els.dateTo?.value,
    ].filter(Boolean).length;
    badge.textContent = String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  const closeFilterSheet = () => {
    els.filterSheet?.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  };

  if (els.btnFilterToggle && els.filterSheet) {
    els.btnFilterToggle.addEventListener('click', () => {
      // Sync current toolbar values into the sheet inputs
      const mfsStatus = document.getElementById('mfsStatus');
      const mfsReview = document.getElementById('mfsReview');
      const mfsDateFrom = document.getElementById('mfsDateFrom');
      const mfsDateTo = document.getElementById('mfsDateTo');
      if (mfsStatus) mfsStatus.value = els.statusFilter?.value || '';
      if (mfsReview) mfsReview.value = els.reviewFilter?.value || '';
      if (mfsDateFrom) mfsDateFrom.value = els.dateFrom?.value || '';
      if (mfsDateTo) mfsDateTo.value = els.dateTo?.value || '';
      els.filterSheet.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
    });
  }

  document.getElementById('btnFilterSheetClose')?.addEventListener('click', closeFilterSheet);
  document.getElementById('filterSheetBackdrop')?.addEventListener('click', closeFilterSheet);

  document.getElementById('btnFilterApply')?.addEventListener('click', () => {
    const mfsStatus = document.getElementById('mfsStatus');
    const mfsReview = document.getElementById('mfsReview');
    const mfsDateFrom = document.getElementById('mfsDateFrom');
    const mfsDateTo = document.getElementById('mfsDateTo');
    if (mfsStatus && els.statusFilter) els.statusFilter.value = mfsStatus.value;
    if (mfsReview && els.reviewFilter) els.reviewFilter.value = mfsReview.value;
    if (mfsDateFrom && els.dateFrom) els.dateFrom.value = mfsDateFrom.value;
    if (mfsDateTo && els.dateTo) els.dateTo.value = mfsDateTo.value;
    closeFilterSheet();
    reload({ hard: true });
    updateFilterBadge();
  });

  document.getElementById('btnFilterClearAll')?.addEventListener('click', () => {
    if (els.statusFilter) els.statusFilter.value = '';
    if (els.reviewFilter) els.reviewFilter.value = '';
    if (els.dateFrom) els.dateFrom.value = '';
    if (els.dateTo) els.dateTo.value = '';
    ['mfsStatus', 'mfsReview', 'mfsDateFrom', 'mfsDateTo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    closeFilterSheet();
    reload({ hard: true });
    updateFilterBadge();
  });

  document.getElementById('btnRefreshMobile')?.addEventListener('click', () => {
    closeFilterSheet();
    reload({ hard: true });
  });

  // Initialize badge on load (handles URL ?q= pre-fill or other restored state)
  updateFilterBadge();
}

function readFilters() {
  return {
    q: (els.searchInput.value || "").trim(),
    status: (els.statusFilter.value || "").trim(),
    dateFrom: (els.dateFrom.value || "").trim(),
    dateTo: (els.dateTo.value || "").trim(),
    reviewStatus: (els.reviewFilter?.value || "").trim(),
  };
}

/**
 * ✅ Server-side KPIs (totals across ALL matching rows)
 * Uses rpc_order_kpis() via fetchOrderKpis()
 */
async function updateKpisServer() {
  try {
    const filters = readFilters();
    const k = await fetchOrderKpis(filters);

    if (els.kpiOrders) els.kpiOrders.textContent = String(k?.orders_count ?? 0);
    if (els.kpiRevenue) els.kpiRevenue.textContent = moneyFromCents(k?.revenue_cents ?? 0);
    if (els.kpiProfit) els.kpiProfit.textContent = moneyFromCents(k?.profit_cents ?? 0);
    if (els.kpiUnfulfilled) {
      const unfulfilled = Number(k?.unfulfilled_count ?? 0);
      els.kpiUnfulfilled.textContent = String(unfulfilled);
      els.kpiUnfulfilled.classList.remove('text-amber-600', 'text-gray-400');
      els.kpiUnfulfilled.classList.add(unfulfilled > 0 ? 'text-amber-600' : 'text-gray-400');
    }
    if (els.kpiRefunded) {
      const cnt = Number(k?.refunded_count ?? 0);
      els.kpiRefunded.textContent = cnt > 0 ? `${cnt} (${moneyFromCents(k?.refunded_cents ?? 0)})` : '0';
      els.kpiRefunded.classList.remove('text-red-500', 'text-gray-400');
      els.kpiRefunded.classList.add(cnt > 0 ? 'text-red-500' : 'text-gray-400');
    }
  } catch (e) {
    console.error(e);
    // KPI failure should not block the page
  }
}

async function reload({ hard = false } = {}) {
  try {
    if (hard) {
      state.rows = [];
      state.offset = 0;
      state.totalCount = null;
      state.hasMore = true;
      els.ordersRows.innerHTML = "";
      setCountLabel(0, null);
      els.loadMoreStatus.textContent = "";
      els.btnLoadMore.classList.remove('hidden');
    }

    // ✅ Refresh KPIs for the full matching result set
    await updateKpisServer();

    await loadMore({ reset: hard });
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message || e), true);
  }
}

async function loadMore({ reset = false } = {}) {
  if (!state.hasMore && !reset) return;

  try {
    setStatus("Loading…");
    els.btnLoadMore.disabled = true;
    els.btnLoadMore.innerHTML = '<svg class="animate-spin inline w-4 h-4 mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Loading…';

    const filters = readFilters();

    const { rows, totalCount, hasMore } = await fetchOrderSummaryPage({
      ...filters,
      limit: state.limit,
      offset: state.offset,
    });

    // Append
    state.rows = state.rows.concat(rows);
    state.offset += rows.length;
    state.totalCount = totalCount;
    state.hasMore = hasMore;

    renderOrdersRows({
      tbodyEl: els.ordersRows,
      rows: state.rows,
      onEdit: (row) => state.modal?.open(row),
      onView: (row) => state.openViewModal?.(row),
    });

    // Count label shows "loaded / total"
    setCountLabel(state.rows.length, state.totalCount);

    if (!state.hasMore) {
      els.loadMoreStatus.textContent = `All ${state.rows.length} orders loaded`;
      els.btnLoadMore.classList.add('hidden');
    } else {
      els.loadMoreStatus.textContent =
        `Showing ${state.rows.length}` +
        (state.totalCount != null ? ` of ${state.totalCount} orders` : ' orders');
      els.btnLoadMore.classList.remove('hidden');
    }

    setStatus("✓");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message || e), true);
  } finally {
    els.btnLoadMore.innerHTML = 'Load More ↓';
    els.btnLoadMore.disabled = !state.hasMore;
  }
}
