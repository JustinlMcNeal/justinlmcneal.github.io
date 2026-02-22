// /js/admin/expenses/modal.js

export function openModal(els, { id = null, row = null } = {}) {
  // Reset form
  els.fDate.value = "";
  els.fCategory.value = "";
  els.fDescription.value = "";
  els.fAmount.value = "";
  els.fVendor.value = "";
  els.fNotes.value = "";
  hideMsg(els);

  if (row) {
    // Edit mode
    els.modalTitle.textContent = "Edit Expense";
    els.fDate.value = row.expense_date || "";
    els.fCategory.value = row.category || "";
    els.fDescription.value = row.description || "";
    els.fAmount.value = row.amount_cents ? (row.amount_cents / 100).toFixed(2) : "";
    els.fVendor.value = row.vendor || "";
    els.fNotes.value = row.notes || "";
    els.btnDeleteExpense.classList.remove("hidden");
  } else {
    // Add mode — default date to today
    els.modalTitle.textContent = "Add Expense";
    els.fDate.value = new Date().toISOString().slice(0, 10);
    els.btnDeleteExpense.classList.add("hidden");
  }

  els.expenseModal.classList.remove("hidden");
  els.expenseModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  // Focus date field
  setTimeout(() => els.fDate.focus(), 80);
}

export function closeModal(els) {
  els.expenseModal.classList.add("hidden");
  els.expenseModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  hideMsg(els);
}

export function readForm(els) {
  const dollars = parseFloat(els.fAmount.value) || 0;
  return {
    expense_date: els.fDate.value || null,
    category: els.fCategory.value || null,
    description: els.fDescription.value.trim() || null,
    amount_cents: Math.round(dollars * 100),
    vendor: els.fVendor.value.trim() || null,
    notes: els.fNotes.value.trim() || null
  };
}

export function showMsg(els, text, isError = true) {
  if (!els.modalMsg) return;
  els.modalMsg.textContent = text;
  els.modalMsg.className = `p-3 border-4 text-sm ${isError
    ? "border-red-300 bg-red-50 text-red-700"
    : "border-green-300 bg-green-50 text-green-700"}`;
  els.modalMsg.classList.remove("hidden");
}

export function hideMsg(els) {
  if (!els.modalMsg) return;
  els.modalMsg.classList.add("hidden");
  els.modalMsg.textContent = "";
}

export function setBusy(els, busy, text) {
  els.btnSaveExpense.disabled = busy;
  els.btnDeleteExpense.disabled = busy;
  if (text) showMsg(els, text, false);
}
