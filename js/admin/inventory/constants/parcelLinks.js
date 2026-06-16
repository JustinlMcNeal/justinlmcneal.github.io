/**
 * Deep links from Inventory admin to Parcel Imports (Phase 5).
 */

export const PARCEL_IMPORTS_PAGE = "/pages/admin/parcelImports.html";

/**
 * @param {{ tab?: string, status?: string, received?: string, expense?: string, search?: string }} [params]
 */
export function parcelImportsUrl(params = {}) {
  const q = new URLSearchParams();
  if (params.tab) q.set("tab", params.tab);
  if (params.status) q.set("status", params.status);
  if (params.received) q.set("received", params.received);
  if (params.expense) q.set("expense", params.expense);
  if (params.search) q.set("search", params.search);
  const qs = q.toString();
  return qs ? `${PARCEL_IMPORTS_PAGE}?${qs}` : PARCEL_IMPORTS_PAGE;
}

/** Approved imports awaiting inventory receive. */
export const RECEIVE_STOCK_URL = parcelImportsUrl({
  tab: "history",
  status: "approved",
  received: "not_received",
});

/** Approved imports with mapping gaps (same history filter; mapping done per import). */
export const PARCEL_MAPPING_URL = parcelImportsUrl({
  tab: "history",
  status: "approved",
  received: "not_received",
});

/** History of received parcel imports. */
export const VIEW_PARCEL_RECEIVES_URL = parcelImportsUrl({
  tab: "history",
  received: "received",
});

export const RECEIVE_STOCK_TOOLTIP =
  "Receive stock through Parcel Imports. Approved parcel rows write to the stock ledger.";
