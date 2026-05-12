// /js/admin/lineItemsOrders/dom.js

export const els = {
  // controls
  searchInput: document.getElementById("searchInput"),
  btnSearchClear: document.getElementById("btnSearchClear"),
  statusFilter: document.getElementById("statusFilter"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnExportShipReady: document.getElementById("btnExportShipReady"),

  // Amazon import elements
  btnImportAmazon: document.getElementById("btnImportAmazon"),
  amazonPreviewPanel: document.getElementById("amazonPreviewPanel"),
  amzFileName: document.getElementById("amzFileName"),
  amzTotalRows: document.getElementById("amzTotalRows"),
  amzValidCount: document.getElementById("amzValidCount"),
  amzCancelledWrap: document.getElementById("amzCancelledWrap"),
  amzCancelledCount: document.getElementById("amzCancelledCount"),
  amzConfirmBtn: document.getElementById("amzConfirmBtn"),
  amzCancelBtn: document.getElementById("amzCancelBtn"),
  amazonResultPanel: document.getElementById("amazonResultPanel"),
  amzOrdersCount: document.getElementById("amzOrdersCount"),
  amzLineItemsCount: document.getElementById("amzLineItemsCount"),
  amzRevenue: document.getElementById("amzRevenue"),
  amzSkippedCount: document.getElementById("amzSkippedCount"),
  amzBreakdownWrap: document.getElementById("amzBreakdownWrap"),
  amzUnmappedWrap: document.getElementById("amzUnmappedWrap"),
  amzResultClose: document.getElementById("amzResultClose"),

  // status + count
  status: document.getElementById("status"),
  countLabel: document.getElementById("countLabel"),

  // table
  ordersRows: document.getElementById("ordersRows"),

  // load more
  btnLoadMore: document.getElementById("btnLoadMore"),
  loadMoreStatus: document.getElementById("loadMoreStatus"),

  // kpis (optional)
  kpiOrders: document.getElementById("kpiOrders"),
  kpiRevenue: document.getElementById("kpiRevenue"),
  kpiProfit: document.getElementById("kpiProfit"),
  kpiUnfulfilled: document.getElementById("kpiUnfulfilled"),
  kpiRefunded: document.getElementById("kpiRefunded"),

  // review filter
  reviewFilter: document.getElementById("reviewFilter"),

  // Export dropdown
  btnExportDropdown: document.getElementById("btnExportDropdown"),
  exportDropdownPanel: document.getElementById("exportDropdownPanel"),

  // Filter toggle + bottom sheet
  btnFilterToggle: document.getElementById("btnFilterToggle"),
  filterSheet: document.getElementById("filterSheet"),

  // Amazon Import modal
  amazonImportModal: document.getElementById("amazonImportModal"),

  // Order Workspace
  orderWorkspace: document.getElementById("orderWorkspace"),
  wsBody: document.getElementById("wsBody"),
  wsFooter: document.getElementById("wsFooter"),
  btnWsClose: document.getElementById("btnWsClose"),
  btnWsSave: document.getElementById("btnWsSave"),
  btnWsCancel: document.getElementById("btnWsCancel"),
};

export function wireDomHelpers() {
  const required = [
    "searchInput",
    "statusFilter",
    "dateFrom",
    "dateTo",
    "btnRefresh",
    "btnExportShipReady",
    "status",
    "countLabel",
    "ordersRows",
    "btnLoadMore",
    "loadMoreStatus",
  ];

  const missing = required.filter((k) => !els[k]);
  if (missing.length) console.error("[lineItemsOrders] Missing DOM ids:", missing);

  // Wire close/cancel for Amazon import panels
  if (els.amzResultClose) {
    els.amzResultClose.addEventListener("click", () => {
      if (els.amazonResultPanel) els.amazonResultPanel.classList.add("hidden");
    });
  }
  if (els.amzCancelBtn) {
    els.amzCancelBtn.addEventListener("click", () => {
      if (els.amazonPreviewPanel) els.amazonPreviewPanel.classList.add("hidden");
      setStatus("Amazon import canceled.");
    });
  }
}

export function setStatus(msg, isError = false) {
  if (!els.status) return;
  els.status.textContent = msg || "";
  els.status.style.opacity = msg ? "1" : "0.7";
  els.status.style.color = isError ? "crimson" : "";
}

export function setCountLabel(loadedCount, totalCount) {
  if (!els.countLabel) return;
  els.countLabel.textContent =
    totalCount == null ? `${loadedCount} rows` : `${loadedCount} / ${totalCount} rows`;
}

export function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function moneyFromCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

export function gramsToOz(g) {
  const n = Number(g);
  if (!Number.isFinite(n)) return null;
  return n / 28.349523125;
}

export function formatOz(oz) {
  if (oz == null) return "—";
  const n = Number(oz);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)} oz`;
}

export function formatDateShort(iso) {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit" });
}

export function isoToLocalDatetimeValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localDatetimeValueToIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function dollarsToCents(v) {
  const n = Number(v);
  if (!Number.isNaN(n) && Number.isFinite(n)) return Math.round(n * 100);
  return null;
}

export function centsToDollars(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
}
