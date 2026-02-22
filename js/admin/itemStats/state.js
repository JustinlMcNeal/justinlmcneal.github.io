// /js/admin/itemStats/state.js
export function initItemStatsState() {
  return {
    q: "",
    range: "all",      // all | 7d | 30d | 90d | 6m | 1y
    sortBy: "revenue_desc",
    loading: false,
    rows: [],           // aggregated product stats
    rawLineItems: [],   // raw line items for variant drill-down
    selectedCode: null   // product_id (code) for variant breakdown
  };
}
