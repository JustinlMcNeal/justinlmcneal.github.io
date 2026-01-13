// /js/admin/promotions/modalEditor.js

import {
  fetchPromotionFull,
  fetchPromotions,
  upsertPromotion,
  deletePromotion,
  fetchCategories,
  fetchTags,
  fetchProducts,
  uploadBannerFile,
  formatFileSize,
} from "./api.js";

import { state } from "./state.js";
import { show, setMsg } from "./dom.js";

export function bindModal(els, refreshTable) {
  /* Store scope data for modal */
  let scopeOptions = {
    categories: [],
    tags: [],
    products: [],
  };

  /* ---------------- helpers ---------------- */

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
  }

  async function loadScopeOptions() {
    try {
      const [cats, tgs, prods] = await Promise.all([
        fetchCategories(),
        fetchTags(),
        fetchProducts(),
      ]);
      scopeOptions = { categories: cats || [], tags: tgs || [], products: prods || [] };
    } catch (e) {
      console.error("Error loading scope options:", e);
      scopeOptions = { categories: [], tags: [], products: [] };
    }
  }

  function renderScopeSelect(options, selectedIds = []) {
    const selected = new Set((selectedIds || []).map((x) => String(x)));

    return (options || [])
      .map((opt) => {
        const id = String(opt.id);
        const checked = selected.has(id) ? "checked" : "";
        return `
          <label class="kk-border px-3 py-2 flex items-center gap-3 text-sm">
            <input data-scope-checkbox type="checkbox" value="${escapeHtml(id)}" ${checked} />
            <span class="font-black truncate">${escapeHtml(opt.name || "")}</span>
          </label>
        `;
      })
      .join("");
  }

  function getScopeEls() {
    return {
      catWrap: document.getElementById("scopeCategoriesWrap"),
      tagWrap: document.getElementById("scopeTagsWrap"),
      prodWrap: document.getElementById("scopeProductsWrap"),
      catSelect: document.getElementById("scopeCategoriesSelect"),
      tagSelect: document.getElementById("scopeTagsSelect"),
      prodSelect: document.getElementById("scopeProductsSelect"),
    };
  }

  async function updateScopeUI(scopeType = "all") {
    const s = getScopeEls();

    show(s.catWrap, scopeType === "category");
    show(s.tagWrap, scopeType === "tag");
    show(s.prodWrap, scopeType === "product");

    const selected = state.editing?.scope_data || [];

    if (scopeType === "category" && s.catSelect) {
      s.catSelect.innerHTML = renderScopeSelect(scopeOptions.categories, selected);
    } else if (scopeType === "tag" && s.tagSelect) {
      s.tagSelect.innerHTML = renderScopeSelect(scopeOptions.tags, selected);
    } else if (scopeType === "product" && s.prodSelect) {
      s.prodSelect.innerHTML = renderScopeSelect(scopeOptions.products, selected);
    }
  }

  function updateBOGOUI(bogoType = "product") {
    const productWrap = document.getElementById("bogoProductWrap");
    const categoryWrap = document.getElementById("bogoCategoryWrap");
    const tagWrap = document.getElementById("bogoTagWrap");

    show(productWrap, bogoType === "product");
    show(categoryWrap, bogoType === "category");
    show(tagWrap, bogoType === "tag");

    if (bogoType === "product") {
      const select = document.getElementById("fBOGOProduct");
      if (!select) return;
      select.innerHTML =
        `<option value="">-- Choose product --</option>` +
        scopeOptions.products
          .map((p) => `<option value="${p.id}">${escapeHtml(p.name || "")}</option>`)
          .join("");
      if (state.editing?.bogo_reward_id) select.value = state.editing.bogo_reward_id;
    }

    if (bogoType === "category") {
      const select = document.getElementById("fBOGOCategory");
      if (!select) return;
      select.innerHTML =
        `<option value="">-- Choose category --</option>` +
        scopeOptions.categories
          .map((c) => `<option value="${c.id}">${escapeHtml(c.name || "")}</option>`)
          .join("");
      if (state.editing?.bogo_reward_id) select.value = state.editing.bogo_reward_id;
    }

    if (bogoType === "tag") {
      const select = document.getElementById("fBOGOTag");
      if (!select) return;
      select.innerHTML =
        `<option value="">-- Choose tag --</option>` +
        scopeOptions.tags
          .map((t) => `<option value="${t.id}">${escapeHtml(t.name || "")}</option>`)
          .join("");
      if (state.editing?.bogo_reward_id) select.value = state.editing.bogo_reward_id;
    }
  }

  // ---------- Banner helpers ----------
  function normalizeBannerPath(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    return s.startsWith("/") ? s : `/${s}`;
  }

  function isVideoPath(path) {
    const p = String(path || "").toLowerCase();
    return p.endsWith(".mp4") || p.endsWith(".webm") || p.endsWith(".mov");
  }

  function isGifPath(path) {
    return String(path || "").toLowerCase().endsWith(".gif");
  }

  function setBannerPreview(rawPath, fileSize = null) {
    const previewWrap = document.getElementById("promoBannerPreviewWrap");
    const previewImg = document.getElementById("promoBannerPreviewImg");
    const previewVideo = document.getElementById("promoBannerPreviewVideo");
    const previewSizeEl = document.getElementById("promoBannerPreviewSize");
    
    if (!previewImg || !previewVideo) return;

    const path = String(rawPath ?? "").trim();
    if (!path) {
      previewImg.src = "";
      previewVideo.src = "";
      show(previewImg, false);
      show(previewVideo, false);
      if (previewWrap) show(previewWrap, false);
      if (previewSizeEl) previewSizeEl.textContent = "";
      return;
    }

    const normalizedPath = normalizeBannerPath(path) || "";
    const isVideo = isVideoPath(path);
    
    // Show appropriate preview element
    if (isVideo) {
      previewVideo.src = normalizedPath;
      previewImg.src = "";
      show(previewImg, false);
      show(previewVideo, true);
    } else {
      // Image or GIF
      previewImg.src = normalizedPath;
      previewVideo.src = "";
      show(previewImg, true);
      show(previewVideo, false);
    }
    
    if (previewWrap) show(previewWrap, true);
    
    // Show file size if provided
    if (previewSizeEl) {
      if (fileSize) {
        previewSizeEl.textContent = formatFileSize(fileSize);
      } else {
        previewSizeEl.textContent = "";
      }
    }
  }

  // Track pending file upload
  let pendingBannerFile = null;
  let pendingBannerUrl = null;

  function showFileInfo(file) {
    const fileInfo = document.getElementById("promoBannerFileInfo");
    const fileName = document.getElementById("promoBannerFileName");
    const fileSize = document.getElementById("promoBannerFileSize");
    const fileIcon = document.getElementById("promoBannerFileIcon");
    
    if (!fileInfo || !file) {
      if (fileInfo) show(fileInfo, false);
      return;
    }
    
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    
    // Update icon based on file type
    const isVideo = file.type.startsWith("video/");
    if (isVideo) {
      fileIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>`;
    } else {
      fileIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>`;
    }
    
    show(fileInfo, true);
  }

  function clearFileInfo() {
    const fileInfo = document.getElementById("promoBannerFileInfo");
    if (fileInfo) show(fileInfo, false);
    pendingBannerFile = null;
    pendingBannerUrl = null;
  }

  async function handleFileSelect(file) {
    if (!file) return;
    
    // Validate file size (50MB max)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      setMsg(els.modalMsg, `File too large. Max size is 50MB. Your file is ${formatFileSize(file.size)}`, true);
      return;
    }
    
    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"];
    if (!validTypes.includes(file.type)) {
      setMsg(els.modalMsg, "Invalid file type. Please upload an image (JPG, PNG, WebP, GIF) or video (MP4, WebM).", true);
      return;
    }
    
    // Store for later upload
    pendingBannerFile = file;
    
    // Show file info
    showFileInfo(file);
    
    // Create local preview URL
    const localUrl = URL.createObjectURL(file);
    pendingBannerUrl = localUrl;
    
    // Clear the URL input since we're using file
    const bannerEl = document.getElementById("fBannerImage");
    if (bannerEl) bannerEl.value = "";
    
    // Show preview
    setBannerPreview(localUrl, file.size);
  }

  async function uploadPendingFile() {
    if (!pendingBannerFile) return null;
    
    const progressEl = document.getElementById("promoBannerUploadProgress");
    
    try {
      if (progressEl) show(progressEl, true);
      
      const result = await uploadBannerFile(pendingBannerFile);
      
      // Clean up
      if (pendingBannerUrl) URL.revokeObjectURL(pendingBannerUrl);
      pendingBannerFile = null;
      pendingBannerUrl = null;
      
      return result.url;
    } finally {
      if (progressEl) show(progressEl, false);
    }
  }

  function lockScroll(yes) {
    document.body.style.overflow = yes ? "hidden" : "";
  }

  function openModal() {
    setMsg(els.modalMsg, "", false);
    show(els.modal, true);
    els.modal.setAttribute("aria-hidden", "false");
    lockScroll(true);
  }

  function closeModal() {
    show(els.modal, false);
    els.modal.setAttribute("aria-hidden", "true");
    lockScroll(false);
    state.editing = null;
  }

  function getSelectedScopeIds() {
    const checked = document.querySelectorAll('[data-scope-checkbox]:checked');
    return Array.from(checked).map((cb) => String(cb.value));
  }

  /* ---------------- flows ---------------- */

  async function openEdit(promotionId) {
    try {
      await loadScopeOptions();

      // Clear any pending file from previous edits
      clearFileInfo();
      const fileInput = document.getElementById("fBannerFile");
      if (fileInput) fileInput.value = "";

      els.modalTitle.textContent = "Edit Promotion";
      setMsg(els.modalMsg, "Loading promotion…", false);
      openModal();

      const full = await fetchPromotionFull(promotionId);
      state.editing = full;

      els.modalTitle.textContent = `Edit · ${full.name || ""}`;

      els.fName.value = full.name || "";
      els.fCode.value = full.code || "";
      els.fType.value = full.type || "percentage";
      els.fValue.value = full.value ?? "";
      els.fMinOrder.value = full.min_order_amount ?? "";
      els.fUsageLimit.value = full.usage_limit ?? "";
      els.fActive.checked = !!full.is_active;
      els.fPublic.checked = !!full.is_public;
      els.fDescription.value = full.description || "";

      // Banner
      const bannerEl = els.fBannerImage || document.getElementById("fBannerImage");
      if (bannerEl) bannerEl.value = full.banner_image_path || "";
      setBannerPreview(full.banner_image_path || "");

      // Scope
      const scopeTypeEl = document.getElementById("fScopeType");
      if (scopeTypeEl) scopeTypeEl.value = full.scope_type || "all";
      await updateScopeUI(full.scope_type || "all");

      // BOGO
      const bogoSection = document.getElementById("bogoSection");
      const isBOGO = (full.type || "") === "bogo";
      show(bogoSection, isBOGO);
      if (isBOGO) {
        const bogoTypeSelect = document.getElementById("fBOGOType");
        if (bogoTypeSelect) {
          bogoTypeSelect.value = full.bogo_reward_type || "product";
          updateBOGOUI(full.bogo_reward_type || "product");
        }
      }

      // Dates -> datetime-local
      els.fStartDate.value = full.start_date
        ? new Date(full.start_date).toISOString().slice(0, 16)
        : "";
      els.fEndDate.value = full.end_date
        ? new Date(full.end_date).toISOString().slice(0, 16)
        : "";

      setMsg(els.modalMsg, "", false);
    } catch (e) {
      console.error(e);
      setMsg(
        els.modalMsg,
        `Could not load promotion details.\n\n${e?.message || e}`,
        true
      );
      openModal();
      throw e;
    }
  }

  function openNew() {
    loadScopeOptions();

    // Clear any pending file
    clearFileInfo();
    const fileInput = document.getElementById("fBannerFile");
    if (fileInput) fileInput.value = "";

    state.editing = {
      id: null,
      name: "",
      code: "",
      type: "percentage",
      value: 0,
      min_order_amount: 0,
      usage_limit: null,
      start_date: null,
      end_date: null,
      is_active: true,
      is_public: true,
      description: "",
      scope_type: "all",
      scope_data: [],
      banner_image_path: null,
    };

    els.modalTitle.textContent = "Add Promotion";

    els.fName.value = "";
    els.fCode.value = "";
    els.fType.value = "percentage";
    els.fValue.value = "";
    els.fMinOrder.value = "";
    els.fUsageLimit.value = "";
    els.fActive.checked = true;
    els.fPublic.checked = true;
    els.fDescription.value = "";
    els.fStartDate.value = "";
    els.fEndDate.value = "";

    const bannerEl = els.fBannerImage || document.getElementById("fBannerImage");
    if (bannerEl) bannerEl.value = "";
    setBannerPreview("");

    const scopeTypeEl = document.getElementById("fScopeType");
    if (scopeTypeEl) scopeTypeEl.value = "all";
    updateScopeUI("all");

    show(document.getElementById("bogoSection"), false);

    openModal();
  }

  async function save() {
    try {
      setMsg(els.modalMsg, "", false);

      const name = els.fName.value.trim();
      if (!name) throw new Error("Name is required.");

      // code optional
      const rawCode = els.fCode.value.trim();
      const code = rawCode ? rawCode.toUpperCase() : null;

      // Handle banner - either uploaded file or URL
      let banner_image_path = null;
      
      if (pendingBannerFile) {
        // Upload the file first
        setMsg(els.modalMsg, "Uploading banner...", false);
        banner_image_path = await uploadPendingFile();
      } else {
        // Use the URL input
        const bannerEl = els.fBannerImage || document.getElementById("fBannerImage");
        banner_image_path = normalizeBannerPath(bannerEl ? bannerEl.value : null);
      }

      const scopeType = (document.getElementById("fScopeType")?.value || "all").trim();
      const scopeData = scopeType === "all" ? [] : getSelectedScopeIds();

      const payload = {
        name,
        code,
        banner_image_path,
        type: els.fType.value || "percentage",
        value: Number(els.fValue.value || 0),
        min_order_amount: els.fMinOrder.value ? Number(els.fMinOrder.value) : 0,
        usage_limit: els.fUsageLimit.value ? Number(els.fUsageLimit.value) : null,
        start_date: els.fStartDate.value ? new Date(els.fStartDate.value).toISOString() : null,
        end_date: els.fEndDate.value ? new Date(els.fEndDate.value).toISOString() : null,
        is_active: !!els.fActive.checked,
        is_public: !!els.fPublic.checked,
        description: els.fDescription.value.trim() || null,
        scope_type: scopeType,
        scope_data: scopeData,
      };

      if (state.editing?.id) payload.id = state.editing.id;

      // BOGO reward fields if needed
      if (els.fType.value === "bogo") {
        const bogoType = document.getElementById("fBOGOType")?.value || "product";
        let bogoRewardId = "";

        if (bogoType === "product") bogoRewardId = document.getElementById("fBOGOProduct")?.value || "";
        if (bogoType === "category") bogoRewardId = document.getElementById("fBOGOCategory")?.value || "";
        if (bogoType === "tag") bogoRewardId = document.getElementById("fBOGOTag")?.value || "";

        if (!bogoRewardId) throw new Error("Please select a free reward item.");

        payload.bogo_reward_type = bogoType;
        payload.bogo_reward_id = bogoRewardId;
      }

      await upsertPromotion(payload);
      state.promotions = await fetchPromotions();
      refreshTable();
      closeModal();
    } catch (e) {
      console.error(e);
      setMsg(els.modalMsg, String(e?.message || e), true);
    }
  }

  async function deletePromo() {
    if (!state.editing?.id) return;
    const ok = confirm("Delete this promotion? This cannot be undone.");
    if (!ok) return;

    try {
      await deletePromotion(state.editing.id);
      state.promotions = await fetchPromotions();
      refreshTable();
      closeModal();
    } catch (e) {
      console.error(e);
      setMsg(els.modalMsg, String(e?.message || e), true);
    }
  }

  /* ---------------- events ---------------- */

  els.btnSave.addEventListener("click", save);
  els.btnClose.addEventListener("click", closeModal);
  els.btnDelete?.addEventListener("click", deletePromo);

  // Live banner preview
  const bannerEl = els.fBannerImage || document.getElementById("fBannerImage");
  if (bannerEl) {
    bannerEl.addEventListener("input", () => {
      clearFileInfo(); // Clear file if user types URL
      setBannerPreview(bannerEl.value);
    });
    bannerEl.addEventListener("change", () => {
      clearFileInfo();
      setBannerPreview(bannerEl.value);
    });
  }

  // File upload handler
  const fileInput = document.getElementById("fBannerFile");
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    });
  }

  // Remove file button
  const removeFileBtn = document.getElementById("promoBannerRemoveFile");
  if (removeFileBtn) {
    removeFileBtn.addEventListener("click", () => {
      clearFileInfo();
      setBannerPreview("");
      const fileInput = document.getElementById("fBannerFile");
      if (fileInput) fileInput.value = "";
    });
  }

  // Scope type change
  document.getElementById("fScopeType")?.addEventListener("change", (e) => {
    updateScopeUI(e.target.value);
  });

  // Promo type change -> show/hide BOGO
  document.getElementById("fType")?.addEventListener("change", (e) => {
    const bogoSection = document.getElementById("bogoSection");
    const isBOGO = e.target.value === "bogo";
    show(bogoSection, isBOGO);

    if (isBOGO) {
      const bogoTypeSelect = document.getElementById("fBOGOType");
      const bogoType = bogoTypeSelect?.value || "product";
      updateBOGOUI(bogoType);
    }
  });

  // BOGO reward type change
  document.getElementById("fBOGOType")?.addEventListener("change", (e) => {
    updateBOGOUI(e.target.value);
  });

  // Backdrop click to close
  els.modal.addEventListener("click", (e) => {
    const backdrop = e.target?.closest?.("[data-modal-backdrop]");
    if (backdrop) closeModal();
  });

  // Escape to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.modal.classList.contains("hidden")) closeModal();
  });

  return { openEdit, openNew };
}
