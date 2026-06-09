/** New Import — reset working state without DB changes (Phase 10). */

import { UPLOAD_STATUS } from "../constants.js";
import { getDom } from "../dom.js";
import {
  getState,
  resetWorkingImport,
  setSaveStatus,
  setUploadStatus,
} from "../state.js";
import { updateApprovalButtonState } from "./approvalActions.js";
import { renderCpiPreviewFromState } from "./cpiPreviewPanel.js";
import { updateExpenseLinkUi } from "./expenseLinkActions.js";
import { updateInventoryReceiveUi } from "./inventoryReceiveActions.js";
import { clearMappingChips, renderItemMappingTable } from "./itemMappingTable.js";
import { clearChargeOverrides } from "./overrides.js";
import { clearParcelSummary } from "./parcelSummary.js";
import { clearStatsDisplay } from "./stats.js";
import {
  renderActionStatus,
  renderDuplicateWarning,
  updateSaveDraftButtonState,
} from "./saveDraft.js";
import { renderUploadStatus } from "./upload.js";

/** @param {{ refreshHistory?: () => Promise<void> }} [opts] */
export function initNewImportUi(opts = {}) {
  const { newImportBtns } = getDom();

  newImportBtns?.forEach((btn) => {
    btn.addEventListener("click", () => {
      void handleNewImport(opts.refreshHistory);
    });
  });
}

/** @param {() => Promise<void>} [refreshHistory] */
export async function handleNewImport(refreshHistory) {
  resetWorkingImport();

  const { fileInput } = getDom();
  if (fileInput) fileInput.value = "";

  setUploadStatus(UPLOAD_STATUS.IDLE, "Upload a Baestao HTML-table .xls file to start.");
  renderUploadStatus(UPLOAD_STATUS.IDLE, getState().uploadMessage);
  clearParcelSummary();
  clearStatsDisplay();
  clearChargeOverrides();
  clearMappingChips();
  renderItemMappingTable([]);
  renderCpiPreviewFromState();
  renderDuplicateWarning(null);

  setSaveStatus("idle", "");
  renderActionStatus();
  updateSaveDraftButtonState();
  updateApprovalButtonState();
  updateExpenseLinkUi();
  updateInventoryReceiveUi();

  if (refreshHistory) await refreshHistory();
}
