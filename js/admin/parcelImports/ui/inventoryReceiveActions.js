/** Receive Inventory button wiring (Phase 11). */

import { receiveParcelImportInventory } from "../api/inventoryReceiveApi.js";
import { fetchParcelImportHeader } from "../api/parcelImportsApi.js";
import { getDom } from "../dom.js";
import {
  getState,
  isImportApproved,
  isImportReceived,
  setInventoryReceiveStatus,
  setInventoryReceivedAt,
  setSaveStatus,
} from "../state.js";
import { refreshGlobalKpis } from "./stats.js";
import { renderActionStatus } from "./saveDraft.js";

let refreshHistoryFn = async () => {};

/** @param {{ refreshHistory?: () => Promise<void> }} [opts] */
export function initInventoryReceiveActions(opts = {}) {
  refreshHistoryFn = opts.refreshHistory ?? refreshHistoryFn;
  const { receiveInventoryBtn } = getDom();

  receiveInventoryBtn?.addEventListener("click", () => {
    void handleReceiveInventory();
  });

  updateInventoryReceiveUi();
}

export function updateInventoryReceiveUi() {
  const state = getState();
  const { receiveInventoryBtn, inventoryReceiveStatusEl } = getDom();
  const blockReason = getInventoryReceiveBlockReason(state);
  const received = isImportReceived(state);
  const approved = isImportApproved(state);
  const expenseLinked = !!state.expenseId;

  if (inventoryReceiveStatusEl) {
    if (received) {
      const when = state.inventoryReceivedAt
        ? String(state.inventoryReceivedAt).slice(0, 10)
        : "";
      inventoryReceiveStatusEl.textContent = when
        ? `Inventory received on ${when}.`
        : "Inventory received.";
      inventoryReceiveStatusEl.classList.remove("text-red-700", "text-gray-500");
      inventoryReceiveStatusEl.classList.add("text-green-700");
    } else if (state.inventoryReceiveMessage) {
      inventoryReceiveStatusEl.textContent = state.inventoryReceiveMessage;
      inventoryReceiveStatusEl.classList.toggle(
        "text-red-700",
        state.inventoryReceiveStatus === "error",
      );
      inventoryReceiveStatusEl.classList.toggle(
        "text-green-700",
        state.inventoryReceiveStatus === "received",
      );
      inventoryReceiveStatusEl.classList.toggle(
        "text-gray-500",
        state.inventoryReceiveStatus === "idle",
      );
    } else if (blockReason) {
      inventoryReceiveStatusEl.textContent = blockReason;
      inventoryReceiveStatusEl.classList.remove("text-green-700", "text-red-700");
      inventoryReceiveStatusEl.classList.add("text-gray-500");
    } else if (approved && expenseLinked) {
      inventoryReceiveStatusEl.textContent =
        "Approved with expense linked — ready to receive inventory.";
      inventoryReceiveStatusEl.classList.remove("text-red-700", "text-green-700");
      inventoryReceiveStatusEl.classList.add("text-gray-800");
    } else if (approved) {
      inventoryReceiveStatusEl.textContent =
        "Approved import ready — receive matched business inventory into stock.";
      inventoryReceiveStatusEl.classList.remove("text-red-700", "text-green-700");
      inventoryReceiveStatusEl.classList.add("text-gray-500");
    } else {
      inventoryReceiveStatusEl.textContent =
        "Approve an import to receive inventory into variant stock.";
      inventoryReceiveStatusEl.classList.remove("text-red-700", "text-green-700");
      inventoryReceiveStatusEl.classList.add("text-gray-500");
    }
  }

  if (receiveInventoryBtn) {
    if (received) {
      receiveInventoryBtn.disabled = true;
      receiveInventoryBtn.textContent = "Inventory Received";
      receiveInventoryBtn.title = "Stock already received for this import";
      receiveInventoryBtn.classList.remove(
        "hover:bg-gray-900",
        "border-black",
        "bg-black",
        "text-white",
      );
      receiveInventoryBtn.classList.add(
        "border-gray-300",
        "bg-gray-100",
        "text-gray-500",
        "opacity-70",
        "cursor-not-allowed",
      );
      return;
    }

    const canReceive =
      state.sessionReady &&
      state.adminOk &&
      state.currentImportId &&
      approved &&
      !blockReason;

    receiveInventoryBtn.disabled =
      !canReceive || state.inventoryReceiveStatus === "receiving";
    receiveInventoryBtn.textContent = "Receive Inventory";
    receiveInventoryBtn.title = blockReason || "Receive matched inventory into stock";
    receiveInventoryBtn.classList.toggle("opacity-70", !canReceive);
    receiveInventoryBtn.classList.toggle("cursor-not-allowed", !canReceive);

    if (canReceive) {
      receiveInventoryBtn.classList.remove(
        "border-gray-300",
        "bg-gray-100",
        "text-gray-500",
      );
      receiveInventoryBtn.classList.add(
        "border-4",
        "border-black",
        "bg-black",
        "text-white",
        "hover:bg-gray-900",
      );
    } else {
      receiveInventoryBtn.classList.remove(
        "border-4",
        "border-black",
        "bg-black",
        "text-white",
        "hover:bg-gray-900",
      );
      receiveInventoryBtn.classList.add(
        "border-2",
        "border-gray-300",
        "bg-gray-100",
        "text-gray-500",
      );
    }
  }
}

