// /js/admin/customers/state.js
export function initCustomersState() {
  return {
    q: "",
    sortBy: "last_order",
    limit: 25,
    offset: 0,
    hasMore: true,
    loading: false,
    rows: []
  };
}
