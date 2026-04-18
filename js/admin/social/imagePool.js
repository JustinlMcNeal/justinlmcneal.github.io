// /js/admin/social/imagePool.js
// Image Pool — asset management, catalog browser, tagging

import {
  fetchProducts,
  fetchAssets,
  uploadAssets,
  updateAssetTags,
  deleteAsset,
  createAsset,
  getPublicUrl
} from "./api.js";
import { getSupabaseClient } from "../../shared/supabaseClient.js";

let _state, _els, _showToast, _getClient;
let _openUploadModalWithAsset;

export function initImagePool(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _openUploadModalWithAsset = deps.openUploadModalWithAsset;
}

// ─── Catalog Browser ───
const catalogState = { selected: new Set(), allImages: [] };

export function setupImagePool() {
  _els.btnPoolUpload?.addEventListener("click", () => {
    _els.poolDropZone.classList.toggle("hidden");
  });

  _els.poolDropZone?.addEventListener("click", () => {
    _els.poolFileInput?.click();
  });

  _els.poolFileInput?.addEventListener("change", (e) => {
    if (e.target.files.length) handlePoolUpload(Array.from(e.target.files));
  });

  _els.poolDropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    _els.poolDropZone.classList.add("drag-over");
  });
  _els.poolDropZone?.addEventListener("dragleave", () => {
    _els.poolDropZone.classList.remove("drag-over");
  });
  _els.poolDropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    _els.poolDropZone.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (files.length) handlePoolUpload(files);
  });

  _els.poolFilterBtns?.addEventListener("click", (e) => {
    const btn = e.target.closest(".pool-filter-btn");
    if (!btn) return;
    _state.poolFilter = btn.dataset.filter;
    _els.poolFilterBtns.querySelectorAll(".pool-filter-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
      b.classList.toggle("bg-black", b === btn);
      b.classList.toggle("text-white", b === btn);
    });
    loadAssets();
  });

  let searchTimer;
  _els.assetSearch?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _state.poolSearch = e.target.value.trim();
      loadAssets();
    }, 300);
  });

  setupTagModal();
  _els.btnBrowseCatalog?.addEventListener("click", openCatalogBrowser);
}

async function openCatalogBrowser() {
  const modal = _els.catalogBrowseModal;
  if (!modal) return;
  modal.style.display = "flex";
  modal.classList.remove("hidden");
  catalogState.selected.clear();
  updateCatalogSelectedCount();

  const cats = _state.categories || [];
  _els.catalogCategoryFilter.innerHTML = '<option value="">All Categories</option>' +
    cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");

  await loadCatalogImages();

  _els.catalogBrowseClose.onclick = closeCatalogBrowser;
  _els.catalogBrowseCancel.onclick = closeCatalogBrowser;
  _els.catalogBrowseImport.onclick = importSelectedCatalogImages;

  let searchTimer;
  _els.catalogSearchInput.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderCatalogGrid, 300);
  };
  _els.catalogCategoryFilter.onchange = renderCatalogGrid;
}

function closeCatalogBrowser() {
  _els.catalogBrowseModal.style.display = "none";
  _els.catalogBrowseModal.classList.add("hidden");
}

async function loadCatalogImages() {
  _els.catalogBrowseGrid.innerHTML = '<p class="col-span-full text-center text-gray-400 py-8">Loading products...</p>';

  const products = _state.products?.length ? _state.products : await fetchProducts();
  if (!_state.products?.length) _state.products = products;

  const sb = getSupabaseClient();
  const { data: gallery } = await sb
    .from("product_gallery_images")
    .select("product_id, url, position")
    .eq("is_active", true)
    .order("position", { ascending: true });

  const { data: existingAssets } = await sb
    .from("social_assets")
    .select("original_image_path")
    .eq("is_active", true);
  const existingUrls = new Set((existingAssets || []).map(a => a.original_image_path));

  const images = [];
  for (const p of products) {
    if (!p.is_active) continue;
    const catName = (_state.categories || []).find(c => c.id === p.category_id)?.name || "";

    if (p.catalog_image_url) {
      images.push({
        url: p.catalog_image_url, product_id: p.id, product_name: p.name,
        category_id: p.category_id, category_name: catName, type: "catalog",
        already_in_pool: existingUrls.has(p.catalog_image_url),
      });
    }

    const pGallery = (gallery || []).filter(g => g.product_id === p.id);
    for (const g of pGallery) {
      if (g.url === p.catalog_image_url) continue;
      images.push({
        url: g.url, product_id: p.id, product_name: p.name,
        category_id: p.category_id, category_name: catName, type: "gallery",
        already_in_pool: existingUrls.has(g.url),
      });
    }
  }

  catalogState.allImages = images;
  renderCatalogGrid();
}

