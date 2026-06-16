/**
 * Manual adjustment modal controller (Phase 4).
 */

import { getDom } from "../dom.js";
import { state } from "../state.js";
import { renderAdjustModalContent } from "../renderers/renderAdjustModal.js";
import { computeAdjustment } from "../services/adjustmentMath.js";
import { adjustInventory } from "../api/adjustInventoryApi.js";
import { refreshInventoryAfterAdjustment } from "../services/refreshInventoryData.js";
import { showInventoryToast } from "../events.js";

/** @type {import('../services/mapWorkspaceRow.js').InventoryRow|null} */
let activeRow = null;

/** @type {boolean} */
let submitting = false;

function getMount() {
  return getDom().adjustModalMount;
}

function closeAdjustModal() {
  const mount = getMount();
  if (mount) mount.innerHTML = "";
  activeRow = null;
  document.body.classList.remove("overflow-hidden");
}

/**
 * @param {import('../services/mapWorkspaceRow.js').InventoryRow} row
 */
function updatePreview(row) {
  const mount = getMount();
  if (!mount || !row) return;

  const form = mount.querySelector("#inventoryAdjustForm");
  if (!form) return;

  const mode = /** @type {'add'|'remove'|'set'} */ (
    form.querySelector('input[name="adjustMode"]:checked')?.value || "add"
  );
  const qtyRaw = /** @type {HTMLInputElement|null} */ (form.querySelector("#inventoryAdjustQty"))?.value;
  const quantity = qtyRaw === "" ? NaN : Number(qtyRaw);

  const result = computeAdjustment(mode, row.onHand, quantity);
  const deltaEl = mount.querySelector("[data-preview-delta]");
  const newEl = mount.querySelector("[data-preview-new]");
  const warnEl = mount.querySelector("[data-adjust-negative-warning]");
  const errEl = mount.querySelector("[data-adjust-form-error]");
  const submitBtn = mount.querySelector("[data-adjust-submit]");

  if (deltaEl) {
    if (!result.valid) {
      deltaEl.textContent = "—";
    } else {
      const sign = result.delta > 0 ? "+" : "";
      deltaEl.textContent = `${sign}${result.delta}`;
    }
  }

  if (newEl) {
    newEl.textContent = result.valid ? String(result.newStock) : "—";
    newEl.classList.toggle("text-red-600", result.valid && result.newStock < 0);
  }

  if (warnEl) {
    warnEl.classList.toggle("hidden", !(result.valid && result.newStock < 0));
  }

  if (errEl && result.error && qtyRaw !== "") {
    errEl.textContent = result.error;
    errEl.classList.remove("hidden");
  } else if (errEl) {
    errEl.textContent = "";
    errEl.classList.add("hidden");
  }

  if (submitBtn) {
    submitBtn.disabled = submitting || !result.valid;
  }
}

function wireModalEvents(row) {
  const mount = getMount();
  if (!mount) return;

  mount.querySelectorAll("[data-adjust-close]").forEach((el) => {
    el.addEventListener("click", closeAdjustModal);
  });

  const form = mount.querySelector("#inventoryAdjustForm");
  form?.addEventListener("input", () => updatePreview(row));
  form?.addEventListener("change", () => updatePreview(row));

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!activeRow || submitting) return;

    const mode = /** @type {'add'|'remove'|'set'} */ (
      form.querySelector('input[name="adjustMode"]:checked')?.value || "add"
    );
    const quantity = Number(
      /** @type {HTMLInputElement} */ (form.querySelector("#inventoryAdjustQty")).value,
    );
    const reason = String(
      /** @type {HTMLSelectElement} */ (form.querySelector("#inventoryAdjustReason")).value,
    ).trim();
    const note = String(
      /** @type {HTMLTextAreaElement} */ (form.querySelector("#inventoryAdjustNote")).value,
    ).trim();

    const calc = computeAdjustment(mode, activeRow.onHand, quantity);
    if (!calc.valid) {
      showInventoryToast(calc.error || "Invalid adjustment.", { variant: "error" });
      updatePreview(activeRow);
      return;
    }

    if (!reason) {
      showInventoryToast("Select an adjustment reason.", { variant: "error" });
      return;
    }

    if (!note) {
      showInventoryToast("Note is required for manual adjustments.", { variant: "error" });
      return;
    }

    submitting = true;
    updatePreview(activeRow);

    const submitBtn = form.querySelector("[data-adjust-submit]");
    if (submitBtn) submitBtn.textContent = "Saving…";

    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `adj-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const result = await adjustInventory({
        variantId: activeRow.id,
        deltaQty: calc.delta,
        reason,
        note,
        referenceType: "manual_adjust",
        referenceId: reason,
        idempotencyKey,
      });

      closeAdjustModal();
      await refreshInventoryAfterAdjustment();

      const sign = result.delta > 0 ? "+" : "";
      showInventoryToast(
        `Stock updated: ${sign}${result.delta} → ${result.stockAfter} on hand`,
        { variant: "success" },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showInventoryToast(message, { variant: "error" });
      submitting = false;
      if (submitBtn) submitBtn.textContent = "Confirm adjustment";
      updatePreview(activeRow);
    }
  });

  updatePreview(row);
}

/**
 * @param {string} rowId
 */
export function openAdjustModal(rowId) {
  if (!state.workspaceLive) {
    showInventoryToast("Live inventory required before adjusting stock.", { variant: "error" });
    return;
  }

  const row = state.inventoryRows.find((r) => r.id === rowId);
  if (!row) {
    showInventoryToast("Inventory row not found.", { variant: "error" });
    return;
  }

  const mount = getMount();
  if (!mount) return;

  activeRow = row;
  submitting = false;
  mount.innerHTML = renderAdjustModalContent(row);
  document.body.classList.add("overflow-hidden");
  wireModalEvents(row);

  const qtyInput = mount.querySelector("#inventoryAdjustQty");
  qtyInput?.focus();
}

export function initAdjustModal() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeRow) closeAdjustModal();
  });
}
