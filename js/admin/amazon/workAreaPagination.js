import { qs } from "./dom.js";
import { paginateListings } from "./listingsQuery.js";

/**
 * Client-side pagination for Needs Mapping / Ready to Push panels.
 * @param {{
 *   summaryId: string,
 *   pageLabelId: string,
 *   prevId: string,
 *   nextId: string,
 *   rowsSelectId: string,
 *   defaultPageSize?: number,
 * }} ids
 */
export function initWorkAreaPagination(ids) {
  const {
    summaryId,
    pageLabelId,
    prevId,
    nextId,
    rowsSelectId,
    defaultPageSize = 25,
  } = ids;

  let page = 1;

  function readPageSize() {
    const select = qs(`#${rowsSelectId}`);
    if (select instanceof HTMLSelectElement) {
      if (select.value === "all") return 0;
      const parsed = Number(select.value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPageSize;
    }
    return defaultPageSize;
  }

  function updateControls(pageResult) {
    const prevBtn = qs(`#${prevId}`);
    const nextBtn = qs(`#${nextId}`);
    const pageLabel = qs(`#${pageLabelId}`);
    const summary = qs(`#${summaryId}`);

    const atStart = pageResult.page <= 1 || pageResult.total === 0;
    const atEnd = pageResult.page >= pageResult.totalPages || pageResult.total === 0;

    if (prevBtn instanceof HTMLButtonElement) {
      prevBtn.disabled = atStart;
      prevBtn.setAttribute("aria-disabled", atStart ? "true" : "false");
      prevBtn.classList.toggle("opacity-40", atStart);
      prevBtn.classList.toggle("cursor-not-allowed", atStart);
    }

    if (nextBtn instanceof HTMLButtonElement) {
      nextBtn.disabled = atEnd;
      nextBtn.setAttribute("aria-disabled", atEnd ? "true" : "false");
      nextBtn.classList.toggle("opacity-40", atEnd);
      nextBtn.classList.toggle("cursor-not-allowed", atEnd);
    }

    if (pageLabel) {
      pageLabel.textContent = pageResult.total === 0
        ? "Page 0 of 0"
        : `Page ${pageResult.page} of ${pageResult.totalPages}`;
    }

    if (summary) {
      if (pageResult.total <= 0) {
        summary.textContent = "Showing 0 results";
      } else {
        summary.innerHTML =
          `Showing <span class="font-bold text-black">${pageResult.startIndex}</span> to <span class="font-bold text-black">${pageResult.endIndex}</span> of <span class="font-bold text-black">${pageResult.total}</span> results`;
      }
    }
  }

  /**
   * @param {Array<Record<string, unknown>>} rows
   * @param {(pageRows: Array<Record<string, unknown>>, meta: { total: number, page: ReturnType<typeof paginateListings> }) => void} renderPage
   */
  function apply(rows, renderPage) {
    const pageSize = readPageSize();
    const pageResult = paginateListings(rows, page, pageSize);
    page = pageResult.page;
    renderPage(pageResult.rows, { total: pageResult.total, page: pageResult });
    updateControls(pageResult);
    return pageResult;
  }

  function resetPage() {
    page = 1;
  }

  function bindNavigation(rerender) {
    qs(`#${prevId}`)?.addEventListener("click", (event) => {
      event.preventDefault();
      if (page <= 1) return;
      page -= 1;
      rerender();
    });

    qs(`#${nextId}`)?.addEventListener("click", (event) => {
      event.preventDefault();
      page += 1;
      rerender();
    });

    qs(`#${rowsSelectId}`)?.addEventListener("change", () => {
      page = 1;
      rerender();
    });
  }

  return {
    apply,
    resetPage,
    bindNavigation,
  };
}