function renderCatalogGrid() {
  const search = (_els.catalogSearchInput?.value || "").toLowerCase().trim();
  const catFilter = _els.catalogCategoryFilter?.value || "";

  let filtered = catalogState.allImages;
  if (search) filtered = filtered.filter(img => img.product_name.toLowerCase().includes(search));
  if (catFilter) filtered = filtered.filter(img => img.category_id === catFilter);

  if (!filtered.length) {
    _els.catalogBrowseGrid.innerHTML = '<p class="col-span-full text-center text-gray-400 py-8">No images found</p>';
    return;
  }

  _els.catalogBrowseGrid.innerHTML = filtered.map(img => {
    const isSelected = catalogState.selected.has(img.url);
    const inPool = img.already_in_pool;
    return `
      <div class="catalog-img-card relative rounded-lg overflow-hidden border-2 cursor-pointer transition-all
        ${inPool ? "opacity-50 border-gray-200" : isSelected ? "border-indigo-500 ring-2 ring-indigo-200" : "border-gray-200 hover:border-gray-400"}"
        data-url="${img.url}" data-product-id="${img.product_id}" data-product-name="${img.product_name}"
        ${inPool ? 'title="Already in Image Pool"' : ""}>
        <img src="${img.url}" class="w-full aspect-square object-cover" loading="lazy"
          onerror="this.src='/imgs/placeholder.jpg'">
        <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 p-2">
          <p class="text-white text-xs font-medium truncate">${img.product_name}</p>
          <p class="text-white/60 text-[10px]">${img.type}${img.category_name ? " · " + img.category_name : ""}</p>
        </div>
        ${inPool ? '<div class="absolute top-2 right-2 bg-green-500 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">IN POOL</div>' : ""}
        ${isSelected ? '<div class="absolute top-2 left-2 w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center text-white text-xs font-bold">✓</div>' : ""}
      </div>`;
  }).join("");

  _els.catalogBrowseGrid.onclick = (e) => {
    const card = e.target.closest(".catalog-img-card");
    if (!card) return;
    const url = card.dataset.url;
    if (catalogState.allImages.find(i => i.url === url)?.already_in_pool) return;
    if (catalogState.selected.has(url)) catalogState.selected.delete(url);
    else catalogState.selected.add(url);
    renderCatalogGrid();
    updateCatalogSelectedCount();
  };
}

function updateCatalogSelectedCount() {
  const count = catalogState.selected.size;
  _els.catalogSelectedCount.textContent = `${count} image${count !== 1 ? "s" : ""} selected`;
  _els.catalogBrowseImport.disabled = count === 0;
}

async function importSelectedCatalogImages() {
  const urls = Array.from(catalogState.selected);
  if (!urls.length) return;

  _els.catalogBrowseImport.disabled = true;
  _els.catalogBrowseImport.textContent = "Importing...";

  const succeeded = [];
  const failed = [];

  for (const url of urls) {
    const imgData = catalogState.allImages.find(i => i.url === url);
    if (!imgData) continue;

    try {
      const asset = await createAsset({
        original_image_path: url,
        original_filename: url.split("/").pop() || "catalog-image.jpg",
        product_id: imgData.product_id,
        product_url: `https://karrykraze.com/pages/product.html?slug=${(_state.products || []).find(p => p.id === imgData.product_id)?.slug || ""}`,
        used_count: 0,
        is_active: true,
      });
      succeeded.push(asset);
    } catch (err) {
      failed.push({ name: imgData.product_name, error: err.message || String(err) });
    }
  }

  closeCatalogBrowser();
  _els.catalogBrowseImport.textContent = "Import Selected";
  _els.catalogBrowseImport.disabled = false;

  if (succeeded.length) {
    _showToast(`${succeeded.length} image${succeeded.length > 1 ? "s" : ""} added to pool`, "success");
    await loadAssets();
    openTagModal(succeeded[0]);
  }
  if (failed.length) {
    _showToast(`${failed.length} failed: ${failed.map(f => f.name).join(", ")}`, "error");
  }
}

