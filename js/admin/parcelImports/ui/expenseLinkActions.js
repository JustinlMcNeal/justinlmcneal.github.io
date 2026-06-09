/** Expense create/link UI for approved parcel imports (Phase 9). */

import {
  computeParcelExpenseAmountCents,
  createExpenseFromParcelImport,
  getLinkedExpense,
  linkExpenseToParcelImport,
} from "../api/expenseLinkApi.js";
import { fetchParcelImportHeader } from "../api/parcelImportsApi.js";
import { getDom } from "../dom.js";
import {
  getState,
  isImportApproved,
  setExpenseId,
  setExpenseLinkStatus,
  setLinkedExpenseSummary,
} from "../state.js";
import { refreshGlobalKpis } from "./stats.js";
import { updateInventoryReceiveUi } from "./inventoryReceiveActions.js";

let refreshHistoryFn = async () => {};

/** @param {{ refreshHistory?: () => Promise<void> }} [opts] */
export function initExpenseLinkActions(opts = {}) {
  refreshHistoryFn = opts.refreshHistory ?? refreshHistoryFn;
  const { createExpenseBtns, linkExpenseBtn } = getDom();

  createExpenseBtns?.forEach((btn) => {
    btn.addEventListener("click", () => {
      void handleCreateExpense();
    });
  });

  linkExpenseBtn?.addEventListener("click", () => {
    void handleLinkExpense();
  });

  updateExpenseLinkUi();
}

export function updateExpenseLinkUi() {
  const state = getState();
  const { createExpenseBtns, linkExpenseBtn, linkExpenseInput, expenseStatusEl } =
    getDom();
  const blockReason = getExpenseBlockReason(state);
  const linked = !!state.expenseId;

  if (expenseStatusEl) {
    if (linked && state.linkedExpenseSummary) {
      const cents = state.linkedExpenseSummary.amount_cents ?? 0;
      expenseStatusEl.textContent = `Expense linked — $${(cents / 100).toFixed(2)} (${state.linkedExpenseSummary.description || state.expenseId})`;
      expenseStatusEl.classList.remove("text-red-700", "text-gray-500");
      expenseStatusEl.classList.add("text-green-700");
    } else if (state.expenseLinkMessage) {
      expenseStatusEl.textContent = state.expenseLinkMessage;
      expenseStatusEl.classList.toggle(
        "text-red-700",
        state.expenseLinkStatus === "error",
      );
      expenseStatusEl.classList.toggle(
        "text-green-700",
        state.expenseLinkStatus === "linked",
      );
      expenseStatusEl.classList.toggle(
        "text-gray-500",
        state.expenseLinkStatus === "idle",
      );
    } else if (blockReason) {
      expenseStatusEl.textContent = blockReason;
      expenseStatusEl.classList.remove("text-green-700", "text-red-700");
      expenseStatusEl.classList.add("text-gray-500");
    } else {
      expenseStatusEl.textContent =
        "Approved import ready — create or link an Inventory expense.";
      expenseStatusEl.classList.remove("text-red-700", "text-green-700");
      expenseStatusEl.classList.add("text-gray-500");
    }
  }

  const canAct =
    state.sessionReady &&
    state.adminOk &&
    state.currentImportId &&
    isImportApproved(state) &&
    !linked &&
    !blockReason;

  createExpenseBtns?.forEach((btn) => {
    btn.disabled = !canAct || state.expenseLinkStatus === "linking";
    btn.title = linked
      ? "Expense already linked"
      : blockReason || "Create Inventory expense from parcel charges";
  });

  if (linkExpenseBtn) {
    linkExpenseBtn.disabled = !canAct || state.expenseLinkStatus === "linking";
    linkExpenseBtn.title = linked
      ? "Expense already linked"
      : blockReason || "Link an existing expense by ID";
  }

  if (linkExpenseInput) {
    linkExpenseInput.disabled = !canAct || linked;
  }
}

