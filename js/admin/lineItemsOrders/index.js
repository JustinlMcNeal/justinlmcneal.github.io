// /js/admin/lineItemsOrders/index.js
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { els, wireDomHelpers, setStatus, setCountLabel, moneyFromCents } from "./dom.js";
import { state } from "./state.js";
import { fetchOrderSummaryPage, fetchOrderSummaryAllForExport, fetchOrderKpis, importPirateShipExport, fetchOrderDetails } from "./api.js";
import { renderOrdersRows } from "./renderTable.js";
import { downloadShipReadyCSV } from "./shipReadyCsv.js";
import { bindEditModal } from "./modalEditor.js";
import { wirePirateShipImport } from "./pirateShipImport.js";


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
    } catch (err) {
      console.error(err);
      viewModalBody.innerHTML = `<div class="text-red-600 p-4">${err.message || "Failed to load order"}</div>`;
    }
  };
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

  // Address
  const addr = [
    order.shipping_line1,
    order.shipping_line2,
    order.shipping_city,
    order.shipping_state,
    order.shipping_postal_code,
    order.shipping_country,
  ].filter(Boolean).join(", ") || "—";

  // Status
  const labelStatus = shipment?.label_status || "pending";
  const tracking = shipment?.tracking_number || "—";
  const carrier = shipment?.carrier || "—";

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
          lineItems.map(li => `
            <div class="border-4 border-black p-4 flex gap-4">
              ${li.product_image_url 
                ? `<img src="${esc(li.product_image_url)}" class="w-16 h-16 object-cover border-2 border-black flex-shrink-0" />`
                : `<div class="w-16 h-16 bg-gray-100 border-2 border-black flex items-center justify-center text-[10px] text-gray-400 flex-shrink-0">No img</div>`}
              <div class="flex-1 min-w-0">
                <div class="font-black text-sm line-clamp-2">${esc(li.product_name || "Unknown Product")}</div>
                ${li.variant ? `<div class="text-xs text-gray-500 mt-1">Variant: ${esc(li.variant)}</div>` : ""}
                <div class="flex items-center gap-4 mt-2 text-sm">
                  <span>Qty: <strong>${esc(li.quantity || 1)}</strong></span>
                  <span>Price: <strong>${money(li.amount_cents)}</strong></span>
                </div>
              </div>
            </div>
          `).join("")}
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
          <div class="font-black text-lg">${money(order.subtotal_cents)}</div>
        </div>
        <div class="border-4 border-black p-4">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-black/60 mb-1">Shipping</div>
          <div class="font-black text-lg">${money(order.shipping_cents)}</div>
        </div>
        <div class="border-4 border-black p-4 bg-black text-white">
          <div class="text-[10px] font-black uppercase tracking-[.18em] text-white/60 mb-1">Total Paid</div>
          <div class="font-black text-lg">${money(order.total_paid_cents)}</div>
        </div>
      </div>
    </section>

    <div class="border-t-4 border-gray-100"></div>

    <!-- Fulfillment Status -->
    <section>
      <div class="text-[11px] font-black uppercase tracking-[.25em] flex items-center gap-2 mb-4">
        <span class="w-5 h-5 bg-black text-white text-[10px] flex items-center justify-center">5</span>
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

function wireEvents() {
      // Import Pirate Ship export (updates fulfillment_shipments)
  wirePirateShipImport({
    buttonEl: els.btnImportPirateShip,
    setStatus,
    importFn: async ({ batchId, rows }) => {
      return await importPirateShipExport({ batchId, rows });
    },
    onImported: async () => {
      // refresh list + KPIs after import
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
