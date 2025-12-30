// /js/admin/customers/index.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

import { initCustomersState } from "./state.js";
import { getCustomersList, upsertCustomerProfile, getCustomerOrderHistory } from "./api.js";
import { getEls, bindUI } from "./dom.js";
import { renderCustomersTable, wireCustomerRowClicks } from "./renderTable.js";
import {
  openCustomerModal,
  closeCustomerModal,
  fillCustomerModal,
  readCustomerForm,
  renderOrderHistory,
  setModalBusy
} from "./modalCustomer.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ Change this later when you make an admin home/login page.
// For now this matches your existing "default admin destination" behavior.
const ADMIN_ENTRY_PAGE = "/pages/admin/index.html";

async function requireAdminSession(els) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.warn(error);

  if (!session) {
    // No session → send them to your admin entry flow
    if (els?.status) els.status.textContent = "Admin session required. Redirecting…";
    window.location.replace(ADMIN_ENTRY_PAGE);
    return null;
  }
  return session;
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

    // Count label
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

  // Find the row from current list (for quick fill)
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

    // Refresh list so edited fields show
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

  // Close modal with ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCustomerModal(els);
  });
}
async function boot() {
  const els = getEls();
  const session = await requireAdminSession(els);
  if (!session) return; // redirected

  const state = initCustomersState();
  window.__kkCustomers = { els, state, session };

  attachHandlers();
  await loadCustomers({ reset: true });
}

boot();