/** @param {object} state */
export function getInventoryReceiveBlockReason(state) {
  if (!state.sessionReady || !state.adminOk) {
    return "Admin session required.";
  }
  if (!state.currentImportId) {
    return "Open an approved import first.";
  }
  if (!isImportApproved(state)) {
    return "Approve the import before receiving inventory.";
  }
  if (isImportReceived(state)) {
    return "Inventory already received.";
  }

  const mappings = state.rowMappings ?? [];
  const items = state.items ?? [];
  const itemQty = new Map(items.map((i) => [i.rowNumber, i.quantity ?? 0]));

  let unmappedBusiness = 0;
  let receivableUnits = 0;

  for (const row of mappings) {
    if (row.rowType !== "Business Inventory") continue;
    const matched = row.mappingStatus === "Matched" && !!row.productVariantId;
    if (!matched) {
      unmappedBusiness += 1;
      continue;
    }
    const qty = itemQty.get(row.rowNumber) ?? 0;
    if (qty > 0) receivableUnits += qty;
  }

  if (unmappedBusiness > 0) {
    return `${unmappedBusiness} business row(s) still need mapping.`;
  }
  if (receivableUnits <= 0) {
    return "No receivable business rows with quantity > 0.";
  }

  return null;
}

export async function hydrateInventoryReceiveFromHeader(
  importId = getState().currentImportId,
) {
  if (!importId || !getState().sessionReady) return;

  try {
    const header = await fetchParcelImportHeader(importId);
    setInventoryReceivedAt(header.inventory_received_at ?? null);
    if (header.inventory_received_at) {
      setInventoryReceiveStatus("received", "Inventory received.");
    } else {
      setInventoryReceiveStatus("idle", "");
    }
  } catch (err) {
    console.warn("[parcelImports] inventory receive hydrate failed", err);
  } finally {
    updateInventoryReceiveUi();
  }
}

export async function handleReceiveInventory() {
  const state = getState();
  const blockReason = getInventoryReceiveBlockReason(state);

  if (blockReason) {
    setInventoryReceiveStatus("error", blockReason);
    updateInventoryReceiveUi();
    return;
  }

  setInventoryReceiveStatus("receiving", "Receiving inventory…");
  updateInventoryReceiveUi();

  try {
    const result = await receiveParcelImportInventory(state.currentImportId, {
      idempotencyKey: `receive-${state.currentImportId}`,
    });

    setInventoryReceivedAt(new Date().toISOString());

    const label = result.already_received
      ? "Inventory already received."
      : `Inventory received — ${result.total_units_received ?? 0} unit(s) across ${result.variants_updated ?? 0} variant(s).`;
    setInventoryReceiveStatus("received", label);
    setSaveStatus("saved", label);

    await refreshHistoryFn();
    await refreshGlobalKpis();
    await hydrateInventoryReceiveFromHeader(state.currentImportId);
  } catch (err) {
    console.error("[parcelImports] receive inventory failed", err);
    setInventoryReceiveStatus(
      "error",
      `Receive failed: ${err?.message || "Unknown error"}`,
    );
  } finally {
    updateInventoryReceiveUi();
    renderActionStatus();
  }
}
