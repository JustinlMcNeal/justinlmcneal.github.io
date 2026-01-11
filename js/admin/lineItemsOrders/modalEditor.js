// /js/admin/lineItemsOrders/modalEditor.js
import {
  isoToLocalDatetimeValue,
  localDatetimeValueToIso,
  dollarsToCents,
  centsToDollars,
  setStatus,
} from "./dom.js";
import { upsertFulfillmentShipment } from "./api.js";

function $(root, id) {
  return root.querySelector(`#${id}`);
}

function cleanStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function cleanInt(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function bindEditModal({ modalEl, onSaved } = {}) {
  if (!modalEl) return null;

  const backdrop = modalEl.querySelector(".kk-admin-modal-backdrop");
  const btnClose = $(modalEl, "btnClose");
  const btnCancel = $(modalEl, "btnCancel");
  const btnSave = $(modalEl, "btnSave");
  const modalMsg = $(modalEl, "modalMsg");

  // fields
  const fSessionId = $(modalEl, "fSessionId");
  const fKkOrderId = $(modalEl, "fKkOrderId");
  const fLabelStatus = $(modalEl, "fLabelStatus");
  const fTrackingNumber = $(modalEl, "fTrackingNumber");
  const fCarrier = $(modalEl, "fCarrier");
  const fService = $(modalEl, "fService");
  const fBatchId = $(modalEl, "fBatchId");
  const fPrintedAt = $(modalEl, "fPrintedAt");
  const fLabelCost = $(modalEl, "fLabelCost");
  const fPackageWeightGFinal = $(modalEl, "fPackageWeightGFinal");
  const fPirateShipShipmentId = $(modalEl, "fPirateShipShipmentId");
  const fNotes = $(modalEl, "fNotes");

  let currentRow = null;

  function msg(text, isError = false) {
    if (!modalMsg) return;
    modalMsg.textContent = text || "";
    modalMsg.style.color = isError ? "crimson" : "";
  }

  function open(row) {
    currentRow = row;

    const ship = row.shipment || {};

    fSessionId.value = row.stripe_checkout_session_id || "";
    fKkOrderId.value = row.kk_order_id || "";

    fLabelStatus.value = ship.label_status || "pending";
    fTrackingNumber.value = ship.tracking_number || "";
    fCarrier.value = ship.carrier || "";
    fService.value = ship.service || "";
    fBatchId.value = ship.batch_id || "";
    fPrintedAt.value = isoToLocalDatetimeValue(ship.printed_at);
    fLabelCost.value = ship.label_cost_cents != null ? centsToDollars(ship.label_cost_cents) : "";
    fPackageWeightGFinal.value = ship.package_weight_g_final != null ? String(ship.package_weight_g_final) : "";
    fPirateShipShipmentId.value = ship.pirate_ship_shipment_id || "";
    fNotes.value = ship.notes || "";

    msg("");

    modalEl.classList.remove("hidden");
    modalEl.setAttribute("aria-hidden", "false");
  }

  function close() {
    modalEl.classList.add("hidden");
    modalEl.setAttribute("aria-hidden", "true");
    currentRow = null;
    msg("");
  }

  async function save() {
    if (!currentRow) return;

    try {
      msg("Saving…");

      const previousShipment = currentRow.shipment || null;

      const patch = {
        label_status: cleanStr(fLabelStatus.value) || "pending",
        tracking_number: cleanStr(fTrackingNumber.value),
        carrier: cleanStr(fCarrier.value),
        service: cleanStr(fService.value),

        batch_id: cleanStr(fBatchId.value),
        printed_at: localDatetimeValueToIso(fPrintedAt.value),

        label_cost_cents: fLabelCost.value === "" ? null : dollarsToCents(fLabelCost.value),

        package_weight_g_final: cleanInt(fPackageWeightGFinal.value),
        pirate_ship_shipment_id: cleanStr(fPirateShipShipmentId.value),

        notes: cleanStr(fNotes.value),
      };

      // UPSERT
      const saved = await upsertFulfillmentShipment({
        stripe_checkout_session_id: currentRow.stripe_checkout_session_id,
        kk_order_id: currentRow.kk_order_id,
        patch,
        previousShipment,
      });

      msg("Saved ✓");
      setStatus("Saved shipment ✓");

      // Update row in-memory so the table reflects immediately (optional)
      currentRow.shipment = saved;

      // Refresh list (recommended, ensures it matches DB)
      await onSaved?.();

      close();
    } catch (e) {
      console.error(e);
      msg(`Save failed: ${e?.message || e}`, true);
    }
  }

  // handlers
  btnClose?.addEventListener("click", close);
  btnCancel?.addEventListener("click", close);
  backdrop?.addEventListener("click", close);

  btnSave?.addEventListener("click", save);

  // ESC to close
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalEl.classList.contains("hidden")) close();
  });

  return { open, close };
}
