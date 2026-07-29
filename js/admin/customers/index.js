// /js/admin/customers/index.js
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { requireAdmin } from "/js/shared/guard.js";

import { initCustomersState } from "./state.js";
import { getCustomersList, upsertCustomerProfile, getCustomerOrderHistory } from "./api.js";
import { getEls, bindUI } from "./dom.js";
import {
  renderCustomersTable,
  wireCustomerRowClicks,
  renderMobileCustomerCards,
  wireMobileCardClicks
} from "./renderTable.js";
import {
  openCustomerModal,
  closeCustomerModal,
  fillCustomerModal,
  readCustomerForm,
  renderOrderHistory,
  setModalBusy
} from "./modalCustomer.js";

const ADMIN_ENTRY_PAGE = "/pages/admin/login.html";

function buildLoginRedirect() {
  const next = `${location.pathname}${location.search}`;
  return `${ADMIN_ENTRY_PAGE}?next=${encodeURIComponent(next)}`;
}

const DEBUG = false;

function log(...args) {
  if (DEBUG) console.log("[customers]", ...args);
}

async function loadCustomers({ reset = false } = {}) {
  const { els, state } = window.__kkCustomers;
  if (state.loading) return;

  try {
    state.loading = true;
    els.status.textContent = reset ? "Loading..." : "Loading more...";

    if (reset) {
      state.offset = 0;
      state.rows = [];
      state.hasMore = true;
      els.loadMoreStatus.textContent = "";
    }

    const res = await getCustomersList({
      q: state.q,
      sortBy: state.sortBy,
      limit: state.limit,
      offset: state.offset
    });

    const rows = res.rows || [];
    const total = res.total ?? null;

    state.rows = reset ? rows : state.rows.concat(rows);
    state.offset = state.rows.length;
    state.hasMore = rows.length === state.limit;

    renderCustomersTable(els.customersRows, state.rows);
    wireCustomerRowClicks(els.customersRows, async (email) => {
      await openCustomer(email);
    });

    renderMobileCustomerCards(els.mobileCustomerCards, state.rows);
    wireMobileCardClicks(els.mobileCustomerCards, async (email) => {
      await openCustomer(email);
    });

    if (typeof total === "number") {
      els.customerCount.textContent = `${total} customers`;
    } else {
      els.customerCount.textContent = `${state.rows.length} customers`;
    }

    els.btnLoadMore.disabled = !state.hasMore;
    els.status.textContent = "";
    els.loadMoreStatus.textContent = state.hasMore ? "" : "No more customers.";
  } catch (err) {
    console.error(err);
    els.status.textContent = err?.message || "Failed to load customers.";
  } finally {
    state.loading = false;
  }
}

async function openCustomer(email) {
  const { els, state } = window.__kkCustomers;

  const summary = state.rows.find(r => (r.email || "").toLowerCase() === (email || "").toLowerCase()) || null;

  openCustomerModal(els);
  fillCustomerModal(els, summary);
  setModalBusy(els, true, "Loading order history...");

  try {
    const orders = await getCustomerOrderHistory(email);
    renderOrderHistory(els, orders);
    setModalBusy(els, false, "");
  } catch (err) {
    console.error(err);
    setModalBusy(els, false, err?.message || "Failed to load order history.");
  }
}

async function saveCustomer() {
  const { els } = window.__kkCustomers;

  const payload = readCustomerForm(els);
  if (!payload.email) {
    setModalBusy(els, false, "Email is required.");
    return;
  }

  setModalBusy(els, true, "Saving...");

  try {
    await upsertCustomerProfile(payload);
    setModalBusy(els, false, "Saved.");
    await loadCustomers({ reset: true });
  } catch (err) {
    console.error(err);
    setModalBusy(els, false, err?.message || "Save failed.");
  }
}

function attachHandlers() {
  const { els, state } = window.__kkCustomers;

  bindUI(els, {
    onSearch: async (q) => {
      state.q = q;
      await loadCustomers({ reset: true });
    },
    onSort: async (sortBy) => {
      state.sortBy = sortBy;
      await loadCustomers({ reset: true });
    },
    onLoadMore: async () => {
      await loadCustomers({ reset: false });
    },
    onOpenPicker: async () => {},
    onCloseModal: () => closeCustomerModal(els),
    onCancelModal: () => closeCustomerModal(els),
    onSaveModal: async () => await saveCustomer(),
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCustomerModal(els);
  });
}

async function boot() {
  await initAdminNav("Customers");
  initFooter();

  const els = getEls();
  const guard = await requireAdmin();
  if (!guard.ok) {
    if (els?.status) els.status.textContent = guard.reason || "Admin access required.";
    window.location.replace(buildLoginRedirect());
    return;
  }

  const state = initCustomersState();
  window.__kkCustomers = { els, state };

  attachHandlers();
  await loadCustomers({ reset: true });
}

boot();
