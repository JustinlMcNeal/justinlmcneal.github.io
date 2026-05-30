import { qs, show, hide } from "./dom.js";
import { computeAmazonStats, countStaleListings, fetchAmazonListings } from "./api.js";
import { countPriceMismatches } from "./listingPriceMismatch.js";
import { countInventoryMismatches } from "./listingInventoryMismatch.js";
import { countListingHealthIssues } from "./listingHealth.js";
import {
  renderLiveListings,
  updateListingsCounts,
  updatePaginationControls,
  updateStatsCards,
} from "./renderListings.js";
import {
  defaultListingsQuery,
  filterListings,
  paginateListings,
  sortListings,
} from "./listingsQuery.js";
import { showAmazonNotification } from "./notifications.js";

function hideListingStatePanels() {
  [
    "#amazonStateLoading",
    "#amazonStateEmpty",
    "#amazonStateError",
    "#amazonStateNoResults",
    "#amazonStateDisconnected",
  ].forEach((selector) => hide(qs(selector)));
}

function showListingState(id) {
  hideListingStatePanels();
  show(qs(id));
}

function setListingsVisible(visible) {
  const table = qs("#amazonTableSection");
  const mobile = qs("#amazonMobileCards");
  const pagination = qs("#amazonPagination");
  if (table) table.classList.toggle("hidden", !visible);
  if (mobile) mobile.classList.toggle("hidden", !visible);
  if (pagination) pagination.classList.toggle("hidden", !visible);
}

/**
 * @param {{ isConnected?: () => boolean, afterRender?: () => void, onRefresh?: () => void }} [deps]
 */
export function initAmazonLiveListings(deps = {}) {
  /** @type {Array<Record<string, unknown>>} */
  let allRows = [];
  /** @type {ReturnType<typeof defaultListingsQuery>} */
  let queryState = defaultListingsQuery();

  // Drop Phase 1 mock markup immediately (before async Supabase fetch).
  renderLiveListings([], { afterRender: deps.afterRender });
  updateListingsCounts({
    total: 0,
    page: paginateListings([], 1, queryState.pageSize),
  });
  updateStatsCards({ total: 0, active: 0, lowStock: 0, issues: 0 });
  setListingsVisible(false);
  showListingState("#amazonStateLoading");

  function getFilteredRows() {
    return sortListings(filterListings(allRows, queryState), queryState.sort);
  }

  function applyQuery() {
    const filtered = getFilteredRows();
    const pageResult = paginateListings(filtered, queryState.page, queryState.pageSize);

    if (allRows.length === 0) {
      renderLiveListings([], { afterRender: deps.afterRender });
      updateListingsCounts({
        total: 0,
        staleCount: 0,
        priceMismatchCount: 0,
        inventoryMismatchCount: 0,
        listingHealthIssueCount: 0,
        page: pageResult,
      });
      updatePaginationControls(pageResult);
      return pageResult;
    }

    if (filtered.length === 0) {
      renderLiveListings([], { afterRender: deps.afterRender });
      updateListingsCounts({
        total: allRows.length,
        filteredTotal: 0,
        staleCount: countStaleListings(allRows),
        priceMismatchCount: countPriceMismatches(allRows),
        inventoryMismatchCount: countInventoryMismatches(allRows),
        listingHealthIssueCount: countListingHealthIssues(allRows),
        page: pageResult,
      });
      updatePaginationControls(pageResult);
      setListingsVisible(false);
      showListingState("#amazonStateNoResults");
      queryState.page = pageResult.page;
      return pageResult;
    }

    renderLiveListings(pageResult.rows, { afterRender: deps.afterRender });
    updateListingsCounts({
      total: allRows.length,
      filteredTotal: filtered.length,
      staleCount: countStaleListings(allRows),
      priceMismatchCount: countPriceMismatches(allRows),
      inventoryMismatchCount: countInventoryMismatches(allRows),
      listingHealthIssueCount: countListingHealthIssues(allRows),
      page: pageResult,
    });
    updatePaginationControls(pageResult);
    hideListingStatePanels();
    setListingsVisible(true);
    queryState.page = pageResult.page;
    return pageResult;
  }

  async function refresh() {
    hideListingStatePanels();
    deps.onRefresh?.();

    try {
      allRows = await fetchAmazonListings({ limit: 500 });
      updateStatsCards(computeAmazonStats(allRows));
      queryState.page = 1;

      if (allRows.length === 0) {
        renderLiveListings([], { afterRender: deps.afterRender });
        updateListingsCounts({
          total: 0,
          staleCount: 0,
          priceMismatchCount: 0,
          inventoryMismatchCount: 0,
          listingHealthIssueCount: 0,
          page: paginateListings([], 1, queryState.pageSize),
        });
        updatePaginationControls(paginateListings([], 1, queryState.pageSize));
        setListingsVisible(false);
        if (deps.isConnected?.()) {
          showListingState("#amazonStateEmpty");
        } else {
          showListingState("#amazonStateDisconnected");
        }
        return allRows;
      }

      applyQuery();
      return allRows;
    } catch {
      allRows = [];
      renderLiveListings([], { afterRender: deps.afterRender });
      updateListingsCounts({
        total: 0,
        staleCount: 0,
        priceMismatchCount: 0,
        inventoryMismatchCount: 0,
        listingHealthIssueCount: 0,
        page: paginateListings([], 1, queryState.pageSize),
      });
      updatePaginationControls(paginateListings([], 1, queryState.pageSize));
      updateStatsCards(computeAmazonStats([]));
      setListingsVisible(false);
      showListingState("#amazonStateError");
      showAmazonNotification("Could not load Amazon listings.", { tone: "error" });
      return [];
    }
  }

  refresh().catch(() => {});

  return {
    refresh,
    getRows: () => allRows,
    getRowById: (listingId) =>
      allRows.find((row) => String(row.amazon_listing_id) === String(listingId)) || null,
    getFilteredRows,
    getQuery: () => ({ ...queryState }),
    setQuery: (patch) => {
      queryState = { ...queryState, ...patch };
    },
    applyQuery,
  };
}
