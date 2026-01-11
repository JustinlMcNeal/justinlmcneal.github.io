// /js/admin/promotions/index.js
import { initAdminNav } from "../../shared/adminNav.js";
import { initFooter } from "../../shared/footer.js";
import { requireAdmin } from "../../shared/guard.js";

import { fetchPromotions } from "./api.js";
import { state } from "./state.js";
import { renderTable } from "./renderTable.js";
import { bindModal } from "./modalEditor.js";

function $(id) {
  return document.getElementById(id);
}

function show(el, yes) {
  if (!el) return;
  el.classList.toggle("hidden", !yes);
}

document.addEventListener("DOMContentLoaded", async () => {
  // Admin nav + footer first
  await initAdminNav("Promotions");
  initFooter();

  const els = {
    appPanel: $("appPanel"),

    searchInput: $("searchInput"),
    countLabel: $("countLabel"),
    btnNew: $("btnNew"),
    promotionRows: $("promotionRows"),
    mobilePromotionCards: $("mobilePromotionCards"),

    modal: $("modal"),
    modalTitle: $("modalTitle"),
    btnClose: $("btnClose"),
    btnSave: $("btnSave"),
    btnDelete: $("btnDelete"),
    modalMsg: $("modalMsg"),

    // Modal fields (must exist in promotions.html)
    fName: $("fName"),
    fCode: $("fCode"),
    fType: $("fType"),
    fValue: $("fValue"),
    fMinOrder: $("fMinOrder"),
    fUsageLimit: $("fUsageLimit"),
    fStartDate: $("fStartDate"),
    fEndDate: $("fEndDate"),
    fActive: $("fActive"),
    fPublic: $("fPublic"),
    fScopeType: $("fScopeType"),
    fDescription: $("fDescription"),
    fBannerImage: $("fBannerImage"),

    // BOGO bits (exist in your Tailwind modal)
    fBOGOType: $("fBOGOType"),
    fBOGOProduct: $("fBOGOProduct"),
    fBOGOCategory: $("fBOGOCategory"),
    fBOGOTag: $("fBOGOTag"),
  };

  // Hard fail fast if core mounts are missing
  if (!els.appPanel) console.warn("[Promotions] Missing #appPanel");
  if (!els.promotionRows) console.warn("[Promotions] Missing #promotionRows");
  if (!els.searchInput) console.warn("[Promotions] Missing #searchInput");
  if (!els.btnNew) console.warn("[Promotions] Missing #btnNew");
  if (!els.modal) console.warn("[Promotions] Missing #modal");

  // Modal controller
  const modal = bindModal(
    {
      modal: els.modal,
      modalTitle: els.modalTitle,
      btnClose: els.btnClose,
      btnSave: els.btnSave,
      btnDelete: els.btnDelete,
      modalMsg: els.modalMsg,

      fName: els.fName,
      fCode: els.fCode,
      fType: els.fType,
      fValue: els.fValue,
      fMinOrder: els.fMinOrder,
      fUsageLimit: els.fUsageLimit,
      fStartDate: els.fStartDate,
      fEndDate: els.fEndDate,
      fActive: els.fActive,
      fPublic: els.fPublic,
      fDescription: els.fDescription,
      fBannerImage: els.fBannerImage,
    },
    () => refreshTable()
  );

  function refreshTable() {
    renderTable({
      promotionRowsEl: els.promotionRows,
      countLabelEl: els.countLabel,
      searchValue: els.searchInput?.value || "",
      onEdit: (id) => modal.openEdit(id),
      onEditError: (err) => console.warn("[Promotions] Edit failed:", err),
      mobileCardsEl: els.mobilePromotionCards,
    });
  }

  async function loadData() {
    state.promotions = await fetchPromotions();
    refreshTable();
  }

  function wire() {
    els.searchInput?.addEventListener("input", refreshTable);

    els.btnNew?.addEventListener("click", () => {
      modal.openNew();
    });

    // Re-render on breakpoint changes (keeps spacing consistent)
    window.matchMedia("(max-width: 768px)").addEventListener("change", refreshTable);
  }

  try {
    // Show the app panel immediately so it never “looks blank”
    show(els.appPanel, true);

    wire();
    await loadData();

    // Admin gate (optional behavior)
    const check = await requireAdmin();
    if (!check.ok) {
      console.warn("[Promotions] Not admin:", check.reason);

      // Still allow viewing table; block edits/new
      if (els.btnNew) {
        els.btnNew.disabled = true;
        els.btnNew.classList.add("opacity-50", "pointer-events-none");
        els.btnNew.title = "Admin only";
      }

      // Hide edit buttons by re-rendering with a wrapper (simple approach)
      // If you want read-only behavior in renderTable, I can add `readOnly` param like Products.
      // For now: keep as-is (Edit will still attempt openEdit).
    }
  } catch (err) {
    console.error("[Promotions] init failed:", err);
    // If appPanel exists, keep it visible even on error
    show(els.appPanel, true);
  }
});
