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
import {
  parseOpenAIInvoices,
  findExistingInvoices,
  bulkInsertInvoices
} from "./importInvoices.js";

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

/* ── import modal ────────────────────────────────── */

function openImportModal() {
  const { els } = window.__kkExpenses;
  els.importPasteArea.value = "";
  els.importPreviewWrap.classList.add("hidden");
  els.importPreviewBody.innerHTML = "";
  els.importDupeWarning.classList.add("hidden");
  els.btnRunImport.disabled = true;
  hideImportMsg(els);
  window.__kkExpenses.parsedInvoices = [];

  els.importModal.classList.remove("hidden");
  els.importModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => els.importPasteArea.focus(), 80);
}

function closeImportModal() {
  const { els } = window.__kkExpenses;
  els.importModal.classList.add("hidden");
  els.importModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function showImportMsg(els, text, isError = true) {
  els.importMsg.textContent = text;
  els.importMsg.className = `p-3 border-4 text-sm ${isError
    ? "border-red-300 bg-red-50 text-red-700"
    : "border-green-300 bg-green-50 text-green-700"}`;
  els.importMsg.classList.remove("hidden");
}

function hideImportMsg(els) {
  els.importMsg.classList.add("hidden");
  els.importMsg.textContent = "";
}

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function parseImport() {
  const { els } = window.__kkExpenses;
  hideImportMsg(els);

  const text = els.importPasteArea.value.trim();
  if (!text) {
    showImportMsg(els, "Paste invoice data first.", true);
    return;
  }

  const parsed = parseOpenAIInvoices(text);
  if (!parsed.length) {
    showImportMsg(els, "Could not parse any invoices from the pasted text.", true);
    return;
  }

  // Check for duplicates
  let existing = new Set();
  try {
    existing = await findExistingInvoices(parsed.map(p => p.invoice));
  } catch (err) {
    console.warn("Dupe check failed:", err);
  }

  const vendor = els.importVendor.value || "OpenAI";
  let newCount = 0;

  els.importPreviewBody.innerHTML = parsed.map(e => {
    const isDupe = existing.has(e.invoice);
    if (!isDupe) newCount++;
    return `
      <tr class="${isDupe ? 'bg-amber-50 text-amber-500 line-through' : ''}">
        <td class="px-3 py-1.5">${esc(e.expense_date)}</td>
        <td class="px-3 py-1.5 font-mono">${esc(e.invoice)}</td>
        <td class="px-3 py-1.5 text-right font-bold">$${(e.amount_cents / 100).toFixed(2)}</td>
        <td class="px-3 py-1.5">${isDupe ? "Already imported" : esc(e.status)}</td>
      </tr>`;
  }).join("");

  els.importPreviewWrap.classList.remove("hidden");
  els.importPreviewCount.textContent = `${newCount} new / ${parsed.length} total`;

  if (existing.size > 0) {
    els.importDupeWarning.classList.remove("hidden");
  } else {
    els.importDupeWarning.classList.add("hidden");
  }

  // Store only non-dupe entries for actual import
  window.__kkExpenses.parsedInvoices = parsed.filter(e => !existing.has(e.invoice));
  els.btnRunImport.disabled = window.__kkExpenses.parsedInvoices.length === 0;

  if (newCount === 0) {
    showImportMsg(els, "All invoices are already imported!", false);
  } else {
    showImportMsg(els, `${newCount} invoices ready to import as "${vendor}" expenses.`, false);
  }
}

async function runImport() {
  const { els } = window.__kkExpenses;
  const entries = window.__kkExpenses.parsedInvoices || [];
  if (!entries.length) return;

  const vendor = els.importVendor.value || "OpenAI";
  els.btnRunImport.disabled = true;
  els.btnParseInvoices.disabled = true;
  showImportMsg(els, `Importing ${entries.length} invoices…`, false);

  try {
    const count = await bulkInsertInvoices(entries, vendor);
    showImportMsg(els, `✓ Successfully imported ${count} expense${count === 1 ? "" : "s"}!`, false);
    window.__kkExpenses.parsedInvoices = [];
    els.btnRunImport.disabled = true;

    // Refresh data behind the modal
    await Promise.all([
      loadExpenses({ reset: true }),
      refreshKpis()
    ]);

    // Auto-close after a beat
    setTimeout(() => closeImportModal(), 1200);
  } catch (err) {
    console.error(err);
    showImportMsg(els, err?.message || "Import failed.", true);
    els.btnRunImport.disabled = false;
  } finally {
    els.btnParseInvoices.disabled = false;
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

  // Import modal
  els.btnImportInvoices?.addEventListener("click", () => openImportModal());
  els.btnCloseImport?.addEventListener("click", () => closeImportModal());
  els.btnCancelImport?.addEventListener("click", () => closeImportModal());
  els.btnParseInvoices?.addEventListener("click", () => parseImport());
  els.btnRunImport?.addEventListener("click", () => runImport());

  // Backdrop click to close import modal
  const importBackdrop = document.getElementById("importModalBackdrop");
  importBackdrop?.addEventListener("click", () => closeImportModal());

  // ESC to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeImportModal();
      closeModal(els);
    }
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
