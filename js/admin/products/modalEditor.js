import {
  fetchProductFull,
  fetchProducts,
  upsertProduct,
  replaceVariants,
  replaceGallery,
  replaceProductTags,
  setProductActive,
  hardDeleteProduct,
} from "./api.js";

import { state } from "./state.js";
import { show, setMsg, normalizeSlug } from "./dom.js";
import {
  addVariantRow,
  addGalleryRow,
  collectVariants,
  collectGallery,
  renderSectionEditor,
  collectSectionItems,
} from "./modalRows.js";

export function bindModal(els, refreshTable, sectionApi = {}) {
  const {
    fetchSectionItemsForProduct = null,
    upsertSectionItemsForProduct = null,
  } = sectionApi;

  const SECTIONS = ["description", "sizing", "care"];

  /* ---------------- Helpers ---------------- */

  function openModal() {
    setMsg(els.modalMsg, "", false);
    show(els.modal, true);
    els.modal.classList.add("is-open");
  }

  function closeModal() {
    show(els.modal, false);
    els.modal.classList.remove("is-open");
    state.editing = null;
  }

  function clearLists() {
    els.variantList.innerHTML = "";
    els.galleryList.innerHTML = "";
  }

  function fillCategorySelect(selectedId) {
    els.fCategory.innerHTML = (state.categories || [])
      .map(
        (c) =>
          `<option value="${c.id}" ${
            String(c.id) === String(selectedId) ? "selected" : ""
          }>${c.name}</option>`
      )
      .join("");
  }

  /* ---------------- Modal Flows ---------------- */

  async function openEdit(productId) {
  try {
    // Show modal immediately with a loading title
    els.modalTitle.textContent = "Edit Product";
    setMsg(els.modalMsg, "Loading product…", false);
    show(els.modal, true);
    els.modal.classList.add("is-open");

    const full = await fetchProductFull(productId);
    state.editing = full;

    els.modalTitle.textContent = `Edit · ${full.product.name || ""}`;
    fillCategorySelect(full.product.category_id);

    els.fName.value = full.product.name || "";
    els.fSlug.value = full.product.slug || "";
    els.fCode.value = full.product.code || "";
    els.fPrice.value = full.product.price ?? "";
    els.fWeight.value = full.product.weight_g ?? "";
    els.fShipping.value = full.product.shipping_status || "";
    els.fActive.checked = !!full.product.is_active;

    els.fCatalogImg.value = full.product.catalog_image_url || "";
    els.fHoverImg.value = full.product.catalog_hover_url || "";
    els.fPrimaryImg.value = full.product.primary_image_url || "";

    els.fTags.value = (full.tags || []).map((t) => t.name).join(", ");

    clearLists();
    (full.variants || []).forEach((v) => addVariantRow(els.variantList, v));
    (full.gallery || []).forEach((g) => addGalleryRow(els.galleryList, g));

    // Sections
    let sectionItems = [];
    if (fetchSectionItemsForProduct) {
      try {
        sectionItems = await fetchSectionItemsForProduct(full.product.id);
      } catch (e) {
        console.error(e);
      }
    }
    renderSectionEditor({ modalMsgEl: els.modalMsg, sections: SECTIONS, items: sectionItems });

    // Clear loading message
    setMsg(els.modalMsg, "", false);
  } catch (e) {
    console.error(e);
    setMsg(
      els.modalMsg,
      `Could not load product details. Check console for the Supabase error.\n\n${e?.message || e}`,
      true
    );
    // Keep modal open so you can see the error message.
    show(els.modal, true);
    throw e; // so renderTable can also catch/log
  }
}


  function openNew() {
    const firstCat = state.categories?.[0]?.id || null;

    state.editing = {
      product: {
        id: null,
        name: "",
        slug: "",
        code: "",
        category_id: firstCat,
        price: 0,
        weight_g: null,
        shipping_status: "",
        catalog_image_url: "",
        catalog_hover_url: "",
        primary_image_url: "",
        is_active: true,
      },
      variants: [],
      gallery: [],
      tags: [],
    };

    els.modalTitle.textContent = "Add Product";
    fillCategorySelect(firstCat);

    els.fName.value = "";
    els.fSlug.value = "";
    els.fCode.value = "";
    els.fPrice.value = "";
    els.fWeight.value = "";
    els.fShipping.value = "";
    els.fActive.checked = true;

    els.fCatalogImg.value = "";
    els.fHoverImg.value = "";
    els.fPrimaryImg.value = "";

    els.fTags.value = "";

    clearLists();

    // Sections blank
    renderSectionEditor({ modalMsgEl: els.modalMsg, sections: SECTIONS, items: [] });

    openModal();
  }

  async function save() {
    try {
      setMsg(els.modalMsg, "", false);

      const name = els.fName.value.trim();
      if (!name) throw new Error("Name is required.");

      const slug = normalizeSlug(els.fSlug.value || name);
      if (!slug) throw new Error("Slug is required.");

      const payload = {
        id: state.editing?.product?.id || undefined,
        name,
        slug,
        code: els.fCode.value.trim() || null,
        category_id: els.fCategory.value || null,
        price: Number(els.fPrice.value || 0),
        weight_g: els.fWeight.value ? Number(els.fWeight.value) : null,
        shipping_status: els.fShipping.value.trim() || null,
        catalog_image_url: els.fCatalogImg.value.trim() || null,
        catalog_hover_url: els.fHoverImg.value.trim() || null,
        primary_image_url: els.fPrimaryImg.value.trim() || null,
        is_active: !!els.fActive.checked,
      };

      const saved = await upsertProduct(payload);

      const variants = collectVariants(els.variantList);
      const gallery = collectGallery(els.galleryList);
      const tags = (els.fTags.value || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      await replaceVariants(saved.id, variants);
      await replaceGallery(saved.id, gallery);
      await replaceProductTags(saved.id, tags);

      if (upsertSectionItemsForProduct) {
        const sectionItems = collectSectionItems({ sections: SECTIONS });
        await upsertSectionItemsForProduct(saved.id, sectionItems);
      }

      state.products = await fetchProducts();
      refreshTable();
      closeModal();
    } catch (e) {
      console.error(e);
      setMsg(els.modalMsg, String(e.message || e), true);
    }
  }

  async function disableProduct() {
    if (!state.editing?.product?.id) return;
    try {
      await setProductActive(state.editing.product.id, false);
      state.products = await fetchProducts();
      refreshTable();
      closeModal();
    } catch (e) {
      console.error(e);
      setMsg(els.modalMsg, String(e.message || e), true);
    }
  }

  async function hardDelete() {
    if (!state.editing?.product?.id) return;
    const ok = confirm("Hard delete this product? This cannot be undone.");
    if (!ok) return;

    try {
      await hardDeleteProduct(state.editing.product.id);
      state.products = await fetchProducts();
      refreshTable();
      closeModal();
    } catch (e) {
      console.error(e);
      setMsg(els.modalMsg, String(e.message || e), true);
    }
  }

  /* ---------------- Events ---------------- */

  els.btnSave.addEventListener("click", save);
  els.btnClose.addEventListener("click", closeModal);

  els.btnDelete?.addEventListener("click", disableProduct);
  els.btnHardDelete?.addEventListener("click", hardDelete);

  els.btnAddVariant.addEventListener("click", () => addVariantRow(els.variantList));
  els.btnAddGallery.addEventListener("click", () => addGalleryRow(els.galleryList));

  // auto slug if slug empty
  els.fName.addEventListener("input", () => {
    if (els.fSlug.value.trim()) return;
    els.fSlug.value = normalizeSlug(els.fName.value);
  });

  // click outside to close
  els.modal.addEventListener("click", (e) => {
    if (e.target === els.modal) closeModal();
  });

  // escape to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.modal.classList.contains("hidden")) closeModal();
  });

  return { openEdit, openNew };
}
