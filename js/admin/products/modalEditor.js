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
  addGalleryFromFiles,
  collectVariants,
  collectGallery,
  renderSectionEditor,
  collectSectionItems,
} from "./modalRows.js";

import {
  calculateProfitProjections,
  renderProfitCard,
} from "../pStorage/profitCalc.js";

/**
 * Updates an image preview element
 */
function updateImagePreview(previewEl, url) {
  if (!previewEl) return;
  if (url) {
    previewEl.innerHTML = `<img src="${url}" class="w-full h-full object-cover" alt="Preview" />`;
  } else {
    previewEl.innerHTML = `<span class="text-[10px] uppercase tracking-wider text-gray-400">No image</span>`;
  }
}

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

  /**
   * Update profit projections panel based on current form values
   */
  function updateProfitProjections() {
    if (!els.profitProjectionsPanel) return;
    
    const price = parseFloat(els.fPrice?.value) || 0;
    const weight = parseFloat(els.fWeight?.value) || 0;
    const unitCost = parseFloat(els.fUnitCost?.value) || 0;
    
    // Build item object for profit calculation
    const item = {
      target_price: price,
      unit_cost: unitCost,
      weight_g: weight,
      bulk_qty: 30, // Default bulk quantity for estimation
    };
    
    const projections = calculateProfitProjections(item);
    
    if (projections.hasEnoughData) {
      els.profitProjectionsPanel.innerHTML = renderProfitCard(projections);
      els.profitProjectionsPanel.classList.remove("hidden");
    } else {
      els.profitProjectionsPanel.classList.add("hidden");
    }
  }

  // Bind live profit updates to relevant fields
  [els.fPrice, els.fWeight, els.fUnitCost].forEach(field => {
    field?.addEventListener("input", updateProfitProjections);
  });

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
    els.fUnitCost.value = full.product.unit_cost ?? "";
    els.fShipping.value = full.product.shipping_status || "";
    els.fAmazonUrl.value = full.product.amazon_url || "";
    els.fActive.checked = !!full.product.is_active;

    els.fCatalogImg.value = full.product.catalog_image_url || "";
    els.fHoverImg.value = full.product.catalog_hover_url || "";
    els.fPrimaryImg.value = full.product.primary_image_url || "";

    // Update image previews
    updateImagePreview(els.primaryImgPreview, full.product.primary_image_url);
    updateImagePreview(els.catalogImgPreview, full.product.catalog_image_url);
    updateImagePreview(els.hoverImgPreview, full.product.catalog_hover_url);

    // Update profit projections
    updateProfitProjections();

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
    els.fUnitCost.value = "";
    els.fShipping.value = "";
    els.fAmazonUrl.value = "";
    els.fActive.checked = true;

    els.fCatalogImg.value = "";
    els.fHoverImg.value = "";
    els.fPrimaryImg.value = "";

    // Clear image previews
    updateImagePreview(els.primaryImgPreview, "");
    updateImagePreview(els.catalogImgPreview, "");
    updateImagePreview(els.hoverImgPreview, "");

    // Clear profit projections
    if (els.profitProjectionsPanel) {
      els.profitProjectionsPanel.classList.add("hidden");
    }

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
        unit_cost: els.fUnitCost?.value ? Number(els.fUnitCost.value) : null,
        shipping_status: els.fShipping.value.trim() || null,
        amazon_url: els.fAmazonUrl.value.trim() || null,
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
  
  // Gallery file upload - multi-select support
  els.galleryFileInput?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    await addGalleryFromFiles(els.galleryList, files);
    
    // Reset file input
    e.target.value = "";
  });

  // Gallery URL input - add by pasting URL
  els.btnAddGalleryUrl?.addEventListener("click", () => {
    const url = els.galleryUrlInput?.value?.trim();
    if (!url) return;
    
    addGalleryRow(els.galleryList, { url });
    els.galleryUrlInput.value = "";
  });

  // Also allow Enter key to add URL
  els.galleryUrlInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      els.btnAddGalleryUrl?.click();
    }
  });

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

