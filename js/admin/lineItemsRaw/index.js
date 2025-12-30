// /js/admin/lineItemsRaw/index.js
import { initNavbar } from "../../shared/navbar.js";
import { getSession, fetchOrderLinesPaged } from "./api.js";
import { $, show, setMsg } from "./dom.js";
import { state } from "./state.js";
import { renderTable } from "./renderTable.js";
import { bindModal } from "./modalEditor.js";

function debounce(fn, wait = 350) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function requireEls(map, keys) {
  const missing = keys.filter((k) => !map[k]);
  if (missing.length) {
    console.error("[Admin LineItemsRaw] Missing required elements:", missing);
    return false;
  }
  return true;
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initNavbar();
  } catch (e) {
    console.error("[Admin LineItemsRaw] initNavbar failed:", e);
  }
  boot();
});

function boot() {
  const els = {
    status: $("lir_status"),
    appPanel: $("appPanel"),

    searchInput: $("searchInput"),
    btnRefresh: $("btnRefresh"),
    countLabel: $("countLabel"),
    lineItemRows: $("lineItemRows"),

    // load more
    btnLoadMore: $("btnLoadMore"),
    loadMoreStatus: $("loadMoreStatus"),

    // modal + fields
    modal: $("modal"),
    btnClose: $("btnClose"),
    btnSave: $("btnSave"),
    btnHardDelete: $("btnHardDelete"),
    modalMsg: $("modalMsg"),

    // modal fields (new simplified)
    fLineRowId: $("fLineRowId"),
    fSessionId: $("fSessionId"),
    fStripeLineItemId: $("fStripeLineItemId"),
    fProductId: $("fProductId"),
    fProductName: $("fProductName"),
    fVariant: $("fVariant"),
    fQuantity: $("fQuantity"),
    fWeightG: $("fWeightG"),
    fUnitPrice: $("fUnitPrice"),
    fPostDiscount: $("fPostDiscount"),
  };

  if (
    !requireEls(els, [
      "status",
      "appPanel",
      "searchInput",
      "btnRefresh",
      "countLabel",
      "lineItemRows",
      "btnLoadMore",
      "loadMoreStatus",
      "modal",
      "btnClose",
      "btnSave",
      "btnHardDelete",
      "modalMsg",
      "fLineRowId",
      "fSessionId",
      "fStripeLineItemId",
      "fProductId",
      "fProductName",
      "fVariant",
      "fQuantity",
      "fWeightG",
      "fUnitPrice",
      "fPostDiscount",
    ])
  ) return;

  const modal = bindModal(els, async () => {
    await resetAndLoad();
  });

  function render() {
    renderTable({
      tbodyEl: els.lineItemRows,
      countLabelEl: els.countLabel,
      onEdit: modal.openEdit,
    });

    els.btnLoadMore.disabled = state.loading || !state.hasMore;
    els.loadMoreStatus.textContent = state.loading
      ? "Loading…"
      : state.hasMore
      ? `Showing ${state.rows.length}.`
      : `Showing ${state.rows.length}. No more results.`;
  }

  async function fetchNextPage({ reset = false } = {}) {
    if (state.loading) return;
    if (!state.hasMore && !reset) return;

    state.loading = true;
    render();

    try {
      if (reset) {
        state.rows = [];
        state.offset = 0;
        state.hasMore = true;
      }

      const data = await fetchOrderLinesPaged({
        query: state.searchQuery,
        offset: state.offset,
        limit: state.pageSize,
      });

      // append
      state.rows = state.rows.concat(data);
      state.offset += data.length;

      // if we got less than pageSize, no more
      state.hasMore = data.length === state.pageSize;

      setMsg(els.status, `Loaded ${state.rows.length} rows ✓`, false);
    } catch (e) {
      console.error(e);
      setMsg(els.status, String(e?.message || e), true);
      state.hasMore = false;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function resetAndLoad() {
    state.searchQuery = (els.searchInput.value || "").trim();
    setMsg(els.status, "Loading…", false);
    await fetchNextPage({ reset: true });
  }

  const debouncedSearch = debounce(resetAndLoad, 350);

  function wire() {
    els.searchInput.addEventListener("input", debouncedSearch);

    els.btnRefresh.addEventListener("click", async () => {
      els.searchInput.value = "";
      state.searchQuery = "";
      setMsg(els.status, "Loading…", false);
      await fetchNextPage({ reset: true });
    });

    els.btnLoadMore.addEventListener("click", async () => {
      await fetchNextPage({ reset: false });
    });
  }

  async function initAuthSoft() {
    try {
      const session = await getSession();
      show(els.appPanel, true);
      if (!session) setMsg(els.status, "Not signed in (RLS may block data).", true);
    } catch (e) {
      console.warn("[Admin LineItemsRaw] Session check failed:", e);
      show(els.appPanel, true);
    }
  }

  wire();
  initAuthSoft();
  fetchNextPage({ reset: true });
}
