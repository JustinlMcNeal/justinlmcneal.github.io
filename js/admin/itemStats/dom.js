// /js/admin/itemStats/dom.js
export function getEls() {
  return {
    // KPIs
    kpiRevenue:   document.getElementById("kpiRevenue"),
    kpiUnitsSold: document.getElementById("kpiUnitsSold"),
    kpiTopSeller: document.getElementById("kpiTopSeller"),
    kpiAvgOrder:  document.getElementById("kpiAvgOrder"),

    // filters
    searchItem:    document.getElementById("searchItem"),
    filterRange:   document.getElementById("filterRange"),
    sortBy:        document.getElementById("sortBy"),
    itemCount:     document.getElementById("itemCount"),
    status:        document.getElementById("status"),
    emptyState:    document.getElementById("emptyState"),

    // table
    statsRows:     document.getElementById("statsRows"),
    mobileCards:   document.getElementById("mobileCards"),

    // variant panel
    variantSection: document.getElementById("variantSection"),
    variantTitle:   document.getElementById("variantTitle"),
    variantRows:    document.getElementById("variantRows"),
    btnCloseVariant: document.getElementById("btnCloseVariant"),
  };
}

export function bindUI(els, handlers) {
  // Search (debounced)
  let t = null;
  els.searchItem?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => handlers.onSearch?.(els.searchItem.value.trim()), 300);
  });

  els.filterRange?.addEventListener("change", () => handlers.onRange?.(els.filterRange.value));
  els.sortBy?.addEventListener("change", () => handlers.onSort?.(els.sortBy.value));
  els.btnCloseVariant?.addEventListener("click", () => handlers.onCloseVariant?.());
}