/**
 * Applies JSON data to the product form fields.
 * Maps the user's JSON format to the form inputs.
 * 
 * Expected JSON format:
 * {
 *   name, category, product_id, price, weight_oz, tags[],
 *   catalogImage, catalogImageHover, image,
 *   descriptionList[], custom1Options (pipe-separated),
 *   variantStock{color: count}, variantImages{color: url},
 *   thumbnails[]
 * }
 */
export function applyJsonToForm(els, data) {
  // Basic fields
  if (data.name) els.fName.value = data.name;
  if (data.product_id) els.fCode.value = data.product_id;
  if (data.price) els.fPrice.value = data.price;
  
  // Weight: convert oz to grams if present (1 oz ≈ 28.35g)
  if (data.weight_oz) {
    els.fWeight.value = Math.round(data.weight_oz * 28.35);
  }

  // Generate slug from name
  if (data.name) {
    els.fSlug.value = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // Tags
  if (Array.isArray(data.tags)) {
    els.fTags.value = data.tags.join(", ");
  }

  // Images
  if (data.catalogImage) {
    els.fCatalogImg.value = data.catalogImage;
    updatePreviewEl(els.catalogImgPreview, data.catalogImage);
  }
  if (data.catalogImageHover) {
    els.fHoverImg.value = data.catalogImageHover;
    updatePreviewEl(els.hoverImgPreview, data.catalogImageHover);
  }
  if (data.image) {
    els.fPrimaryImg.value = data.image;
    updatePreviewEl(els.primaryImgPreview, data.image);
  }

  // Category - try to match by name
  if (data.category && els.fCategory) {
    const catOption = Array.from(els.fCategory.options).find(
      opt => opt.textContent.toLowerCase() === data.category.toLowerCase()
    );
    if (catOption) {
      els.fCategory.value = catOption.value;
    }
  }

  // Variants from variantStock and variantImages
  if (data.variantStock || data.custom1Options) {
    els.variantList.innerHTML = "";
    
    let colors = [];
    
    // Get colors from custom1Options (pipe-separated)
    if (data.custom1Options) {
      colors = data.custom1Options.split("|").map(c => c.trim()).filter(Boolean);
    }
    // Or from variantStock keys
    else if (data.variantStock && typeof data.variantStock === "object") {
      colors = Object.keys(data.variantStock);
    }

    colors.forEach((color) => {
      const stock = data.variantStock?.[color] ?? 0;
      const imageUrl = data.variantImages?.[color] || "";
      
      // Add variant row with data
      addVariantRow(els.variantList, {
        color_name: color,
        stock_count: stock,
        image_url: imageUrl,
      });
    });
  }

  // Gallery from thumbnails
  if (Array.isArray(data.thumbnails) && data.thumbnails.length > 0) {
    els.galleryList.innerHTML = "";
    data.thumbnails.forEach((url, i) => {
      addGalleryRow(els.galleryList, {
        image_url: url,
        sort_order: i,
      });
    });
  }

  // Description list - populate description section if available
  if (Array.isArray(data.descriptionList) && data.descriptionList.length > 0) {
    const descTextarea = document.querySelector('[data-section="description"] textarea');
    if (descTextarea) {
      descTextarea.value = data.descriptionList.map(item => `• ${item}`).join("\n");
    }
  }

  // Sizing list - populate sizing section if available
  if (Array.isArray(data.sizingList) && data.sizingList.length > 0) {
    const sizingTextarea = document.querySelector('[data-section="sizing"] textarea');
    if (sizingTextarea) {
      sizingTextarea.value = data.sizingList.map(item => `• ${item}`).join("\n");
    }
  }

  // Care list - populate care section if available
  if (Array.isArray(data.careList) && data.careList.length > 0) {
    const careTextarea = document.querySelector('[data-section="care"] textarea');
    if (careTextarea) {
      careTextarea.value = data.careList.map(item => `• ${item}`).join("\n");
    }
  }
}

/**
 * Updates an image preview element
 */
function updatePreviewEl(previewEl, url) {
  if (!previewEl) return;
  if (url) {
    previewEl.innerHTML = `<img src="${url}" class="w-full h-full object-cover" alt="Preview" />`;
  } else {
    previewEl.innerHTML = `<span class="text-[10px] uppercase tracking-wider text-gray-400">No image</span>`;
  }
}