/** @param {object} state */
export function getExpenseBlockReason(state) {
  if (!state.sessionReady || !state.adminOk) {
    return "Admin session required.";
  }
  if (!state.currentImportId) {
    return "Save and approve an import first.";
  }
  if (!isImportApproved(state)) {
    return "Approve the import before linking expense.";
  }
  if (state.expenseId) {
    return "Expense already linked.";
  }

  const headerLike = {
    usd_equivalent: state.overrides?.usdEquivalent ?? state.parcel?.usdEquivalent,
    actual_total_charge_cny:
      state.overrides?.totalParcelChargeCny ?? state.parcel?.totalParcelChargeCny,
    effective_fx_rate:
      state.overrides?.effectiveFxRate ?? state.parcel?.effectiveFxRate,
  };

  const amount = computeParcelExpenseAmountCents(headerLike);
  if (!amount || amount <= 0) {
    return "Missing FX/USD amount.";
  }

  return null;
}

export async function hydrateExpenseLinkFromHeader(importId = getState().currentImportId) {
  if (!importId || !getState().sessionReady) return;

  try {
    const header = await fetchParcelImportHeader(importId);
    setExpenseId(header.expense_id ?? null);

    if (header.expense_id) {
      const expense = await getLinkedExpense(header.expense_id);
      setLinkedExpenseSummary(expense);
      setExpenseLinkStatus("linked", "Expense linked.");
    } else {
      setLinkedExpenseSummary(null);
      setExpenseLinkStatus("idle", "");
    }
  } catch (err) {
    console.warn("[parcelImports] expense hydrate failed", err);
  } finally {
    updateExpenseLinkUi();
    updateInventoryReceiveUi();
  }
}

export async function handleCreateExpense() {
  const state = getState();
  const blockReason = getExpenseBlockReason(state);

  if (blockReason) {
    setExpenseLinkStatus("error", blockReason);
    updateExpenseLinkUi();
    return;
  }

  setExpenseLinkStatus("linking", "Creating linked expense…");
  updateExpenseLinkUi();

  try {
    const { expense } = await createExpenseFromParcelImport(state.currentImportId);
    setExpenseId(expense.id);
    setLinkedExpenseSummary(expense);
    setExpenseLinkStatus(
      "linked",
      `Expense created — $${((expense.amount_cents ?? 0) / 100).toFixed(2)}`,
    );
    await refreshHistoryFn();
    await refreshGlobalKpis();
  } catch (err) {
    console.error("[parcelImports] create expense failed", err);
    setExpenseLinkStatus("error", err?.message || "Create expense failed");
  } finally {
    updateExpenseLinkUi();
    updateInventoryReceiveUi();
  }
}

export async function handleLinkExpense() {
  const state = getState();
  const { linkExpenseInput } = getDom();
  const blockReason = getExpenseBlockReason(state);
  const expenseId = linkExpenseInput?.value?.trim();

  if (blockReason) {
    setExpenseLinkStatus("error", blockReason);
    updateExpenseLinkUi();
    return;
  }
  if (!expenseId) {
    setExpenseLinkStatus("error", "Enter an expense ID to link.");
    updateExpenseLinkUi();
    return;
  }

  setExpenseLinkStatus("linking", "Linking expense…");
  updateExpenseLinkUi();

  try {
    const { expense } = await linkExpenseToParcelImport(
      state.currentImportId,
      expenseId,
    );
    setExpenseId(expense.id);
    setLinkedExpenseSummary(expense);
    setExpenseLinkStatus("linked", "Expense linked.");
    await refreshHistoryFn();
    await refreshGlobalKpis();
  } catch (err) {
    console.error("[parcelImports] link expense failed", err);
    setExpenseLinkStatus("error", err?.message || "Link expense failed");
  } finally {
    updateExpenseLinkUi();
    updateInventoryReceiveUi();
  }
}
