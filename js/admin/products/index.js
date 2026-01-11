// /js/admin/products/index.js
import { initAdminNav } from "/js/shared/adminNav.js";
import { initFooter } from "/js/shared/footer.js";
import { requireAdmin } from "/js/shared/guard.js";

import { fetchCategories, fetchProducts, uploadProductImage } from "./api.js";
import { state } from "./state.js";
import { renderTable } from "./renderTable.js";
import { bindModal, applyJsonToForm } from "./modalEditor.js";
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
  // 1) Admin nav + footer first
  await initAdminNav("Products");
  initFooter();

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
    fUnitCost: $("fUnitCost"),
    fShipping: $("fShipping"),
    fCategory: $("fCategory"),
    fActive: $("fActive"),
    fCatalogImg: $("fCatalogImg"),
    fHoverImg: $("fHoverImg"),
    fPrimaryImg: $("fPrimaryImg"),
    fTags: $("fTags"),
    fAmazonUrl: $("fAmazonUrl"),
    profitProjectionsPanel: $("profitProjectionsPanel"),

    // Image upload elements
    fPrimaryImgFile: $("fPrimaryImgFile"),
    fCatalogImgFile: $("fCatalogImgFile"),
    fHoverImgFile: $("fHoverImgFile"),
    primaryImgPreview: $("primaryImgPreview"),
    catalogImgPreview: $("catalogImgPreview"),
    hoverImgPreview: $("hoverImgPreview"),
    btnClearPrimary: $("btnClearPrimary"),

    btnAddVariant: $("btnAddVariant"),
    variantList: $("variantList"),
    btnAddGallery: $("btnAddGallery"),
    galleryList: $("galleryList"),
    galleryFileInput: $("galleryFileInput"),
    galleryUrlInput: $("galleryUrlInput"),
    btnAddGalleryUrl: $("btnAddGalleryUrl"),
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

  // JSON Import Modal logic
  const jsonImportModal = $("json-import-modal");
  const jsonImportBtn = $("btnImportJson");
  const jsonImportClose = $("json-import-close");
  const jsonImportCancel = $("json-import-cancel");
  const jsonImportApply = $("json-import-apply");
  const jsonImportTextarea = $("json-import-textarea");
  const jsonImportError = $("json-import-error");

  function openJsonImportModal() {
    jsonImportTextarea.value = "";
    jsonImportError.classList.add("hidden");
    jsonImportModal.classList.remove("hidden");
    jsonImportModal.classList.add("flex");
  }

  function closeJsonImportModal() {
    jsonImportModal.classList.add("hidden");
    jsonImportModal.classList.remove("flex");
  }

  jsonImportBtn?.addEventListener("click", () => {
    // Open JSON modal first (it will appear on top due to higher z-index)
    openJsonImportModal();
    // Then open the product modal (it will be underneath)
    modal.openNew();
  });

  jsonImportClose?.addEventListener("click", closeJsonImportModal);
  jsonImportCancel?.addEventListener("click", closeJsonImportModal);

  jsonImportApply?.addEventListener("click", () => {
    const rawJson = jsonImportTextarea.value.trim();
    if (!rawJson) {
      jsonImportError.textContent = "Please paste JSON data.";
      jsonImportError.classList.remove("hidden");
      return;
    }

    try {
      let data = JSON.parse(rawJson);
      
      // If the parsed object has a single key that contains the actual product data,
      // extract the inner object (handles format like: {"Bag_MotoJacket": {...product data...}})
      const keys = Object.keys(data);
      if (keys.length === 1 && typeof data[keys[0]] === 'object' && data[keys[0]].name) {
        data = data[keys[0]];
      }
      
      applyJsonToForm(els, data);
      closeJsonImportModal();
    } catch (err) {
      jsonImportError.textContent = "Invalid JSON: " + err.message;
      jsonImportError.classList.remove("hidden");
    }
  });

  // Image upload handlers
  setupImageUpload(els.fPrimaryImgFile, els.fPrimaryImg, els.primaryImgPreview, "catalog");
  setupImageUpload(els.fCatalogImgFile, els.fCatalogImg, els.catalogImgPreview, "catalog");
  setupImageUpload(els.fHoverImgFile, els.fHoverImg, els.hoverImgPreview, "catalog");

  // Clear button for primary image
  els.btnClearPrimary?.addEventListener("click", () => {
    els.fPrimaryImg.value = "";
    updatePreview(els.primaryImgPreview, "");
  });

  // URL input change handlers (for manual URL paste)
  els.fPrimaryImg?.addEventListener("input", () => updatePreview(els.primaryImgPreview, els.fPrimaryImg.value));
  els.fCatalogImg?.addEventListener("input", () => updatePreview(els.catalogImgPreview, els.fCatalogImg.value));
  els.fHoverImg?.addEventListener("input", () => updatePreview(els.hoverImgPreview, els.fHoverImg.value));

  // Re-render on breakpoint changes
  const mq = window.matchMedia("(max-width: 768px)");
  safeMatchMediaAdd(mq, refreshTable);

  // Sortable column headers
  document.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort');
      
      // Toggle direction if same column, otherwise set to asc
      if (state.sortColumn === col) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortColumn = col;
        state.sortDirection = 'asc';
      }
      
      // Update mobile dropdown to match
      const mobileSort = document.getElementById('mobileSortSelect');
      if (mobileSort) {
        mobileSort.value = `${state.sortColumn}-${state.sortDirection}`;
      }
      
      refreshTable();
    });
  });

  // Mobile sort dropdown
  const mobileSortSelect = document.getElementById('mobileSortSelect');
  mobileSortSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) {
      state.sortColumn = null;
      state.sortDirection = 'asc';
    } else {
      const [col, dir] = val.split('-');
      state.sortColumn = col;
      state.sortDirection = dir;
    }
    refreshTable();
  });

  // 7) Load data + render
  state.categories = await fetchCategories();
  state.products = await fetchProducts();
  refreshTable();
}

/**
 * Sets up file input to upload to Supabase and update the URL input
 */
function setupImageUpload(fileInput, urlInput, previewEl, folder) {
  if (!fileInput || !urlInput) return;

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show loading state
    if (previewEl) {
      previewEl.innerHTML = `<div class="animate-pulse text-[10px] uppercase">Uploading...</div>`;
    }

    try {
      const url = await uploadProductImage(file, folder);
      urlInput.value = url;
      updatePreview(previewEl, url);
    } catch (err) {
      console.error("Upload failed:", err);
      alert("Upload failed: " + (err.message || err));
      updatePreview(previewEl, "");
    }

    // Reset file input
    fileInput.value = "";
  });
}

/**
 * Updates an image preview element
 */
function updatePreview(previewEl, url) {
  if (!previewEl) return;

  if (url) {
    previewEl.innerHTML = `<img src="${url}" class="w-full h-full object-cover" alt="Preview" />`;
  } else {
    previewEl.innerHTML = `<span class="text-[10px] uppercase tracking-wider text-gray-400">No image</span>`;
  }
}
