// /js/admin/customers/dom.js
export function getEls() {
  return {
    // list
    searchCustomer: document.getElementById("searchCustomer"),
    sortBy: document.getElementById("sortBy"),
    customersRows: document.getElementById("customersRows"),
    customerCount: document.getElementById("customerCount"),
    status: document.getElementById("status"),
    btnLoadMore: document.getElementById("btnLoadMore"),
    loadMoreStatus: document.getElementById("loadMoreStatus"),

    // modal
    customerModal: document.getElementById("customerModal"),
    btnCloseCustomer: document.getElementById("btnCloseCustomer"),
    btnCancelCustomer: document.getElementById("btnCancelCustomer"),
    btnSaveCustomer: document.getElementById("btnSaveCustomer"),
    modalCustomerName: document.getElementById("modalCustomerName"),
    modalCustomerEmail: document.getElementById("modalCustomerEmail"),

    modalMsg: document.getElementById("modalMsg") || null, // optional if you add it later

    fFirstName: document.getElementById("fFirstName"),
    fLastName: document.getElementById("fLastName"),
    fEmail: document.getElementById("fEmail"),
    fPhone: document.getElementById("fPhone"),
    fStreet: document.getElementById("fStreet"),
    fCity: document.getElementById("fCity"),
    fState: document.getElementById("fState"),
    fZip: document.getElementById("fZip"),

    customerOrdersRows: document.getElementById("customerOrdersRows"),
  };
}

export function bindUI(els, handlers) {
  // Search (debounced)
  let t = null;
  els.searchCustomer?.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => handlers.onSearch?.(els.searchCustomer.value.trim()), 350);
  });

  // Sort
  els.sortBy?.addEventListener("change", () => {
    handlers.onSort?.(els.sortBy.value);
  });

  // Load more
  els.btnLoadMore?.addEventListener("click", () => handlers.onLoadMore?.());

  // Modal close buttons
  els.btnCloseCustomer?.addEventListener("click", () => handlers.onCloseModal?.());
  els.btnCancelCustomer?.addEventListener("click", () => handlers.onCancelModal?.());

  // Backdrop click
  els.customerModal?.querySelector(".kk-admin-modal-backdrop")?.addEventListener("click", () => {
    handlers.onCloseModal?.();
  });

  // Save
  els.btnSaveCustomer?.addEventListener("click", () => handlers.onSaveModal?.());
}
