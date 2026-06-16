// /js/admin/lineItemsOrders/index.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { els, wireDomHelpers, setStatus, setCountLabel, moneyFromCents, getOrderSource } from "./dom.js";
import { state } from "./state.js";
import {
  fetchOrderSummaryPage,
  fetchOrderSummaryAllForExport,
  fetchOrderKpis,
  fetchOrderSummaryRow,
} from "./api.js";
import { renderOrdersRows } from "./renderTable.js";
import { downloadShipReadyCSV } from "./shipReadyCsv.js";
import { wireAmazonImport } from "./amazonImport.js";
import { wireAmazonOrderSync, wireAmazonFinanceSync } from "./amazonOrderSync.js";
import { wireEbayOrderSync } from "./ebayOrderSync.js";
import { initWorkspace, openWorkspace } from "./workspace.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ADMIN_ENTRY_PAGE = "/pages/admin/index.html";

async function requireAdminSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.warn(error);
  if (!session) {
    setStatus("Admin session required. Redirecting\u2026");
    window.location.replace(ADMIN_ENTRY_PAGE);
    return null;
  }
  return session;
}

wireDomHelpers();

document.addEventListener("DOMContentLoaded", async () => {
  // Admin nav + footer first
  await initAdminNav("Orders");
  initFooter();

  // Auth guard — must pass before any data is loaded
  const session = await requireAdminSession();
  if (!session) return;

  // Set sticky toolbar top to match admin nav height
  requestAnimationFrame(() => {
    const navMount = document.getElementById('kkAdminNavMount');
    const toolbar = document.getElementById('toolbar');
    if (navMount && toolbar) toolbar.style.top = `${navMount.offsetHeight}px`;
  });

  // Defaults — check URL for deep-link params (Phase 9A + admin reviews order links)
  const urlParams = new URLSearchParams(window.location.search);
  const urlQ =
    urlParams.get("q") ||
    urlParams.get("session_id") ||
    urlParams.get("order_id") ||
    "";
  els.searchInput.value = urlQ;
  els.statusFilter.value = "";
  els.dateFrom.value = "";
  els.dateTo.value = "";

  // Init workspace (replaces separate edit + view modals)
  initWorkspace({
    onSaved: async () => {
      await reload({ hard: true });
    },
  });

  wireEvents();
  await reload({ hard: true });
  await applyLineItemsDeepLink(urlParams);
});

// ── Shared helpers used by multiple wire* functions ──────────────
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

function closeFilterSheet() {
  els.filterSheet?.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

// ── Wire helpers ─────────────────────────────────────────────────

function wireAmazonModal() {
  // Modal open/close buttons
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

  wireAmazonOrderSync({
    buttonEl: document.getElementById("btnSyncAmazonOrders"),
    setStatus,
    onSynced: async () => {
      els.exportDropdownPanel?.classList.add("hidden");
      await reload({ hard: true });
    },
  });

  wireAmazonOrderSync({
    buttonEl: document.getElementById("btnSyncAmazonOrdersToolbar"),
    setStatus,
    onSynced: async () => {
      await reload({ hard: true });
    },
  });

  wireEbayOrderSync({
    buttonEl: document.getElementById("btnSyncEbayOrders"),
    setStatus,
    onSynced: async () => {
      els.exportDropdownPanel?.classList.add("hidden");
      await reload({ hard: true });
    },
  });

  wireEbayOrderSync({
    buttonEl: document.getElementById("btnSyncEbayOrdersToolbar"),
    setStatus,
    onSynced: async () => {
      await reload({ hard: true });
    },
  });

  wireAmazonFinanceSync({
    buttonEl: document.getElementById("btnSyncAmazonFinances"),
    setStatus,
    onSynced: async () => {
      els.exportDropdownPanel?.classList.add("hidden");
      await reload({ hard: true });
    },
  });
}

function wireFilterControls() {
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
}

function wireExportControls() {
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

  // Export dropdown toggle
  if (els.btnExportDropdown && els.exportDropdownPanel) {
    els.btnExportDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      els.exportDropdownPanel.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      els.exportDropdownPanel?.classList.add('hidden');
    });
  }
}

function wireMobileFilterSheet() {
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

function wireLoadControls() {
  // Manual refresh
  els.btnRefresh.addEventListener("click", () => reload({ hard: true }));
  // Load more
  els.btnLoadMore.addEventListener("click", () => loadMore());
}

function wireEvents() {
  wireAmazonModal();
  wireFilterControls();
  wireExportControls();
  wireMobileFilterSheet();
  wireLoadControls();
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

const VALID_WS_TABS = new Set(["overview", "fulfillment", "financials", "labels", "ids"]);

/**
 * Match an order summary row by session / kk order id with optional channel hint.
 * @param {string} sessionId
 * @param {string} [channelHint]
 */
function findLoadedOrderRow(sessionId, channelHint = "") {
  const matches = state.rows.filter(
    (r) =>
      r.stripe_checkout_session_id === sessionId || String(r.kk_order_id || "") === sessionId,
  );
  if (!matches.length) return null;
  if (channelHint) {
    return matches.find((r) => getOrderSource(r) === channelHint) || matches[0];
  }
  return matches[0];
}

/**
 * Open workspace when session_id / order_id deep-link params are present (Phase 9A + 10I).
 * @param {URLSearchParams} urlParams
 */
async function applyLineItemsDeepLink(urlParams) {
  const sessionId = (urlParams.get("session_id") || urlParams.get("order_id") || "").trim();
  if (!sessionId) return;

  const lineId = (urlParams.get("line_id") || "").trim() || null;
  const channelHint = (urlParams.get("channel") || "").trim().toLowerCase();
  const rawTab = (urlParams.get("tab") || "").trim().toLowerCase();
  const tab =
    VALID_WS_TABS.has(rawTab) ? rawTab : lineId && !rawTab ? "overview" : "overview";

  let row = findLoadedOrderRow(sessionId, channelHint);

  if (!row) {
    try {
      row = await fetchOrderSummaryRow(sessionId);
      if (row && channelHint && getOrderSource(row) !== channelHint) {
        const { rows } = await fetchOrderSummaryPage({ q: sessionId, limit: 25, offset: 0 });
        const alt = rows.find(
          (r) =>
            (r.stripe_checkout_session_id === sessionId ||
              String(r.kk_order_id || "") === sessionId) &&
            getOrderSource(r) === channelHint,
        );
        if (alt) row = alt;
      }
    } catch (err) {
      console.warn("[lineItemsDeepLink] order lookup failed:", err);
    }
  }

  if (!row) {
    setStatus(`Order not found for deep link: ${sessionId}`, true);
    return;
  }

  await openWorkspace(row, {
    tab,
    focusLineItemId: lineId,
  });
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
      onEdit: (row) => openWorkspace(row, { tab: "fulfillment" }),
      onView: (row) => openWorkspace(row, { tab: "overview" }),
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
