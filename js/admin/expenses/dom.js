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

    // eBay transaction modal
    btnImportEbay: document.getElementById("btnImportEbay"),
    ebayTxnModal: document.getElementById("ebayTxnModal"),
    ebayTxnBackdrop: document.getElementById("ebayTxnBackdrop"),
    btnCloseEbayTxn: document.getElementById("btnCloseEbayTxn"),
    btnCancelEbayTxn: document.getElementById("btnCancelEbayTxn"),
    btnParseEbayTxn: document.getElementById("btnParseEbayTxn"),
    btnRunEbayTxn: document.getElementById("btnRunEbayTxn"),
    ebayTxnMsg: document.getElementById("ebayTxnMsg"),
    ebayTxnDropZone: document.getElementById("ebayTxnDropZone"),
    ebayTxnFileInput: document.getElementById("ebayTxnFileInput"),
    ebayTxnFileName: document.getElementById("ebayTxnFileName"),
    ebayTxnPreviewWrap: document.getElementById("ebayTxnPreviewWrap"),
    ebayTxnShipWrap: document.getElementById("ebayTxnShipWrap"),
    ebayTxnShipCount: document.getElementById("ebayTxnShipCount"),
    ebayTxnShipBody: document.getElementById("ebayTxnShipBody"),
    ebayTxnFeesWrap: document.getElementById("ebayTxnFeesWrap"),
    ebayTxnFeesCount: document.getElementById("ebayTxnFeesCount"),
    ebayTxnFeesBody: document.getElementById("ebayTxnFeesBody"),
    ebayTxnSellingWrap: document.getElementById("ebayTxnSellingWrap"),
    ebayTxnSellingCount: document.getElementById("ebayTxnSellingCount"),
    ebayTxnSellingBody: document.getElementById("ebayTxnSellingBody"),
    ebayTxnDupeWarning: document.getElementById("ebayTxnDupeWarning"),

    // Amazon transaction modal
    btnImportAmazon: document.getElementById("btnImportAmazon"),
    amzTxnModal: document.getElementById("amzTxnModal"),
    amzTxnBackdrop: document.getElementById("amzTxnBackdrop"),
    btnCloseAmzTxn: document.getElementById("btnCloseAmzTxn"),
    btnCancelAmzTxn: document.getElementById("btnCancelAmzTxn"),
    btnParseAmzTxn: document.getElementById("btnParseAmzTxn"),
    btnRunAmzTxn: document.getElementById("btnRunAmzTxn"),
    amzTxnMsg: document.getElementById("amzTxnMsg"),
    amzTxnDropZone: document.getElementById("amzTxnDropZone"),
    amzTxnFileInput: document.getElementById("amzTxnFileInput"),
    amzTxnFileName: document.getElementById("amzTxnFileName"),
    amzTxnPreviewWrap: document.getElementById("amzTxnPreviewWrap"),
    amzTxnShipWrap: document.getElementById("amzTxnShipWrap"),
    amzTxnShipCount: document.getElementById("amzTxnShipCount"),
    amzTxnShipBody: document.getElementById("amzTxnShipBody"),
    amzTxnSubWrap: document.getElementById("amzTxnSubWrap"),
    amzTxnSubCount: document.getElementById("amzTxnSubCount"),
    amzTxnSubBody: document.getElementById("amzTxnSubBody"),
    amzTxnFeesWrap: document.getElementById("amzTxnFeesWrap"),
    amzTxnFeesCount: document.getElementById("amzTxnFeesCount"),
    amzTxnFeesBody: document.getElementById("amzTxnFeesBody"),
    amzTxnDupeWarning: document.getElementById("amzTxnDupeWarning"),

    // GitHub billing modal
    btnImportGitHub: document.getElementById("btnImportGitHub"),
    ghModal: document.getElementById("ghModal"),
    ghModalBackdrop: document.getElementById("ghModalBackdrop"),
    btnCloseGH: document.getElementById("btnCloseGH"),
    btnCancelGH: document.getElementById("btnCancelGH"),
    btnParseGH: document.getElementById("btnParseGH"),
    btnRunGH: document.getElementById("btnRunGH"),
    ghMsg: document.getElementById("ghMsg"),
    ghPasteArea: document.getElementById("ghPasteArea"),
    ghPreviewWrap: document.getElementById("ghPreviewWrap"),
    ghPreviewBody: document.getElementById("ghPreviewBody"),
    ghPreviewCount: document.getElementById("ghPreviewCount"),
    ghDupeWarning: document.getElementById("ghDupeWarning"),
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
