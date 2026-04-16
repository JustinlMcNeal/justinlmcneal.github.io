// /js/admin/expenses/state.js
export function initExpensesState() {
  return {
    q: "",
    category: "",
    vendor: "",
    dateFrom: "",
    dateTo: "",
    sortBy: "date_desc",
    limit: 50,
    offset: 0,
    hasMore: true,
    loading: false,
    rows: [],
    editingId: null   // null = adding new, uuid = editing existing
  };
}
