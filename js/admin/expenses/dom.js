// /js/admin/expenses/dom.js
export function getEls() {
  return {
    // KPI
    kpiTotalSpent: document.getElementById("kpiTotalSpent"),
    kpiThisMonth: document.getElementById("kpiThisMonth"),
    kpiCount: document.getElementById("kpiCount"),
    kpiTopCategory: document.getElementById("kpiTopCategory"),

    // list
    searchExpense: document.getElementById("searchExpense"),
    filterCategory: document.getElementById("filterCategory"),
    sortBy: document.getElementById("sortBy"),
    expensesRows: document.getElementById("expensesRows"),
    mobileExpenseCards: document.getElementById("mobileExpenseCards"),
    expenseCount: document.getElementById("expenseCount"),
    status: document.getElementById("status"),
    btnLoadMore: document.getElementById("btnLoadMore"),
    loadMoreStatus: document.getElementById("loadMoreStatus"),
    btnAddExpense: document.getElementById("btnAddExpense"),
    emptyState: document.getElementById("emptyState"),

    // modal
    expenseModal: document.getElementById("expenseModal"),
    modalTitle: document.getElementById("modalTitle"),
    modalMsg: document.getElementById("modalMsg"),
    btnCloseExpense: document.getElementById("btnCloseExpense"),
    btnCancelExpense: document.getElementById("btnCancelExpense"),
    btnSaveExpense: document.getElementById("btnSaveExpense"),
    btnDeleteExpense: document.getElementById("btnDeleteExpense"),

    fDate: document.getElementById("fDate"),
    fCategory: document.getElementById("fCategory"),
    fDescription: document.getElementById("fDescription"),
    fAmount: document.getElementById("fAmount"),
    fVendor: document.getElementById("fVendor"),
    fNotes: document.getElementById("fNotes"),

    // mileage
    mileageFields: document.getElementById("mileageFields"),
    fMiles: document.getElementById("fMiles"),
    fMileageRate: document.getElementById("fMileageRate"),
    mileageCalcPreview: document.getElementById("mileageCalcPreview"),
    kpiTotalMiles: document.getElementById("kpiTotalMiles"),

    // import modal
    btnImportInvoices: document.getElementById("btnImportInvoices"),
    importModal: document.getElementById("importModal"),
    btnCloseImport: document.getElementById("btnCloseImport"),
    btnCancelImport: document.getElementById("btnCancelImport"),
    btnParseInvoices: document.getElementById("btnParseInvoices"),
    btnRunImport: document.getElementById("btnRunImport"),
    importVendor: document.getElementById("importVendor"),
    importPasteArea: document.getElementById("importPasteArea"),
    importPreviewWrap: document.getElementById("importPreviewWrap"),
    importPreviewBody: document.getElementById("importPreviewBody"),
    importPreviewCount: document.getElementById("importPreviewCount"),
    importDupeWarning: document.getElementById("importDupeWarning"),
    importMsg: document.getElementById("importMsg"),
  };
}

export function bindUI(els, handlers) {
  // Search (debounced)
  let t = null;
  els.searchExpense?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => handlers.onSearch?.(els.searchExpense.value.trim()), 350);
  });

  // Category filter
  els.filterCategory?.addEventListener("change", () => {
    handlers.onFilterCategory?.(els.filterCategory.value);
  });

  // Sort
  els.sortBy?.addEventListener("change", () => {
    handlers.onSort?.(els.sortBy.value);
  });

  // Load more
  els.btnLoadMore?.addEventListener("click", () => handlers.onLoadMore?.());

  // Add new
  els.btnAddExpense?.addEventListener("click", () => handlers.onAdd?.());

  // Modal buttons
  els.btnCloseExpense?.addEventListener("click", () => handlers.onCloseModal?.());
  els.btnCancelExpense?.addEventListener("click", () => handlers.onCloseModal?.());
  els.btnSaveExpense?.addEventListener("click", () => handlers.onSave?.());
  els.btnDeleteExpense?.addEventListener("click", () => handlers.onDelete?.());
}