async function handlePoolUpload(files) {
  _els.poolDropZone.classList.add("hidden");
  _els.poolUploadProgress.classList.remove("hidden");
  _els.poolUploadStatus.textContent = `Uploading ${files.length} image${files.length > 1 ? "s" : ""}...`;

  try {
    const { succeeded, failed } = await uploadAssets(files);

    if (failed.length === 0) {
      _els.poolUploadStatus.textContent = `Uploaded ${succeeded.length} image${succeeded.length > 1 ? "s" : ""}!`;
      _showToast(`${succeeded.length} image${succeeded.length > 1 ? "s" : ""} uploaded`, "success");
    } else if (succeeded.length === 0) {
      _els.poolUploadStatus.textContent = `All ${failed.length} uploads failed`;
      _showToast(`Upload failed: ${failed.map(f => f.name).join(", ")}`, "error");
    } else {
      _els.poolUploadStatus.textContent = `${succeeded.length} uploaded, ${failed.length} failed`;
      _showToast(`${succeeded.length} uploaded, ${failed.length} failed: ${failed.map(f => f.name).join(", ")}`, "error");
    }

    setTimeout(() => { _els.poolUploadProgress.classList.add("hidden"); }, 3000);

    await loadAssets();
    if (succeeded.length > 0) openTagModal(succeeded[0]);
  } catch (err) {
    console.error("[Image Pool] Upload failed:", err);
    _els.poolUploadProgress.classList.add("hidden");
    _showToast("Upload failed: " + (err.message || err), "error");
  }
}

