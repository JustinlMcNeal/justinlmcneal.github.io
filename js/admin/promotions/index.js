import { initNavbar } from "../../shared/navbar.js";
import { requireAdmin } from "../../shared/guard.js";

import { fetchPromotions } from "./api.js";
import { state } from "./state.js";
import { renderTable } from "./renderTable.js";
import { bindModal } from "./modalEditor.js";
import { $ } from "./dom.js";

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await initNavbar();
  } catch (e) {
    console.error("[Admin Promotions] initNavbar failed:", e);
  }

  boot();
});

function boot() {
  const els = {
    // optional status element (recommended, but not required)
    status: document.getElementById("admin_status") || document.getElementById("promo_status"),

    searchInput: $("searchInput"),
    countLabel: $("countLabel"),
    btnNew: $("btnNew"),
    promotionRows: $("promotionRows"),

    modal: $("modal"),
    modalTitle: $("modalTitle"),
    btnClose: $("btnClose"),
    btnSave: $("btnSave"),
    btnDelete: $("btnDelete"),
    modalMsg: $("modalMsg"),

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
    fDescription: $("fDescription"),

    // homepage banner path field (you mentioned this)
    fBannerImage: $("fBannerImage"),
  };

  let isAdmin = false;

  // Modal binding (only used when admin)
  const modal = bindModal(els, () => refreshTable());

  async function loadData() {
    state.promotions = await fetchPromotions();
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

  function refreshTable() {
    renderTable({
      promotionRowsEl: els.promotionRows,
      countLabelEl: els.countLabel,
      searchValue: els.searchInput?.value || "",
      onEdit: isAdmin ? (id) => modal.openEdit(id) : null,
      onEditError: (err) => console.warn("[Admin Promotions] Edit failed:", err),
      readOnly: !isAdmin,
    });
  }

  function wire() {
    els.searchInput?.addEventListener("input", refreshTable);

    els.btnNew?.addEventListener("click", () => {
      if (!isAdmin) return;
      modal.openNew();
    });

    // Re-render when breakpoint changes (optional but nice)
    window.matchMedia("(max-width: 768px)").addEventListener("change", refreshTable);
  }

  (async () => {
    try {
      wire();

      if (els.status) els.status.textContent = "Loading promotions…";
      await loadData();

      // admin check AFTER load so page still shows data in read-only
      if (els.status) els.status.textContent = "Checking admin session…";
      const check = await requireAdmin();
      isAdmin = !!check.ok;

      setReadOnlyUI(!isAdmin);

      // re-render so Edit buttons hide if not admin
      refreshTable();

      if (els.status) {
        els.status.textContent = isAdmin ? "" : (check.reason || "Read-only mode.");
      } else {
        if (!isAdmin) console.warn("[Admin Promotions]", check.reason);
      }
    } catch (err) {
      console.error("[Admin Promotions] boot failed:", err);
      if (els.status) els.status.textContent = `Failed to load: ${err?.message || err}`;
    }
  })();
}
