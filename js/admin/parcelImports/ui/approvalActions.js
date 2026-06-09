/** Approve + Update CPI button wiring (Phase 8). */

import { approveParcelImportCpi } from "../api/approvalApi.js";
import { computeStatusIntent } from "../api/parcelImportsMappers.js";
import { buildCpiPreview } from "../cpi/cpiPreview.js";
import { getDom } from "../dom.js";
import {
  getState,
  isImportApproved,
  isImportEditable,
  setApprovalStatus,
  setImportStatus,
} from "../state.js";
import { validateOverrides } from "../validation/overrideValidators.js";
import { hydrateExpenseLinkFromHeader, updateExpenseLinkUi } from "./expenseLinkActions.js";
import { updateInventoryReceiveUi } from "./inventoryReceiveActions.js";
import { loadAndRenderHistory } from "./historyTable.js";
import { refreshGlobalKpis } from "./stats.js";
import {
  renderActionStatus,
  updateSaveDraftButtonState,
} from "./saveDraft.js";

let refreshHistoryFn = loadAndRenderHistory;

/** @param {{ refreshHistory?: () => Promise<void> }} [opts] */
export function initApprovalActions(opts = {}) {
  refreshHistoryFn = opts.refreshHistory ?? refreshHistoryFn;
  const { approveCpiBtns } = getDom();

  approveCpiBtns?.forEach((btn) => {
    btn.addEventListener("click", () => {
      void handleApproveCpi();
    });
  });

  updateApprovalButtonState();
}

export function updateApprovalButtonState() {
  const state = getState();
  const { approveCpiBtns } = getDom();
  const blockReason = getApprovalBlockReason(state);
  const approved = isImportApproved(state);

  approveCpiBtns?.forEach((btn) => {
    if (approved) {
      btn.disabled = true;
      btn.textContent = "Approved";
      btn.title = "This import is approved — CPI already applied";
      btn.classList.remove("hover:bg-gray-900");
      btn.classList.add("opacity-70", "cursor-not-allowed");
      return;
    }

    btn.disabled =
      !state.sessionReady || !state.adminOk || !state.currentImportId || !!blockReason;
    btn.textContent = "Approve + Update CPI";
    btn.title = blockReason || "Approve parcel and update product CPI";
    btn.classList.add("hover:bg-gray-900");
    btn.classList.remove("opacity-70", "cursor-not-allowed");
  });
}

/** @param {object} state */
export function getApprovalBlockReason(state) {
  if (!state.sessionReady || !state.adminOk) {
    return "Admin session required.";
  }
  if (!state.currentImportId) {
    return "Save draft first.";
  }
  if (isImportApproved(state)) {
    return "Import already approved.";
  }
  if (!isImportEditable(state)) {
    return `Import status is ${state.importStatus || "unknown"} — cannot approve.`;
  }
  if (!state.items?.length) {
    return "No items loaded.";
  }

  const cpiPreview = buildCpiPreview({
    parcel: state.parcel,
    items: state.items,
    overrides: state.overrides,
    rowMappings: state.rowMappings,
  });
  const validation = validateOverrides(state.overrides, state.xlsBaseline);
  const overrideErrors = Object.values(validation.fieldMessages).some((m) => m.length > 0);

  if (state.errors?.length > 0) return "Parse errors must be resolved.";
  if (overrideErrors) return "Override validation errors must be fixed.";
  if (!cpiPreview.summary?.readyToUpdate) {
    if (cpiPreview.summary?.needsMappingRows > 0) {
      return "Mapping issues remain — resolve all business rows.";
    }
    if (cpiPreview.summary?.productsAffected === 0) {
      return "No matched business rows for CPI update.";
    }
    return "Not ready to approve — check mapping and overrides.";
  }

  const statusIntent = computeStatusIntent(state, cpiPreview);
  if (statusIntent !== "ready_to_approve") {
    return `Save draft when ready (current intent: ${statusIntent.replace(/_/g, " ")}).`;
  }

  if (state.importStatus && state.importStatus !== "ready_to_approve") {
    return `Save draft to persist ready_to_approve (saved: ${state.importStatus.replace(/_/g, " ")}).`;
  }

  return null;
}

export async function handleApproveCpi() {
  const state = getState();
  const blockReason = getApprovalBlockReason(state);

  if (blockReason) {
    setApprovalStatus("error", blockReason);
    renderActionStatus();
    return;
  }

  setApprovalStatus("approving", "Approving and updating CPI…");
  renderActionStatus();
  updateApprovalButtonState();
  updateSaveDraftButtonState();

  try {
    const result = await approveParcelImportCpi(state.currentImportId, {
      idempotencyKey: `approve-${state.currentImportId}`,
    });

    setImportStatus("approved");
    const label = result.already_approved
      ? "Already approved"
      : `Approved — ${result.variants_updated ?? 0} variant(s), ${result.products_updated ?? 0} product(s) updated`;
    setApprovalStatus("approved", label);

    await refreshHistoryFn();
    await refreshGlobalKpis();
    await hydrateExpenseLinkFromHeader(state.currentImportId);
  } catch (err) {
    console.error("[parcelImports] approve failed", err);
    setApprovalStatus("error", `Approve failed: ${err?.message || "Unknown error"}`);
  } finally {
    renderActionStatus();
    updateApprovalButtonState();
    updateSaveDraftButtonState();
    updateExpenseLinkUi();
    updateInventoryReceiveUi();
  }
}
