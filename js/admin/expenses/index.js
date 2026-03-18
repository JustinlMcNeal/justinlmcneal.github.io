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
import {
  parseEbayTransactions,
  updateOrderShippingCosts,
  findExistingEbayExpenses,
  importEbayExpenses
} from "./importEbayTransactions.js";
import {
  parseGitHubBilling,
  findExistingGitHubExpenses,
  bulkInsertGitHubExpenses
} from "./importGitHub.js";
import {
  parseAmazonTransactions,
  updateAmazonShippingCosts,
  findExistingAmazonExpenses,
  importAmazonExpenses
} from "./importAmazonTxn.js";

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

/* ── eBay transaction modal ─────────────────────── */

function openEbayTxnModal() {
  const { els } = window.__kkExpenses;
  els.ebayTxnPreviewWrap?.classList.add("hidden");
  els.btnRunEbayTxn.disabled = true;
  els.btnParseEbayTxn.disabled = true;
  els.ebayTxnFileName?.classList.add("hidden");
  hideEbayTxnMsg();
  window.__kkExpenses.ebayTxnFile = null;
  window.__kkExpenses.ebayTxnParsed = null;

  els.ebayTxnModal?.classList.remove("hidden");
  els.ebayTxnModal?.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeEbayTxnModal() {
  const { els } = window.__kkExpenses;
  els.ebayTxnModal?.classList.add("hidden");
  els.ebayTxnModal?.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function showEbayTxnMsg(text, isError = true) {
  const { els } = window.__kkExpenses;
  els.ebayTxnMsg.textContent = text;
  els.ebayTxnMsg.className = `p-3 border-4 text-sm ${isError
    ? "border-red-300 bg-red-50 text-red-700"
    : "border-green-300 bg-green-50 text-green-700"}`;
  els.ebayTxnMsg.classList.remove("hidden");
}

function hideEbayTxnMsg() {
  const { els } = window.__kkExpenses;
  els.ebayTxnMsg?.classList.add("hidden");
}

/** Let users drag-and-drop a CSV straight onto the "eBay Transactions" button.
 *  Opens the modal, pre-loads the file, and auto-parses. */
function wireEbayBtnDrop() {
  const { els } = window.__kkExpenses;
  const btn = els.btnImportEbay;
  if (!btn) return;

  btn.addEventListener("dragover", e => {
    e.preventDefault();
    btn.classList.add("bg-kkpink", "border-kkpink", "text-black");
  });
  btn.addEventListener("dragleave", e => {
    e.preventDefault();
    btn.classList.remove("bg-kkpink", "border-kkpink", "text-black");
  });
  btn.addEventListener("drop", e => {
    e.preventDefault();
    btn.classList.remove("bg-kkpink", "border-kkpink", "text-black");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    openEbayTxnModal();          // open modal first
    setEbayTxnFile(file);        // pre-load the file
    setTimeout(() => parseEbayTxn(), 100); // auto-parse
  });
}

function wireEbayTxnFileDrop() {
  const { els } = window.__kkExpenses;
  if (!els.ebayTxnDropZone || !els.ebayTxnFileInput) return;

  els.ebayTxnDropZone.addEventListener("click", () => els.ebayTxnFileInput.click());
  els.ebayTxnFileInput.addEventListener("change", () => {
    const file = els.ebayTxnFileInput.files?.[0];
    els.ebayTxnFileInput.value = "";
    if (file) setEbayTxnFile(file);
  });

  els.ebayTxnDropZone.addEventListener("dragover", e => {
    e.preventDefault();
    els.ebayTxnDropZone.classList.add("border-black", "bg-gray-50");
  });
  els.ebayTxnDropZone.addEventListener("dragleave", e => {
    e.preventDefault();
    els.ebayTxnDropZone.classList.remove("border-black", "bg-gray-50");
  });
  els.ebayTxnDropZone.addEventListener("drop", e => {
    e.preventDefault();
    els.ebayTxnDropZone.classList.remove("border-black", "bg-gray-50");
    const file = e.dataTransfer?.files?.[0];
    if (file) setEbayTxnFile(file);
  });
}

function setEbayTxnFile(file) {
  const { els } = window.__kkExpenses;
  window.__kkExpenses.ebayTxnFile = file;
  els.ebayTxnFileName.textContent = file.name;
  els.ebayTxnFileName.classList.remove("hidden");
  els.btnParseEbayTxn.disabled = false;
  hideEbayTxnMsg();
}

function escH(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function parseEbayTxn() {
  const { els } = window.__kkExpenses;
  hideEbayTxnMsg();

  const file = window.__kkExpenses.ebayTxnFile;
  if (!file) { showEbayTxnMsg("Select a file first."); return; }

  try {
    showEbayTxnMsg("Parsing…", false);
    const text = await file.text();
    const parsed = parseEbayTransactions(text);

    if (parsed.errors.length) {
      showEbayTxnMsg(parsed.errors.join(" | "));
      return;
    }

    if (!parsed.shippingLabels.length && !parsed.fees.length && !parsed.sellingFees.length) {
      showEbayTxnMsg("No importable transactions found in this CSV.");
      return;
    }

    // Check for existing expenses (dupe detection)
    const allRefs = [
      ...parsed.fees.map(f => f.referenceId || `ebay_fee_${f.date}_${f.amountCents}`),
      ...Object.keys(aggregateSellingFees(parsed.sellingFees)).map(m => `ebay_selling_fees_${m}`),
    ];
    let existingRefs = new Set();
    try {
      existingRefs = await findExistingEbayExpenses(allRefs);
    } catch (err) {
      console.warn("Dupe check failed:", err);
    }

    // Render shipping labels preview
    if (parsed.shippingLabels.length) {
      els.ebayTxnShipWrap.classList.remove("hidden");
      els.ebayTxnShipCount.textContent = `${parsed.shippingLabels.length} labels`;
      els.ebayTxnShipBody.innerHTML = parsed.shippingLabels.map(l => `
        <tr>
          <td class="px-3 py-1.5">${escH(l.date)}</td>
          <td class="px-3 py-1.5 font-mono text-[10px]">${escH(l.orderNumber || "—")}</td>
          <td class="px-3 py-1.5 text-right font-bold">$${(l.costCents / 100).toFixed(2)}</td>
          <td class="px-3 py-1.5 font-mono text-[10px]">${escH(l.tracking || "—")}</td>
        </tr>`).join("");
    } else {
      els.ebayTxnShipWrap.classList.add("hidden");
    }

    // Render fees preview
    let newFeeCount = 0;
    if (parsed.fees.length) {
      els.ebayTxnFeesWrap.classList.remove("hidden");
      els.ebayTxnFeesBody.innerHTML = parsed.fees.map(f => {
        const refId = f.referenceId || `ebay_fee_${f.date}_${f.amountCents}`;
        const isDupe = existingRefs.has(refId);
        if (!isDupe) newFeeCount++;
        return `
          <tr class="${isDupe ? 'bg-amber-50 text-amber-500 line-through' : ''}">
            <td class="px-3 py-1.5">${escH(f.date)}</td>
            <td class="px-3 py-1.5">${escH(f.description)}</td>
            <td class="px-3 py-1.5 text-right font-bold">$${(f.amountCents / 100).toFixed(2)}</td>
            <td class="px-3 py-1.5">${isDupe ? "Already imported" : "New"}</td>
          </tr>`;
      }).join("");
      els.ebayTxnFeesCount.textContent = `${newFeeCount} new / ${parsed.fees.length} total`;
    } else {
      els.ebayTxnFeesWrap.classList.add("hidden");
    }

    // Render selling fees preview (monthly aggregated)
    const monthly = aggregateSellingFees(parsed.sellingFees);
    const monthKeys = Object.keys(monthly).sort();
    let newSellingCount = 0;
    if (monthKeys.length) {
      els.ebayTxnSellingWrap.classList.remove("hidden");
      els.ebayTxnSellingBody.innerHTML = monthKeys.map(m => {
        const agg = monthly[m];
        const refId = `ebay_selling_fees_${m}`;
        const isDupe = existingRefs.has(refId);
        if (!isDupe) newSellingCount++;
        return `
          <tr class="${isDupe ? 'bg-amber-50 text-amber-500 line-through' : ''}">
            <td class="px-3 py-1.5">${escH(m)}</td>
            <td class="px-3 py-1.5">${agg.count} orders</td>
            <td class="px-3 py-1.5 text-right font-bold">$${(agg.cents / 100).toFixed(2)}</td>
          </tr>`;
      }).join("");
      els.ebayTxnSellingCount.textContent = `${newSellingCount} new / ${monthKeys.length} total`;
    } else {
      els.ebayTxnSellingWrap.classList.add("hidden");
    }

    if (existingRefs.size > 0) {
      els.ebayTxnDupeWarning.classList.remove("hidden");
    } else {
      els.ebayTxnDupeWarning.classList.add("hidden");
    }

    els.ebayTxnPreviewWrap.classList.remove("hidden");

    // Store parsed data
    window.__kkExpenses.ebayTxnParsed = parsed;
    window.__kkExpenses.ebayTxnExistingRefs = existingRefs;

    const totalNew = parsed.shippingLabels.length + newFeeCount + newSellingCount;
    els.btnRunEbayTxn.disabled = totalNew === 0;

    if (totalNew === 0) {
      showEbayTxnMsg("Everything is already imported!", false);
    } else {
      showEbayTxnMsg(
        `Ready: ${parsed.shippingLabels.length} shipping labels to update, ` +
        `${newFeeCount + newSellingCount} fee expenses to import.`,
        false
      );
    }
  } catch (err) {
    console.error(err);
    showEbayTxnMsg(err?.message || "Parse failed.");
  }
}

function aggregateSellingFees(sellingFees) {
  const monthly = {};
  for (const sf of sellingFees) {
    const month = sf.date.slice(0, 7);
    if (!monthly[month]) monthly[month] = { cents: 0, count: 0 };
    monthly[month].cents += sf.amountCents;
    monthly[month].count++;
  }
  return monthly;
}

async function runEbayTxnImport() {
  const { els } = window.__kkExpenses;
  const parsed = window.__kkExpenses.ebayTxnParsed;
  const existingRefs = window.__kkExpenses.ebayTxnExistingRefs || new Set();
  if (!parsed) return;

  els.btnRunEbayTxn.disabled = true;
  els.btnParseEbayTxn.disabled = true;

  try {
    const results = [];

    // 1. Update shipping costs on existing orders
    if (parsed.shippingLabels.length) {
      showEbayTxnMsg("Updating order shipping costs…", false);
      const shipResult = await updateOrderShippingCosts(parsed.shippingLabels);
      results.push(`${shipResult.updated} order shipping costs updated`);
    }

    // 2. Import fees as expenses
    if (parsed.fees.length || parsed.sellingFees.length) {
      showEbayTxnMsg("Importing eBay fees as expenses…", false);
      const count = await importEbayExpenses({
        fees: parsed.fees,
        sellingFees: parsed.sellingFees,
        existingRefs,
      });
      results.push(`${count} expense${count === 1 ? "" : "s"} imported`);
    }

    showEbayTxnMsg(`✓ Done! ${results.join(", ")}.`, false);

    // Refresh data
    await Promise.all([
      loadExpenses({ reset: true }),
      refreshKpis()
    ]);

    setTimeout(() => closeEbayTxnModal(), 1500);
  } catch (err) {
    console.error(err);
    showEbayTxnMsg(err?.message || "Import failed.");
    els.btnRunEbayTxn.disabled = false;
  } finally {
    els.btnParseEbayTxn.disabled = false;
  }
}

/* ── GitHub billing modal ────────────────────────── */

function openGHModal() {
  const { els } = window.__kkExpenses;
  els.ghPasteArea.value = "";
  els.ghPreviewWrap.classList.add("hidden");
  els.ghPreviewBody.innerHTML = "";
  els.ghDupeWarning.classList.add("hidden");
  els.btnRunGH.disabled = true;
  hideGHMsg();
  window.__kkExpenses.parsedGH = [];

  els.ghModal.classList.remove("hidden");
  els.ghModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => els.ghPasteArea.focus(), 80);
}

function closeGHModal() {
  const { els } = window.__kkExpenses;
  els.ghModal.classList.add("hidden");
  els.ghModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function showGHMsg(text, isError = true) {
  const { els } = window.__kkExpenses;
  els.ghMsg.textContent = text;
  els.ghMsg.className = `p-3 border-4 text-sm ${isError
    ? "border-red-300 bg-red-50 text-red-700"
    : "border-green-300 bg-green-50 text-green-700"}`;
  els.ghMsg.classList.remove("hidden");
}

function hideGHMsg() {
  const { els } = window.__kkExpenses;
  els.ghMsg?.classList.add("hidden");
}

async function parseGH() {
  const { els } = window.__kkExpenses;
  hideGHMsg();

  const text = els.ghPasteArea.value.trim();
  if (!text) { showGHMsg("Paste billing data first."); return; }

  const parsed = parseGitHubBilling(text);
  if (!parsed.length) {
    showGHMsg("Could not parse any billing entries from the pasted text.");
    return;
  }

  // Dupe check
  let existing = new Set();
  try {
    existing = await findExistingGitHubExpenses(parsed.map(p => p.id));
  } catch (err) {
    console.warn("Dupe check failed:", err);
  }

  let newCount = 0;
  els.ghPreviewBody.innerHTML = parsed.map(e => {
    const isDupe = existing.has(e.id);
    if (!isDupe) newCount++;
    return `
      <tr class="${isDupe ? 'bg-amber-50 text-amber-500 line-through' : ''}">
        <td class="px-3 py-1.5">${escH(e.expense_date)}</td>
        <td class="px-3 py-1.5 font-mono">${escH(e.id)}</td>
        <td class="px-3 py-1.5 text-right font-bold">$${(e.amount_cents / 100).toFixed(2)}</td>
        <td class="px-3 py-1.5">${isDupe ? "Already imported" : escH(e.status)}</td>
      </tr>`;
  }).join("");

  els.ghPreviewWrap.classList.remove("hidden");
  els.ghPreviewCount.textContent = `${newCount} new / ${parsed.length} total`;

  if (existing.size > 0) {
    els.ghDupeWarning.classList.remove("hidden");
  } else {
    els.ghDupeWarning.classList.add("hidden");
  }

  // Store only new entries
  window.__kkExpenses.parsedGH = parsed.filter(e => !existing.has(e.id));
  els.btnRunGH.disabled = window.__kkExpenses.parsedGH.length === 0;

  if (newCount === 0) {
    showGHMsg("All entries are already imported!", false);
  } else {
    showGHMsg(`${newCount} GitHub Copilot expense${newCount === 1 ? "" : "s"} ready to import.`, false);
  }
}

async function runGHImport() {
  const { els } = window.__kkExpenses;
  const entries = window.__kkExpenses.parsedGH || [];
  if (!entries.length) return;

  els.btnRunGH.disabled = true;
  els.btnParseGH.disabled = true;
  showGHMsg(`Importing ${entries.length} expense${entries.length === 1 ? "" : "s"}…`, false);

  try {
    const count = await bulkInsertGitHubExpenses(entries);
    showGHMsg(`✓ Successfully imported ${count} expense${count === 1 ? "" : "s"}!`, false);
    window.__kkExpenses.parsedGH = [];
    els.btnRunGH.disabled = true;

    await Promise.all([
      loadExpenses({ reset: true }),
      refreshKpis()
    ]);

    setTimeout(() => closeGHModal(), 1200);
  } catch (err) {
    console.error(err);
    showGHMsg(err?.message || "Import failed.");
    els.btnRunGH.disabled = false;
  } finally {
    els.btnParseGH.disabled = false;
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

  // eBay Transaction modal
  els.btnImportEbay?.addEventListener("click", () => openEbayTxnModal());
  wireEbayBtnDrop();  // drag-and-drop on the button itself
  els.btnCloseEbayTxn?.addEventListener("click", () => closeEbayTxnModal());
  els.btnCancelEbayTxn?.addEventListener("click", () => closeEbayTxnModal());
  els.ebayTxnBackdrop?.addEventListener("click", () => closeEbayTxnModal());
  els.btnParseEbayTxn?.addEventListener("click", () => parseEbayTxn());
  els.btnRunEbayTxn?.addEventListener("click", () => runEbayTxnImport());
  wireEbayTxnFileDrop();

  // Amazon Transaction modal
  els.btnImportAmazon?.addEventListener("click", () => openAmzTxnModal());
  wireAmzBtnDrop();
  els.btnCloseAmzTxn?.addEventListener("click", () => closeAmzTxnModal());
  els.btnCancelAmzTxn?.addEventListener("click", () => closeAmzTxnModal());
  els.amzTxnBackdrop?.addEventListener("click", () => closeAmzTxnModal());
  els.btnParseAmzTxn?.addEventListener("click", () => parseAmzTxn());
  els.btnRunAmzTxn?.addEventListener("click", () => runAmzTxnImport());
  wireAmzTxnFileDrop();

  // GitHub billing modal
  els.btnImportGitHub?.addEventListener("click", () => openGHModal());
  els.btnCloseGH?.addEventListener("click", () => closeGHModal());
  els.btnCancelGH?.addEventListener("click", () => closeGHModal());
  els.ghModalBackdrop?.addEventListener("click", () => closeGHModal());
  els.btnParseGH?.addEventListener("click", () => parseGH());
  els.btnRunGH?.addEventListener("click", () => runGHImport());

  // ESC to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeImportModal();
      closeEbayTxnModal();
      closeAmzTxnModal();
      closeGHModal();
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
