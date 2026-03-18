// /js/admin/expenses/index.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";

import { initExpensesState } from "./state.js";
import { getExpensesList, upsertExpense, deleteExpense, getExpenseKpis } from "./api.js";
import { getEls, bindUI } from "./dom.js";
import {
  renderExpensesTable,
  renderMobileCards,
  wireRowClicks,
  wireMobileClicks
} from "./renderTable.js";
import {
  openModal,
  closeModal,
  readForm,
  showMsg,
  hideMsg,
  setBusy,
  setupMileageListeners
} from "./modal.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ADMIN_ENTRY_PAGE = "/pages/admin/index.html";

/* ── helpers ────────────────────────────────────── */

function fmtMoney(cents) {
  return "$" + (cents / 100).toFixed(2);
}

async function requireAdminSession(els) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.warn(error);
  if (!session) {
    if (els?.status) els.status.textContent = "Admin session required. Redirecting…";
    window.location.replace(ADMIN_ENTRY_PAGE);
    return null;
  }
  return session;
}

/* ── KPI rendering ──────────────────────────────── */

async function refreshKpis() {
  const { els } = window.__kkExpenses;
  try {
    const kpi = await getExpenseKpis();
    els.kpiTotalSpent.textContent = fmtMoney(kpi.totalCents);
    els.kpiThisMonth.textContent = fmtMoney(kpi.monthCents);
    els.kpiCount.textContent = kpi.count;
    els.kpiTopCategory.textContent = kpi.topCategory;
    if (els.kpiTotalMiles) {
      els.kpiTotalMiles.textContent = kpi.totalMiles
        ? kpi.totalMiles.toFixed(1) + " mi"
        : "0";
    }
  } catch (err) {
    console.warn("KPI load failed:", err);
  }
}

/* ── table loading ──────────────────────────────── */

async function loadExpenses({ reset = false } = {}) {
  const { els, state } = window.__kkExpenses;
  if (state.loading) return;

  try {
    state.loading = true;
    els.status.textContent = reset ? "Loading…" : "Loading more…";

    if (reset) {
      state.offset = 0;
      state.rows = [];
      state.hasMore = true;
      els.loadMoreStatus.textContent = "";
    }

    const res = await getExpensesList({
      q: state.q,
      category: state.category,
      sortBy: state.sortBy,
      limit: state.limit,
      offset: state.offset
    });

    const rows = res.rows || [];
    const total = res.total ?? null;

    state.rows = reset ? rows : state.rows.concat(rows);
    state.offset = state.rows.length;
    state.hasMore = rows.length === state.limit;

    // Desktop
    renderExpensesTable(els.expensesRows, state.rows);
    wireRowClicks(els.expensesRows, (id) => openExpense(id));

    // Mobile
    renderMobileCards(els.mobileExpenseCards, state.rows);
    wireMobileClicks(els.mobileExpenseCards, (id) => openExpense(id));

    // Empty state
    if (els.emptyState) {
      els.emptyState.classList.toggle("hidden", state.rows.length > 0);
    }

    // Count
    if (typeof total === "number") {
      els.expenseCount.textContent = `${total} expense${total === 1 ? "" : "s"}`;
    } else {
      els.expenseCount.textContent = `${state.rows.length} expense${state.rows.length === 1 ? "" : "s"}`;
    }

    els.btnLoadMore.disabled = !state.hasMore;
    els.status.textContent = "";
    els.loadMoreStatus.textContent = state.hasMore ? "" : "All expenses loaded.";
  } catch (err) {
    console.error(err);
    els.status.textContent = err?.message || "Failed to load expenses.";
  } finally {
    state.loading = false;
  }
}

/* ── modal actions ──────────────────────────────── */

function openExpense(id) {
  const { els, state } = window.__kkExpenses;
  const row = id ? state.rows.find(r => r.id === id) : null;
  state.editingId = id || null;
  openModal(els, { id, row });
}

async function saveExpense() {
  const { els, state } = window.__kkExpenses;
  const payload = readForm(els);

  // Attach id if editing
  if (state.editingId) {
    payload.id = state.editingId;
  }

  setBusy(els, true, "Saving…");

  try {
    await upsertExpense(payload);
    showMsg(els, "Saved!", false);
    setTimeout(() => closeModal(els), 600);
    await Promise.all([
      loadExpenses({ reset: true }),
      refreshKpis()
    ]);
  } catch (err) {
    console.error(err);
    showMsg(els, err?.message || "Save failed.", true);
  } finally {
    setBusy(els, false, "");
  }
}

async function removeExpense() {
  const { els, state } = window.__kkExpenses;
  if (!state.editingId) return;

  if (!confirm("Delete this expense? This cannot be undone.")) return;

  setBusy(els, true, "Deleting…");

  try {
    await deleteExpense(state.editingId);
    closeModal(els);
    await Promise.all([
      loadExpenses({ reset: true }),
      refreshKpis()
    ]);
  } catch (err) {
    console.error(err);
    showMsg(els, err?.message || "Delete failed.", true);
  } finally {
    setBusy(els, false, "");
  }
}

/* ── wiring ─────────────────────────────────────── */

function attachHandlers() {
  const { els, state } = window.__kkExpenses;

  bindUI(els, {
    onSearch: async (q) => {
      state.q = q;
      await loadExpenses({ reset: true });
    },
    onFilterCategory: async (category) => {
      state.category = category;
      await loadExpenses({ reset: true });
    },
    onSort: async (sortBy) => {
      state.sortBy = sortBy;
      await loadExpenses({ reset: true });
    },
    onLoadMore: async () => {
      await loadExpenses({ reset: false });
    },
    onAdd: () => openExpense(null),
    onCloseModal: () => closeModal(els),
    onSave: () => saveExpense(),
    onDelete: () => removeExpense()
  });

  // ESC to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal(els);
  });
}

/* ── boot ───────────────────────────────────────── */

async function boot() {
  await initAdminNav("Expenses");
  initFooter();

  const els = getEls();
  const session = await requireAdminSession(els);
  if (!session) return;

  const state = initExpensesState();
  window.__kkExpenses = { els, state, session };

  attachHandlers();
  setupMileageListeners(els);

  // Initial load
  await Promise.all([
    loadExpenses({ reset: true }),
    refreshKpis()
  ]);
}

boot();
