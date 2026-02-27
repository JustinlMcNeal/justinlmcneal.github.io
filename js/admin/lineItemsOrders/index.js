// /js/admin/lineItemsOrders/index.js
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { els, wireDomHelpers, setStatus, setCountLabel, moneyFromCents, showImportResult, showImportPreview, hideImportPreview } from "./dom.js";
import { state } from "./state.js";
import { fetchOrderSummaryPage, fetchOrderSummaryAllForExport, fetchOrderKpis, importPirateShipExport, fetchOrderDetails, issueRefund, updateRefundReason } from "./api.js";
import { renderOrdersRows } from "./renderTable.js";
import { downloadShipReadyCSV } from "./shipReadyCsv.js";
import { bindEditModal } from "./modalEditor.js";
import { wirePirateShipImport } from "./pirateShipImport.js";
import { wireAmazonImport } from "./amazonImport.js";


wireDomHelpers();

document.addEventListener("DOMContentLoaded", async () => {
  // Admin nav + footer first
  await initAdminNav("Orders");
  initFooter();

  // Defaults
  els.searchInput.value = "";
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
                <a href="/pages/product.html?slug=${encodeURIComponent(li.product_slug || li.product_id || '')}" target="_blank"
                  class="font-black text-sm line-clamp-2 text-kkpink hover:underline cursor-pointer">${esc(li.product_name || li.product_id || "Unknown Product")}</a>
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
      <div class="grid sm:grid-cols-3 gap-4">
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Product CPI</div>
          <div class="font-black text-lg text-red-600">${money(order.product_cpi_cents)}</div>
          <div class="text-[9px] text-black/50 mt-1">Unit + China Ship</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">USPS Label</div>
          <div class="font-black text-lg text-red-600">${money(shipment?.label_cost_cents)}</div>
        </div>
        <div class="border-4 border-black p-4 bg-emerald-50">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700/60 mb-1">Profit</div>
          <div class="font-black text-lg text-emerald-600">${money(order.profit_cents)}</div>
        </div>
      </div>
    </section>

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
          <div class="font-mono text-sm break-all">${esc(tracking)}</div>
        </div>
      </div>
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

function wireEvents() {
      // Import Pirate Ship export (updates fulfillment_shipments)
  wirePirateShipImport({
    buttonEl: els.btnImportPirateShip,
    setStatus,
    showImportPreview,
    importFn: async ({ batchId, rows }) => {
      return await importPirateShipExport({ batchId, rows });
    },
    onImported: async ({ updated, skipped, batchId }) => {
      // Show import result panel
      showImportResult({ updated, skipped, batchId });
      // refresh list + KPIs after import
      await reload({ hard: true });
    },
  });

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

      // auto-hide after 15s
      setTimeout(() => els.amazonResultPanel?.classList.add("hidden"), 15000);

      // refresh the orders table
      await reload({ hard: true });
    },
  });

  // Search (debounced)
  els.searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => reload({ hard: true }), 250);
  });

  // Filters
  els.statusFilter.addEventListener("change", () => reload({ hard: true }));
  els.dateFrom.addEventListener("change", () => reload({ hard: true }));
  els.dateTo.addEventListener("change", () => reload({ hard: true }));
  if (els.reviewFilter) els.reviewFilter.addEventListener("change", () => reload({ hard: true }));

  // Manual refresh
  els.btnRefresh.addEventListener("click", () => reload({ hard: true }));

  // Load more
  els.btnLoadMore.addEventListener("click", () => loadMore());

  // Export ship-ready
  els.btnExportShipReady.addEventListener("click", async () => {
    try {
      setStatus("Preparing CSV…");
      const filters = readFilters();
      const rows = await fetchOrderSummaryAllForExport(filters);
      downloadShipReadyCSV(rows, { filenamePrefix: "kk-ship-ready" });
      setStatus(`CSV downloaded (${rows.length} orders).`);
    } catch (e) {
      console.error(e);
      setStatus(`Export failed: ${e?.message || e}`, true);
    }
  });
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
    if (els.kpiUnfulfilled) els.kpiUnfulfilled.textContent = String(k?.unfulfilled_count ?? 0);
    if (els.kpiRefunded) {
      const cnt = Number(k?.refunded_count ?? 0);
      els.kpiRefunded.textContent = cnt > 0 ? `${cnt} (${moneyFromCents(k?.refunded_cents ?? 0)})` : '0';
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
      els.loadMoreStatus.textContent = "End of results.";
    } else {
      els.loadMoreStatus.textContent =
        `Loaded ${state.rows.length}` +
        (state.totalCount != null ? ` / ${state.totalCount}` : "");
    }

    setStatus("✓");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message || e), true);
  } finally {
    els.btnLoadMore.disabled = !state.hasMore;
  }
}
