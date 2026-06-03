import { fetchAmazonReadyToPushProducts } from "./api.js";
import { qs } from "./dom.js";
import { showAmazonNotification } from "./notifications.js";
import { filterReadyToPushRows } from "./readyToPushQuery.js";
import { isParentShellRow, normalizeReadyToPushRows } from "./readyToPushNormalize.js";
import { enrichReadyToPushParentStatus } from "./readyToPushParentStatus.js";
import { renderReadyToPush } from "./renderReadyToPush.js";
import { initWorkAreaPagination } from "./workAreaPagination.js";

/** @type {Array<Record<string, unknown>>} */
let lastReadyRows = [];

/** @type {string} */
let readySearchQuery = "";

function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function readReadySearchFromDom() {
  const input = qs("#amazonReadyToPushSearch");
  return input instanceof HTMLInputElement ? input.value : "";
}

const readyToPushPagination = initWorkAreaPagination({
  summaryId: "amazonReadyToPushPaginationSummary",
  pageLabelId: "amazonReadyToPushPaginationPageLabel",
  prevId: "amazonReadyToPushPrevPage",
  nextId: "amazonReadyToPushNextPage",
  rowsSelectId: "amazonReadyToPushRowsPerPage",
});

/**
 * @param {{ onLoaded?: () => void }} [deps]
 */
export function initAmazonReadyToPush(deps = {}) {
  function getFilteredReadyRows() {
    return filterReadyToPushRows(lastReadyRows, readySearchQuery);
  }

  function renderReadyPage() {
    const filtered = getFilteredReadyRows();
    readyToPushPagination.apply(filtered, (pageRows, meta) => {
      const variantRows = lastReadyRows.filter((row) => !isParentShellRow(row));
      renderReadyToPush(pageRows, {
        totalVariantTargets: meta.total,
        fullTotal: variantRows.length,
        searchQuery: readySearchQuery.trim(),
      });
    });
  }

  async function refreshReadyToPush() {
    try {
      const rows = await enrichReadyToPushParentStatus(
        normalizeReadyToPushRows(await fetchAmazonReadyToPushProducts({ limit: 500 })),
      );
      lastReadyRows = rows;
      readyToPushPagination.resetPage();
      renderReadyPage();
      deps.onLoaded?.();
      return rows;
    } catch {
      showAmazonNotification("Could not load Ready to Push products.", { tone: "error" });
      lastReadyRows = [];
      renderReadyToPush([], { totalVariantTargets: 0, fullTotal: 0, searchQuery: "" });
      return [];
    }
  }

  readyToPushPagination.bindNavigation(renderReadyPage);

  const onSearchInput = debounce(() => {
    readySearchQuery = readReadySearchFromDom();
    readyToPushPagination.resetPage();
    renderReadyPage();
  }, 200);

  qs("#amazonReadyToPushSearch")?.addEventListener("input", onSearchInput);
  qs("#amazonReadyToPushSearch")?.addEventListener("search", onSearchInput);

  function getRowsForProduct(kkProductId) {
    const id = String(kkProductId || "").trim();
    if (!id) return [];
    return lastReadyRows.filter((row) => String(row.kk_product_id || "") === id);
  }

  document.addEventListener("amazon:view-change", (event) => {
    const view = event.detail?.view;
    if (view === "ready-to-push") refreshReadyToPush().catch(() => {});
  });

  return { refreshReadyToPush, getRowsForProduct, getLastReadyRows: () => lastReadyRows.slice() };
}
