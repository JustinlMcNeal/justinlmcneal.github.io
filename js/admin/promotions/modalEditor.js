import {
  fetchPromotionFull,
  fetchPromotions,
  upsertPromotion,
  deletePromotion,
  togglePromotionActive,
  fetchCategories,
  fetchTags,
  fetchProducts,
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

  /* Helper to load scope options on modal open */
  async function loadScopeOptions() {
    try {
      const [cats, tgs, prods] = await Promise.all([
        fetchCategories(),
        fetchTags(),
        fetchProducts(),
      ]);
      scopeOptions = { categories: cats, tags: tgs, products: prods };
    } catch (e) {
      console.error("Error loading scope options:", e);
    }
  }

  /* Helper to render scope select options */
  function renderScopeSelect(options, selectedIds = []) {
    return options
      .map(
        (opt) => `
      <label>
        <input type="checkbox" value="${opt.id}" ${selectedIds.includes(opt.id) ? "checked" : ""} />
        ${escapeHtml(opt.name)}
      </label>
    `
      )
      .join("");
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /* Helper to update scope visibility and content */
  async function updateScopeUI(scopeType = "all") {
    const catWrap = document.getElementById("scopeCategoriesWrap");
    const tagWrap = document.getElementById("scopeTagsWrap");
    const prodWrap = document.getElementById("scopeProductsWrap");

    show(catWrap, scopeType === "category");
    show(tagWrap, scopeType === "tag");
    show(prodWrap, scopeType === "product");

    if (scopeType === "category") {
      document.getElementById("scopeCategoriesSelect").innerHTML = renderScopeSelect(
        scopeOptions.categories,
        state.editing?.scope_data || []
      );
    } else if (scopeType === "tag") {
      document.getElementById("scopeTagsSelect").innerHTML = renderScopeSelect(
        scopeOptions.tags,
        state.editing?.scope_data || []
      );
    } else if (scopeType === "product") {
      document.getElementById("scopeProductsSelect").innerHTML = renderScopeSelect(
        scopeOptions.products,
        state.editing?.scope_data || []
      );
    }
  }

  /* Helper to update BOGO UI based on reward type */
  function updateBOGOUI(bogoType = "product") {
    const productWrap = document.getElementById("bogoProductWrap");
    const categoryWrap = document.getElementById("bogoCategoryWrap");
    const tagWrap = document.getElementById("bogoTagWrap");

    show(productWrap, bogoType === "product");
    show(categoryWrap, bogoType === "category");
    show(tagWrap, bogoType === "tag");

    // Populate selects
    if (bogoType === "product") {
      const select = document.getElementById("fBOGOProduct");
      select.innerHTML =
        `<option value="">-- Choose product --</option>` +
        scopeOptions.products
          .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
          .join("");
      if (state.editing?.bogo_reward_id) select.value = state.editing.bogo_reward_id;
    } else if (bogoType === "category") {
      const select = document.getElementById("fBOGOCategory");
      select.innerHTML =
        `<option value="">-- Choose category --</option>` +
        scopeOptions.categories
          .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
          .join("");
      if (state.editing?.bogo_reward_id) select.value = state.editing.bogo_reward_id;
    } else if (bogoType === "tag") {
      const select = document.getElementById("fBOGOTag");
      select.innerHTML =
        `<option value="">-- Choose tag --</option>` +
        scopeOptions.tags
          .map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
          .join("");
      if (state.editing?.bogo_reward_id) select.value = state.editing.bogo_reward_id;
    }
  }

  // ---------- Banner helpers ----------
  function getBannerInputEl() {
    return els.fBannerImage || document.getElementById("fBannerImage");
  }

  function normalizeBannerPath(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return null;

    // allow full URLs
    if (/^https?:\/\//i.test(s)) return s;

    // ensure leading slash for GitHub Pages paths
    return s.startsWith("/") ? s : `/${s}`;
  }

  function setBannerPreview(rawPath) {
    const previewWrap = document.getElementById("promoBannerPreviewWrap");
    const previewImg = document.getElementById("promoBannerPreviewImg");

    // Preview is optional — no crash if not present
    if (!previewImg) return;

    const path = String(rawPath ?? "").trim();

    if (!path) {
      previewImg.src = "";
      if (previewWrap) show(previewWrap, false);
      return;
    }

    previewImg.src = normalizeBannerPath(path) || "";
    if (previewWrap) show(previewWrap, true);
  }

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

  /* ---------------- Modal Flows ---------------- */

  async function openEdit(promotionId) {
    try {
      await loadScopeOptions();

      els.modalTitle.textContent = "Edit Promotion";
      setMsg(els.modalMsg, "Loading promotion…", false);
      show(els.modal, true);
      els.modal.classList.add("is-open");

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

      // Banner image path
      const bannerEl = getBannerInputEl();
      if (bannerEl) bannerEl.value = full.banner_image_path || "";
      setBannerPreview(full.banner_image_path || "");

      // Set scope
      document.getElementById("fScopeType").value = full.scope_type || "all";
      await updateScopeUI(full.scope_type || "all");

      // Set BOGO product if applicable
      if (full.type === "bogo") {
        const bogoTypeSelect = document.getElementById("fBOGOType");
        bogoTypeSelect.value = full.bogo_reward_type || "product";
        updateBOGOUI(full.bogo_reward_type || "product");
      }

      // Format dates for datetime-local input
      if (full.start_date) {
        els.fStartDate.value = new Date(full.start_date).toISOString().slice(0, 16);
      } else {
        els.fStartDate.value = "";
      }
      if (full.end_date) {
        els.fEndDate.value = new Date(full.end_date).toISOString().slice(0, 16);
      } else {
        els.fEndDate.value = "";
      }

      setMsg(els.modalMsg, "", false);
    } catch (e) {
      console.error(e);
      setMsg(
        els.modalMsg,
        `Could not load promotion details. Check console for error.\n\n${e?.message || e}`,
        true
      );
      show(els.modal, true);
      els.modal.classList.add("is-open");
      throw e;
    }
  }

  function openNew() {
    loadScopeOptions();

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

    // Banner image path
    const bannerEl = getBannerInputEl();
    if (bannerEl) bannerEl.value = "";
    setBannerPreview("");

    document.getElementById("fScopeType").value = "all";
    updateScopeUI("all");

    // Hide BOGO section for new promotion
    show(document.getElementById("bogoSection"), false);

    openModal();
  }

  /* Helper to get selected scope IDs */
  function getSelectedScopeIds() {
    const checkboxes = document.querySelectorAll(
      ".kk-scope-select-wrap input[type='checkbox']:checked"
    );
    return Array.from(checkboxes).map((cb) => cb.value);
  }

  async function save() {
    try {
      setMsg(els.modalMsg, "", false);

      const name = els.fName.value.trim();
      if (!name) throw new Error("Name is required.");

      // Code is optional now:
      const rawCode = els.fCode.value.trim();
      const code = rawCode ? rawCode.toUpperCase() : null;

      const bannerEl = getBannerInputEl();
      const banner_image_path = normalizeBannerPath(bannerEl ? bannerEl.value : null);

      const scopeType = document.getElementById("fScopeType").value || "all";
      const scopeData = scopeType === "all" ? [] : getSelectedScopeIds();

      const payload = {
        name,
        code,
        banner_image_path, // ✅ NEW
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

      // Only include id if we're updating an existing promotion
      if (state.editing?.id) {
        payload.id = state.editing.id;
      }

      // For BOGO, capture reward type and reward ID
      if (els.fType.value === "bogo") {
        const bogoType = document.getElementById("fBOGOType").value;
        let bogoRewardId;

        if (bogoType === "product") {
          bogoRewardId = document.getElementById("fBOGOProduct").value;
        } else if (bogoType === "category") {
          bogoRewardId = document.getElementById("fBOGOCategory").value;
        } else if (bogoType === "tag") {
          bogoRewardId = document.getElementById("fBOGOTag").value;
        }

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
      setMsg(els.modalMsg, String(e.message || e), true);
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
      setMsg(els.modalMsg, String(e.message || e), true);
    }
  }

  /* ---------------- Events ---------------- */

  els.btnSave.addEventListener("click", save);
  els.btnClose.addEventListener("click", closeModal);
  els.btnDelete?.addEventListener("click", deletePromo);

  /* Live banner preview while typing */
  const bannerEl = getBannerInputEl();
  if (bannerEl) {
    bannerEl.addEventListener("input", () => {
      setBannerPreview(bannerEl.value);
    });
    bannerEl.addEventListener("change", () => {
      setBannerPreview(bannerEl.value);
    });
  }

  /* Scope type change */
  document.getElementById("fScopeType").addEventListener("change", (e) => {
    updateScopeUI(e.target.value);
  });

  // Promotion type change - show/hide BOGO section
  document.getElementById("fType").addEventListener("change", (e) => {
    const bogoSection = document.getElementById("bogoSection");
    const isBOGO = e.target.value === "bogo";
    show(bogoSection, isBOGO);

    // Initialize BOGO UI if showing
    if (isBOGO) {
      const bogoTypeSelect = document.getElementById("fBOGOType");
      const bogoType = bogoTypeSelect.value || "product";
      updateBOGOUI(bogoType);
    }
  });

  // BOGO reward type change
  document.getElementById("fBOGOType").addEventListener("change", (e) => {
    updateBOGOUI(e.target.value);
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