function renderAssetGrid(assets) {
  if (!assets.length) {
    const emptyMsg = _state.poolFilter !== "all" || _state.poolSearch
      ? "No images match your filters"
      : "No images yet — upload to get started";
    _els.assetGrid.innerHTML = `<div class="col-span-full p-8 text-center text-gray-400"><p>${emptyMsg}</p></div>`;
    return;
  }

  _els.assetGrid.innerHTML = assets.map(asset => {
    const imageUrl = asset.original_image_path ? getPublicUrl(asset.original_image_path) : "/imgs/placeholder.jpg";
    const productName = asset.product?.name || "";
    const usedCount = asset.used_count || 0;
    const shotType = asset.shot_type || "";
    const quality = asset.quality_score || 3;
    const isReady = !!(asset.product_id && asset.shot_type);
    const badgeClass = usedCount === 0 ? "unused" : "";
    const badgeText = usedCount === 0 ? "NEW" : `×${usedCount}`;
    const stars = "★".repeat(quality) + "☆".repeat(5 - quality);
    const borderClass = isReady ? "" : "asset-incomplete";
    const readyIndicator = isReady
      ? `<span class="asset-ready-dot" title="Ready for autopilot">✓</span>`
      : `<span class="asset-incomplete-dot" title="Needs product + shot type">!</span>`;

    return `
      <div class="asset-card ${borderClass}" data-asset-id="${asset.id}">
        ${readyIndicator}
        <span class="asset-used-badge ${badgeClass}">${badgeText}</span>
        <img src="${imageUrl}" alt="${productName}" loading="lazy" onerror="this.src='/imgs/placeholder.jpg'">
        <div class="asset-card-overlay">
          <div class="asset-card-info">
            ${productName ? `<div class="font-medium">${productName}</div>` : `<div class="font-medium text-yellow-300">⚠ No product</div>`}
            ${shotType ? `<span class="asset-shot-pill">${shotType}</span>` : `<span class="asset-shot-pill" style="background:rgba(239,68,68,0.85);color:#fff">needs tag</span>`}
            <div class="asset-quality-stars">${stars}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  _els.assetGrid.querySelectorAll(".asset-card").forEach(card => {
    card.addEventListener("click", () => {
      const assetId = card.dataset.assetId;
      const asset = assets.find(a => a.id === assetId);
      if (asset) openTagModal(asset);
    });
  });
}

// ─── Tagging Modal ───

function setupTagModal() {
  _els.tagModalClose?.addEventListener("click", closeTagModal);
  _els.tagCancelBtn?.addEventListener("click", closeTagModal);
  _els.tagModal?.addEventListener("click", (e) => {
    if (e.target === _els.tagModal) closeTagModal();
  });

  _els.tagQualityStars?.addEventListener("click", (e) => {
    const btn = e.target.closest(".star-btn");
    if (!btn) return;
    const score = parseInt(btn.dataset.score);
    _state.tagQualityScore = score;
    renderTagStars(score);
  });

  let productSearchTimer;
  _els.tagProductSearch?.addEventListener("input", (e) => {
    clearTimeout(productSearchTimer);
    productSearchTimer = setTimeout(() => {
      const q = e.target.value.trim().toLowerCase();
      if (q.length < 2) { _els.tagProductDropdown.classList.add("hidden"); return; }
      const matches = _state.products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) { _els.tagProductDropdown.classList.add("hidden"); return; }
      _els.tagProductDropdown.innerHTML = matches.map(p => `
        <div class="tag-product-option px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm" data-id="${p.id}">${p.name}</div>
      `).join("");
      _els.tagProductDropdown.classList.remove("hidden");

      _els.tagProductDropdown.querySelectorAll(".tag-product-option").forEach(opt => {
        opt.addEventListener("click", () => selectTagProduct(opt.dataset.id, opt.textContent));
      });
    }, 200);
  });

  _els.tagClearProduct?.addEventListener("click", () => {
    _state.tagProductIdValue = null;
    _els.tagProductId.value = "";
    _els.tagSelectedProduct.classList.add("hidden");
    _els.tagProductSearch.classList.remove("hidden");
    _els.tagProductSearch.value = "";
  });

  _els.tagSaveBtn?.addEventListener("click", saveTagModal);

  _els.tagDeleteBtn?.addEventListener("click", async () => {
    if (!_state.tagEditAsset) return;
    if (!confirm("Delete this image from the pool?")) return;
    try {
      await deleteAsset(_state.tagEditAsset.id);
      closeTagModal();
      _showToast("Image deleted", "success");
      loadAssets();
    } catch (err) {
      _showToast("Delete failed", "error");
    }
  });
}

function selectTagProduct(id, name) {
  _state.tagProductIdValue = id;
  _els.tagProductId.value = id;
  _els.tagProductSearch.classList.add("hidden");
  _els.tagProductDropdown.classList.add("hidden");
  _els.tagSelectedProduct.classList.remove("hidden");
  _els.tagSelectedProductName.textContent = name;
}

function renderTagStars(score) {
  _els.tagQualityLabel.textContent = `(${score}/5)`;
  _els.tagQualityStars.querySelectorAll(".star-btn").forEach(btn => {
    const s = parseInt(btn.dataset.score);
    btn.classList.toggle("text-yellow-400", s <= score);
    btn.classList.toggle("text-gray-300", s > score);
  });
}

function openTagModal(asset) {
  _state.tagEditAsset = asset;

  const imageUrl = asset.original_image_path ? getPublicUrl(asset.original_image_path) : "/imgs/placeholder.jpg";
  _els.tagPreviewImg.src = imageUrl;
  _els.tagShotType.value = asset.shot_type || "";

  const quality = asset.quality_score || 3;
  _state.tagQualityScore = quality;
  renderTagStars(quality);

  if (asset.product_id && asset.product) {
    selectTagProduct(asset.product_id, asset.product.name);
  } else {
    _state.tagProductIdValue = null;
    _els.tagProductId.value = "";
    _els.tagSelectedProduct.classList.add("hidden");
    _els.tagProductSearch.classList.remove("hidden");
    _els.tagProductSearch.value = "";
    _els.tagProductDropdown.classList.add("hidden");
  }

  _els.tagModal.classList.remove("hidden");
  _els.tagModal.classList.add("flex");
}

function closeTagModal() {
  _els.tagModal.classList.add("hidden");
  _els.tagModal.classList.remove("flex");
  _state.tagEditAsset = null;
}

async function saveTagModal() {
  if (!_state.tagEditAsset) return;

  const tags = {
    shot_type: _els.tagShotType.value || null,
    product_id: _state.tagProductIdValue || null,
    quality_score: _state.tagQualityScore
  };

  _els.tagSaveBtn.disabled = true;
  _els.tagSaveBtn.textContent = "Saving...";

  try {
    await updateAssetTags(_state.tagEditAsset.id, tags);
    closeTagModal();
    _showToast("Tags saved", "success");
    loadAssets();
  } catch (err) {
    console.error("[Tag Modal] Save failed:", err);
    _showToast("Failed to save tags", "error");
  } finally {
    _els.tagSaveBtn.disabled = false;
    _els.tagSaveBtn.textContent = "Save Tags";
  }
}

export async function loadAssets() {
  try {
    _state.poolAssets = await fetchAssets({
      filter: _state.poolFilter,
      search: _state.poolSearch
    });
    renderAssetGrid(_state.poolAssets);
  } catch (err) {
    console.error("[Image Pool] Load failed:", err);
    _showToast("Failed to load images", "error");
  }
}
