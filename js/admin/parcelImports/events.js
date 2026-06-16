/** Upload + parse event wiring. */

import { MAX_FILE_BYTES, UPLOAD_STATUS } from "./constants.js";
import { getDom } from "./dom.js";
import { parseBaestaoFileText } from "./parser/baestaoParser.js";
import {
  getState,
  resetParseState,
  setCurrentFile,
  setParseResult,
  setUploadStatus,
} from "./state.js";
import { renderCpiPreviewFromState } from "./ui/cpiPreviewPanel.js";
import { renderChargeOverrides } from "./ui/overrides.js";
import { renderItemMappingTable } from "./ui/itemMappingTable.js";
import { refreshMappingSuggestions } from "./ui/mappingMemory.js";
import { renderParcelSummary } from "./ui/parcelSummary.js";
import { renderUploadStatus } from "./ui/upload.js";
import { updateApprovalButtonState } from "./ui/approvalActions.js";
import { updateExpenseLinkUi } from "./ui/expenseLinkActions.js";
import { updateInventoryReceiveUi } from "./ui/inventoryReceiveActions.js";
import { updateWorkflowChrome } from "./ui/exportActions.js";
import { activateTab } from "./ui/tabs.js";
import { refreshGlobalKpis, renderStatsFromParse } from "./ui/stats.js";
import {
  refreshDuplicateWarning,
  updateSaveDraftButtonState,
} from "./ui/saveDraft.js";

/**
 * @param {File} file
 */
export function handleFileSelected(file) {
  if (!file) return;

  if (file.size > MAX_FILE_BYTES) {
    setUploadStatus(UPLOAD_STATUS.ERROR, "File is too large (max 8 MB).");
    renderUploadStatus(UPLOAD_STATUS.ERROR, getState().uploadMessage);
    return;
  }

  setCurrentFile(file);
  resetParseState();
  setUploadStatus(UPLOAD_STATUS.PARSING, `Parsing ${file.name}…`);
  renderUploadStatus(UPLOAD_STATUS.PARSING, getState().uploadMessage);

  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === "string" ? reader.result : "";
    applyParseResult(text, { name: file.name, size: file.size });
  };
  reader.onerror = () => {
    setUploadStatus(UPLOAD_STATUS.ERROR, "Could not read the selected file.");
    renderUploadStatus(UPLOAD_STATUS.ERROR, getState().uploadMessage);
  };
  reader.readAsText(file, "UTF-8");
}

/**
 * @param {string} text
 * @param {{ name?: string, size?: number }} fileMeta
 */
function applyParseResult(text, fileMeta) {
  const result = parseBaestaoFileText(text, fileMeta);
  setParseResult(result);

  const hasErrors = result.errors.length > 0;
  const hasWarnings = result.warnings.length > 0;
  const itemCount = result.items.length;

  if (hasErrors) {
    setUploadStatus(
      UPLOAD_STATUS.ERROR,
      itemCount
        ? `Parsed with errors — ${itemCount} row(s) found. Review issues below.`
        : "Parse failed. See issues below.",
    );
  } else if (hasWarnings) {
    setUploadStatus(
      UPLOAD_STATUS.WARNING,
      `Parsed ${itemCount} row(s) with warnings. Review parcel summary and mapping table.`,
    );
  } else if (itemCount > 0) {
    setUploadStatus(
      UPLOAD_STATUS.SUCCESS,
      `Parsed ${itemCount} row(s) from ${fileMeta.name || "file"}.`,
    );
  } else {
    setUploadStatus(UPLOAD_STATUS.WARNING, "No item rows were found in this file.");
  }

  renderUploadStatus(
    getState().uploadStatus,
    getState().uploadMessage,
    result.errors,
    result.warnings,
  );

  const state = getState();

  if (result.parcel) {
    renderParcelSummary(result.parcel, fileMeta);
    renderChargeOverrides(result.parcel);
  }

  if (state.derived) {
    renderStatsFromParse(state.derived);
  }
  void refreshGlobalKpis();

  if (itemCount > 0) {
    renderItemMappingTable(result.items);
  }

  renderCpiPreviewFromState();
  updateSaveDraftButtonState();
  updateApprovalButtonState();
  updateExpenseLinkUi();
  updateInventoryReceiveUi();
  updateWorkflowChrome();
  void refreshDuplicateWarning({ parcelId: result.parcel?.parcelId });
  void refreshMappingSuggestions();

  if (itemCount > 0 && !hasErrors) {
    activateTab("parcelTabMap");
  }
}

export function initParcelEvents() {
  const { selectFileBtn, fileInput, dropZone } = getDom();

  if (selectFileBtn && fileInput) {
    selectFileBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) handleFileSelected(file);
      fileInput.value = "";
    });
  }

  if (dropZone) {
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("border-black", "bg-gray-100");
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("border-black", "bg-gray-100");
    });
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("border-black", "bg-gray-100");
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileSelected(file);
    });
  }
}
