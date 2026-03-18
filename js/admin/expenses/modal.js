// /js/admin/expenses/modal.js

const IRS_RATE_2025 = 0.70; // $0.70 per mile

function toggleMileageFields(els, show) {
  if (!els.mileageFields) return;
  els.mileageFields.classList.toggle("hidden", !show);
  if (show) {
    // Default rate if empty
    if (!els.fMileageRate.value) {
      els.fMileageRate.value = IRS_RATE_2025.toFixed(2);
    }
    // Make amount read-only for mileage
    els.fAmount.readOnly = true;
    els.fAmount.classList.add("bg-gray-100", "cursor-not-allowed");
  } else {
    els.fAmount.readOnly = false;
    els.fAmount.classList.remove("bg-gray-100", "cursor-not-allowed");
    els.fMiles.value = "";
    els.fMileageRate.value = "";
  }
}

function recalcMileage(els) {
  const miles = parseFloat(els.fMiles.value) || 0;
  const rate = parseFloat(els.fMileageRate.value) || 0;
  const total = miles * rate;
  els.fAmount.value = total > 0 ? total.toFixed(2) : "";
  if (els.mileageCalcPreview) {
    els.mileageCalcPreview.textContent = "$" + total.toFixed(2);
  }
}

export function setupMileageListeners(els) {
  // Toggle mileage section when category changes
  els.fCategory?.addEventListener("change", () => {
    const isMileage = els.fCategory.value === "Mileage";
    toggleMileageFields(els, isMileage);
    if (isMileage) recalcMileage(els);
  });

  // Live recalc as user types miles or rate
  els.fMiles?.addEventListener("input", () => recalcMileage(els));
  els.fMileageRate?.addEventListener("input", () => recalcMileage(els));
}

export function openModal(els, { id = null, row = null } = {}) {
  // Reset form
  els.fDate.value = "";
  els.fCategory.value = "";
  els.fDescription.value = "";
  els.fAmount.value = "";
  els.fVendor.value = "";
  els.fNotes.value = "";
  els.fMiles.value = "";
  els.fMileageRate.value = "";
  toggleMileageFields(els, false);
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

    // Mileage data
    if (row.category === "Mileage" && row.miles) {
      els.fMiles.value = row.miles;
      els.fMileageRate.value = row.mileage_rate ? (row.mileage_rate / 100).toFixed(2) : IRS_RATE_2025.toFixed(2);
      toggleMileageFields(els, true);
      recalcMileage(els);
    }

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
  const isMileage = els.fCategory.value === "Mileage";
  const miles = parseFloat(els.fMiles.value) || 0;
  const ratePerMile = parseFloat(els.fMileageRate.value) || 0;
  const dollars = isMileage ? (miles * ratePerMile) : (parseFloat(els.fAmount.value) || 0);

  return {
    expense_date: els.fDate.value || null,
    category: els.fCategory.value || null,
    description: els.fDescription.value.trim() || null,
    amount_cents: Math.round(dollars * 100),
    vendor: els.fVendor.value.trim() || null,
    notes: els.fNotes.value.trim() || null,
    miles: isMileage && miles > 0 ? miles : null,
    mileage_rate: isMileage && ratePerMile > 0 ? Math.round(ratePerMile * 100) : null
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
