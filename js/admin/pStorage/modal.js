import {
  splitTags, joinTags,
  numOrNull, intOrNull
} from "./dom.js";

export function bindModal({ els, api, state, onSaved, onDeleted, onStatus }) {
  // Close button
  els.btnClose?.addEventListener("click", () => closeModal(els));

  // Backdrop click (safe: supports either class)
  const backdrop =
    els.modal?.querySelector(".kk-admin-modal-backdrop") ||
    els.modal?.querySelector("[data-modal-backdrop]");

  backdrop?.addEventListener("click", () => closeModal(els));

  // Save
  els.btnSave?.addEventListener("click", async () => {
    try {
      onStatus?.("Saving…");
      const payload = readForm(els);
      if (!payload.name) return onStatus?.("Please enter an Item Name.");

      const saved = await api.upsert(payload);
      state.upsertLocal(saved);

      onSaved?.(saved);
      onStatus?.("Saved.");
      closeModal(els);
    } catch (e) {
      console.error(e);
      onStatus?.(`Save failed: ${e?.message || "Unknown error"}`);
    }
  });

  // Archive
  els.btnArchive?.addEventListener("click", async () => {
    const id = (els.fId?.value || "").trim();
    if (!id) return;

    const ok = confirm("Archive this item?");
    if (!ok) return;

    try {
      onStatus?.("Archiving…");
      const updated = await api.archive(id);
      state.upsertLocal(updated);

      onSaved?.(updated);
      onStatus?.("Archived.");
      closeModal(els);
    } catch (e) {
      console.error(e);
      onStatus?.(`Archive failed: ${e?.message || "Unknown error"}`);
    }
  });

  // Delete
  els.btnHardDelete?.addEventListener("click", async () => {
    const id = (els.fId?.value || "").trim();
    if (!id) return;

    const row = state.getById(id);
    const ok = confirm(`Delete "${row?.name || "this item"}" permanently?`);
    if (!ok) return;

    try {
      onStatus?.("Deleting…");
      await api.remove(id);
      state.removeLocal(id);

      onDeleted?.(id);
      onStatus?.("Deleted.");
      closeModal(els);
    } catch (e) {
      console.error(e);
      onStatus?.(`Delete failed: ${e?.message || "Unknown error"}`);
    }
  });
}

export function openModalForNew(els) {
  setTitle(els, "Add Item");
  writeForm(els, {
    id: "",
    name: "",
    product_id: "",
    url: "",
    stage: "idea",
    target_price: null,
    unit_cost: null,
    supplier_ship_per_unit: null,
    stcc: null,
    weight_g: null,
    bulk_qty: 30,
    tags: [],
    notes: ""
  });
  forceOpen(els);
}

export function openModalForEdit(els, row) {
  setTitle(els, "Edit Item");
  writeForm(els, row);
  forceOpen(els);
}

export function closeModal(els) {
  if (!els.modal) return;
  els.modal.classList.add("hidden");
  els.modal.setAttribute("aria-hidden", "true");
  els.modal.style.display = "none";
}

function forceOpen(els) {
  if (!els.modal) {
    console.error("[pStorage modal] modal element not found");
    return;
  }

  // Force visible even if CSS is fighting us
  els.modal.classList.remove("hidden");
  els.modal.setAttribute("aria-hidden", "false");
  els.modal.style.display = "block";

  // Helpful debug
  console.log("[pStorage modal] opened", {
    hiddenClass: els.modal.classList.contains("hidden"),
    ariaHidden: els.modal.getAttribute("aria-hidden"),
    display: getComputedStyle(els.modal).display
  });
}

function setTitle(els, text) {
  if (els.modalTitle) els.modalTitle.textContent = text;
}

function readForm(els) {
  const id = (els.fId?.value || "").trim();

  const payload = {
    name: (els.fName?.value || "").trim() || null,
    product_id: (els.fProductId?.value || "").trim() || null,
    url: (els.fUrl?.value || "").trim() || null,
    stage: (els.fStage?.value || "idea").trim(),

    target_price: numOrNull(els.fTargetPrice?.value),
    unit_cost: numOrNull(els.fUnitCost?.value),
    supplier_ship_per_unit: numOrNull(els.fSupplierShip?.value),
    stcc: numOrNull(els.fStcc?.value),

    weight_g: intOrNull(els.fWeightG?.value),
    bulk_qty: intOrNull(els.fBulkQty?.value) ?? 30,

    tags: splitTags(els.fTags?.value),
    notes: (els.fNotes?.value || "").trim() || null,
  };

  if (id) payload.id = id;
  return payload;
}

function writeForm(els, row) {
  if (!row) row = {};

  if (els.fId) els.fId.value = row.id || "";
  if (els.fName) els.fName.value = row.name || "";
  if (els.fProductId) els.fProductId.value = row.product_id || "";
  if (els.fUrl) els.fUrl.value = row.url || "";
  if (els.fStage) els.fStage.value = row.stage || "idea";
  if (els.fTags) els.fTags.value = joinTags(row.tags);

  if (els.fTargetPrice) els.fTargetPrice.value = val(row.target_price);
  if (els.fUnitCost) els.fUnitCost.value = val(row.unit_cost);
  if (els.fSupplierShip) els.fSupplierShip.value = val(row.supplier_ship_per_unit);
  if (els.fStcc) els.fStcc.value = val(row.stcc);
  if (els.fWeightG) els.fWeightG.value = val(row.weight_g);
  if (els.fBulkQty) els.fBulkQty.value = String(row.bulk_qty ?? 30);

  if (els.fNotes) els.fNotes.value = row.notes || "";
}

function val(v) {
  if (v == null) return "";
  return String(v);
}
