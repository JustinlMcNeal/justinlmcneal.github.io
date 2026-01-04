// /js/admin/products/index.js
import { initNavbar } from "/js/shared/navbar.js";
import { requireAdmin } from "/js/shared/guard.js";

import { fetchCategories, fetchProducts } from "./api.js";
import { state } from "./state.js";
import { renderTable } from "./renderTable.js";
import { bindModal } from "./modalEditor.js";
import { $ } from "./dom.js";

import {
  fetchSectionItemsForProduct,
  upsertSectionItemsForProduct,
} from "./sectionItems.js";

function buildLoginRedirect() {
  const next = `${location.pathname}${location.search}`;
  return `/pages/admin/login.html?next=${encodeURIComponent(next)}`;
}

function safeMatchMediaAdd(mq, fn) {
  try {
    // Safari fallback
    if (mq.addEventListener) mq.addEventListener("change", fn);
    else mq.addListener(fn);
  } catch {
    /* ignore */
  }
}

document.addEventListener("DOMContentLoaded", () => {
  boot();
});

async function boot() {
  // 1) Navbar first (so admin-only menu/logout can show)
  await initNavbar();

  // 2) Admin guard (ENFORCED)
  const check = await requireAdmin();
  if (!check.ok) {
    console.warn("[Admin Products] blocked:", check.reason);
    location.replace(buildLoginRedirect());
    return;
  }

  // 3) Cache elements
  const els = {
    searchInput: $("searchInput"),
    countLabel: $("countLabel"),
    btnNew: $("btnNew"),
    productRows: $("productRows"),

    modal: $("modal"),
    modalTitle: $("modalTitle"),
    btnClose: $("btnClose"),
    btnSave: $("btnSave"),
    btnDelete: $("btnDelete"),
    btnHardDelete: $("btnHardDelete"),
    modalMsg: $("modalMsg"),

    fName: $("fName"),
    fSlug: $("fSlug"),
    fCode: $("fCode"),
    fPrice: $("fPrice"),
    fWeight: $("fWeight"),
    fShipping: $("fShipping"),
    fCategory: $("fCategory"),
    fActive: $("fActive"),
    fCatalogImg: $("fCatalogImg"),
    fHoverImg: $("fHoverImg"),
    fPrimaryImg: $("fPrimaryImg"),
    fTags: $("fTags"),

    btnAddVariant: $("btnAddVariant"),
    variantList: $("variantList"),
    btnAddGallery: $("btnAddGallery"),
    galleryList: $("galleryList"),
  };

  // 4) Modal binder
  const modal = bindModal(
    els,
    () => refreshTable(),
    { fetchSectionItemsForProduct, upsertSectionItemsForProduct }
  );

  // 5) Render function
  function refreshTable() {
    renderTable({
      productRowsEl: els.productRows,
      countLabelEl: els.countLabel,
      searchValue: els.searchInput?.value || "",
      onEdit: modal.openEdit,
      onEditError: (err) => console.warn("[Admin Products] Edit failed:", err),
      readOnly: false, // admin only page, so never readOnly here
    });
  }

  // 6) Wire UI
  els.searchInput?.addEventListener("input", refreshTable);

  els.btnNew?.addEventListener("click", () => {
    modal.openNew();
  });

  // Re-render on breakpoint changes
  const mq = window.matchMedia("(max-width: 768px)");
  safeMatchMediaAdd(mq, refreshTable);

  // 7) Load data + render
  state.categories = await fetchCategories();
  state.products = await fetchProducts();
  refreshTable();
}
