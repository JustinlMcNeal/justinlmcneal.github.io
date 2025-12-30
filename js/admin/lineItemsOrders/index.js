// /js/admin/lineItemsOrders/index.js
import { els, wireDomHelpers, setStatus, setCountLabel, moneyFromCents } from "./dom.js";
import { state } from "./state.js";
import { fetchOrderSummaryPage, fetchOrderSummaryAllForExport, fetchOrderKpis, importPirateShipExport } from "./api.js";
import { renderOrdersRows } from "./renderTable.js";
import { downloadShipReadyCSV } from "./shipReadyCsv.js";
import { bindEditModal } from "./modalEditor.js";
import { wirePirateShipImport } from "./pirateShipImport.js";


wireDomHelpers();

document.addEventListener("DOMContentLoaded", () => {
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

  wireEvents();
  reload({ hard: true });
});

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
