// /js/admin/lineItemsRaw/modalEditor.js
import { setMsg, centsToDollars, dollarsToCents } from "./dom.js";
import { state } from "./state.js";
import { updateLineItemRaw, deleteLineItemRaw } from "./api.js";

export function bindModal(els, onSaved) {
  function open() {
    els.modal.classList.remove("hidden");
    els.modal.classList.add("is-open");
    els.modal.setAttribute("aria-hidden", "false");
    setMsg(els.modalMsg, "", false);
  }

  function close() {
    els.modal.classList.add("hidden");
    els.modal.classList.remove("is-open");
    els.modal.setAttribute("aria-hidden", "true");
    state.selected = null;
  }

  function fill(row) {
    state.selected = row;

    els.fLineRowId.value = row.line_item_row_id || "";
    els.fSessionId.value = row.stripe_checkout_session_id || "";
    els.fStripeLineItemId.value = row.stripe_line_item_id || "";

    els.fProductId.value = row.product_id || "";
    els.fProductName.value = row.product_name || "";
    els.fVariant.value = row.variant || "";
    els.fQuantity.value = row.quantity ?? 1;
    els.fWeightG.value = row.item_weight_g ?? "";

    els.fUnitPrice.value = row.unit_price_cents != null ? centsToDollars(row.unit_price_cents) : "";
    els.fPostDiscount.value =
      row.post_discount_unit_price_cents != null ? centsToDollars(row.post_discount_unit_price_cents) : "";
  }

  function readPatch() {
    const patch = {
      product_id: els.fProductId.value.trim() || null,
      product_name: els.fProductName.value.trim() || null,
      variant: els.fVariant.value.trim() || null,
      quantity: Number(els.fQuantity.value || 1),
      item_weight_g: els.fWeightG.value === "" ? null : Number(els.fWeightG.value),

      unit_price_cents: els.fUnitPrice.value === "" ? null : dollarsToCents(els.fUnitPrice.value),
      post_discount_unit_price_cents:
        els.fPostDiscount.value === "" ? null : dollarsToCents(els.fPostDiscount.value),
    };

    if (!Number.isFinite(patch.quantity) || patch.quantity <= 0) patch.quantity = 1;
    if (patch.item_weight_g != null && (!Number.isFinite(patch.item_weight_g) || patch.item_weight_g < 0)) {
      patch.item_weight_g = 0;
    }

    return patch;
  }

  async function save() {
    const row = state.selected;
    const id = row?.line_item_row_id;
    if (!id) return;

    try {
      setMsg(els.modalMsg, "Saving…", false);
      await updateLineItemRaw(id, readPatch());
      setMsg(els.modalMsg, "Saved ✓", false);
      await onSaved?.();
      close();
    } catch (e) {
      setMsg(els.modalMsg, String(e?.message || e), true);
    }
  }

  async function hardDelete() {
    const row = state.selected;
    const id = row?.line_item_row_id;
    if (!id) return;
    if (!confirm("Delete this line item row? This cannot be undone.")) return;

    try {
      setMsg(els.modalMsg, "Deleting…", false);
      await deleteLineItemRaw(id);
      setMsg(els.modalMsg, "Deleted ✓", false);
      await onSaved?.();
      close();
    } catch (e) {
      setMsg(els.modalMsg, String(e?.message || e), true);
    }
  }

  function openEdit(row) {
    fill(row);
    open();
  }

  els.btnClose.addEventListener("click", close);
  els.btnSave.addEventListener("click", save);
  els.btnHardDelete.addEventListener("click", hardDelete);

  els.modal.addEventListener("click", (e) => {
    if (e.target?.classList?.contains("kk-admin-modal-backdrop")) close();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.modal.classList.contains("hidden")) close();
  });

  return { openEdit, close };
}
