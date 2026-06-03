import { qs } from "./dom.js";
import { downloadListingsCsv } from "./listingsExport.js";
import { showAmazonNotification } from "./notifications.js";

function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * @param {{
 *   setQuery: (patch: Record<string, unknown>) => void,
 *   applyQuery: () => unknown,
 *   getFilteredRows: () => Array<Record<string, unknown>>,
 *   getQuery: () => Record<string, unknown>,
 * }} liveListings
 */
export function initAmazonListingsToolbar(liveListings) {
  const searchInput = qs("#amazonSearchInput");
  const statusFilter = qs("#amazonStatusFilter");
  const categoryFilter = qs("#amazonCategoryFilter");
  const marketplaceFilter = qs("#amazonMarketplaceFilter");
  const inventoryFilter = qs("#amazonInventoryFilter");
  const priceCompareFilter = qs("#amazonPriceCompareFilter");
  const inventoryCompareFilter = qs("#amazonInventoryCompareFilter");
  const healthFilter = qs("#amazonHealthFilter");
  const fulfillmentFilter = qs("#amazonFulfillmentFilter");
  const sortFilter = qs("#amazonSortFilter");
  const rowsPerPage = qs("#amazonRowsPerPage");
  const prevBtn = qs("#listings-prev-page");
  const nextBtn = qs("#listings-next-page");

  function readFiltersFromDom() {
    return {
      search: searchInput instanceof HTMLInputElement ? searchInput.value : "",
      status: statusFilter instanceof HTMLSelectElement ? statusFilter.value : "",
      category: categoryFilter instanceof HTMLSelectElement ? categoryFilter.value : "",
      marketplace: marketplaceFilter instanceof HTMLSelectElement ? marketplaceFilter.value : "",
      inventory: inventoryFilter instanceof HTMLSelectElement ? inventoryFilter.value : "",
      priceCompare: priceCompareFilter instanceof HTMLSelectElement ? priceCompareFilter.value : "",
      inventoryCompare: inventoryCompareFilter instanceof HTMLSelectElement ? inventoryCompareFilter.value : "",
      health: healthFilter instanceof HTMLSelectElement ? healthFilter.value : "",
      fulfillment: fulfillmentFilter instanceof HTMLSelectElement ? fulfillmentFilter.value : "",
      sort: sortFilter instanceof HTMLSelectElement ? sortFilter.value : "last_synced_desc",
      pageSize: rowsPerPage instanceof HTMLSelectElement
        ? (rowsPerPage.value === "all" ? 0 : Number(rowsPerPage.value) || 25)
        : 25,
    };
  }

  function applyFromDom(resetPage = true) {
    const patch = readFiltersFromDom();
    if (resetPage) patch.page = 1;
    liveListings.setQuery(patch);
    liveListings.applyQuery();
  }

  const applySearch = debounce(() => applyFromDom(true), 250);

  if (searchInput) {
    searchInput.addEventListener("input", () => applySearch());
    searchInput.addEventListener("search", () => applyFromDom(true));
  }

  for (const el of [statusFilter, categoryFilter, marketplaceFilter, inventoryFilter, priceCompareFilter, inventoryCompareFilter, healthFilter, fulfillmentFilter, sortFilter]) {
    el?.addEventListener("change", () => applyFromDom(true));
  }

  rowsPerPage?.addEventListener("change", () => applyFromDom(true));

  prevBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    const query = liveListings.getQuery();
    if (query.page <= 1) return;
    liveListings.setQuery({ page: query.page - 1 });
    liveListings.applyQuery();
  });

  nextBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    const query = liveListings.getQuery();
    liveListings.setQuery({ page: query.page + 1 });
    liveListings.applyQuery();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const exportBtn = target.closest('[data-action="export-listings"]');
    if (!(exportBtn instanceof HTMLButtonElement)) return;
    event.preventDefault();

    const rows = liveListings.getFilteredRows();
    if (rows.length === 0) {
      showAmazonNotification("No listings match the current filters to export.", {
        tone: "warning",
      });
      return;
    }

    downloadListingsCsv(rows);
    showAmazonNotification(`Exported ${rows.length} listing${rows.length === 1 ? "" : "s"} to CSV.`, {
      tone: "success",
    });
  });
}
