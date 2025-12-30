import { initNavbar } from "../../shared/navbar.js";
import { requireAdmin } from "../../shared/guard.js";

import { fetchCategories, fetchProducts } from "./api.js";
import { state } from "./state.js";
import { renderTable } from "./renderTable.js";
import { bindModal } from "./modalEditor.js";
import { $ } from "./dom.js";

import {
  fetchSectionItemsForProduct,
  upsertSectionItemsForProduct,
} from "./sectionItems.js";

document.addEventListener("DOMContentLoaded", async () => {
  await initNavbar();
  boot();
});

function boot() {
  const els = {
    // existing page elements
    searchInput: $("searchInput"),
    countLabel: $("countLabel"),
    btnNew: $("btnNew"),
    productRows: $("productRows"),

    // modal elements (same ids you already have)
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

  let isAdmin = false;

  let refreshTable = () => {
    renderTable({
      productRowsEl: els.productRows,
      countLabelEl: els.countLabel,
      searchValue: els.searchInput?.value || "",
      onEdit: isAdmin ? modal.openEdit : () => {},
      onEditError: (err) => console.warn("[Admin Products] Edit failed:", err),
      readOnly: !isAdmin,
    });
  };

  const modal = bindModal(
    els,
    () => refreshTable(),
    { fetchSectionItemsForProduct, upsertSectionItemsForProduct }
  );

  async function loadData() {
    state.categories = await fetchCategories();
    state.products = await fetchProducts();
    refreshTable();
  }

  function setReadOnlyUI(readOnly) {
    if (els.btnNew) {
      els.btnNew.disabled = readOnly;
      els.btnNew.style.opacity = readOnly ? "0.5" : "1";
      els.btnNew.style.pointerEvents = readOnly ? "none" : "auto";
      els.btnNew.title = readOnly ? "Admin only" : "";
    }
  }

  function wire() {
    els.searchInput?.addEventListener("input", refreshTable);

    els.btnNew?.addEventListener("click", () => {
      if (!isAdmin) return;
      modal.openNew();
    });

    // Re-render on breakpoint changes so mobile/table switches cleanly
    window.matchMedia("(max-width: 768px)").addEventListener("change", refreshTable);
  }

  (async () => {
    wire();

    // Always load data so page isn't blank
    await loadData();

    // Admin check AFTER data (so you still see products even if not admin)
    const check = await requireAdmin();
    isAdmin = !!check.ok;

    setReadOnlyUI(!isAdmin);

    // Optional: show a tiny “read only” notice somewhere if you want
    if (!isAdmin) {
      console.warn("[Admin Products]", check.reason);
    }

    // Re-render so Edit buttons disappear if not admin
    refreshTable();
  })();
}
