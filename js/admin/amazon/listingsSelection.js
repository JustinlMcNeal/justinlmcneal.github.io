import { qs } from "./dom.js";

/** @type {Set<string>} */
let selectedIds = new Set();

/** @type {{ getFilteredRows?: () => Array<Record<string, unknown>>, getRowById?: (id: string) => Record<string, unknown> | null }} */
let deps = {};

function updateBulkBar() {
  const bar = qs("#amazonBulkBar");
  const countEl = qs("#amazonBulkSelectionCount");
  const count = selectedIds.size;

  if (bar) {
    bar.classList.toggle("hidden", count === 0);
  }
  if (countEl) {
    countEl.textContent = `${count} selected`;
  }

  const selectAllPage = qs("#amazonSelectAllPage");
  if (selectAllPage instanceof HTMLInputElement) {
    const pageIds = getVisibleListingIds();
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    selectAllPage.checked = allSelected;
    selectAllPage.indeterminate = !allSelected &&
      pageIds.some((id) => selectedIds.has(id));
  }
}

function getVisibleListingIds() {
  const ids = [];
  qsaListingCheckboxes().forEach((input) => {
    const id = input.dataset.listingId;
    if (id) ids.push(id);
  });
  return ids;
}

function qsaListingCheckboxes() {
  return document.querySelectorAll('[data-action="select-listing"][data-listing-id]');
}

function syncCheckboxStates() {
  qsaListingCheckboxes().forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const id = input.dataset.listingId || "";
    input.checked = selectedIds.has(id);
  });
  updateBulkBar();
}

/**
 * @param {{
 *   getFilteredRows?: () => Array<Record<string, unknown>>,
 *   getRowById?: (id: string) => Record<string, unknown> | null,
 * }} options
 */
export function initAmazonListingsSelection(options = {}) {
  deps = options;

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.id === "amazonSelectAllPage") {
      const pageIds = getVisibleListingIds();
      if (target.checked) {
        pageIds.forEach((id) => selectedIds.add(id));
      } else {
        pageIds.forEach((id) => selectedIds.delete(id));
      }
      syncCheckboxStates();
      return;
    }

    if (target.dataset.action !== "select-listing") return;

    const listingId = target.dataset.listingId || "";
    if (!listingId) return;

    if (target.checked) {
      selectedIds.add(listingId);
    } else {
      selectedIds.delete(listingId);
    }
    updateBulkBar();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-action="select-all-filtered"]')) {
      event.preventDefault();
      const rows = deps.getFilteredRows?.() || [];
      rows.forEach((row) => {
        const id = String(row.amazon_listing_id || "");
        if (id) selectedIds.add(id);
      });
      syncCheckboxStates();
      return;
    }

    if (target.closest('[data-action="clear-listing-selection"]')) {
      event.preventDefault();
      selectedIds.clear();
      syncCheckboxStates();
    }
  });

  return {
    afterRender: () => syncCheckboxStates(),
    getSelectedIds: () => [...selectedIds],
    getSelectedRows: () => {
      const rows = [];
      for (const id of selectedIds) {
        const row = deps.getRowById?.(id);
        if (row) rows.push(row);
      }
      return rows;
    },
    clearSelection: () => {
      selectedIds.clear();
      syncCheckboxStates();
    },
  };
}
