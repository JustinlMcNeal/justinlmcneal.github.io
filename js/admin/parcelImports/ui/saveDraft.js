/** Save Draft button + status area (Phase 6B/7). */

import { buildSaveDraftPayload } from "../api/parcelImportsMappers.js";
import {
  checkDuplicateParcelImport,
  saveParcelImportDraft,
} from "../api/parcelImportsApi.js";
import { saveMappingMemoryFromMappedRows } from "../api/mappingMemoryApi.js";
import { getDom } from "../dom.js";
import {
  getState,
  isImportEditable,
  setCurrentImportId,
  setDuplicateWarning,
  setImportStatus,
  setSaveStatus,
} from "../state.js";
import { updateApprovalButtonState } from "./approvalActions.js";
import { updateInventoryReceiveUi } from "./inventoryReceiveActions.js";
import { updateWorkflowChrome } from "./exportActions.js";
import { refreshGlobalKpis } from "./stats.js";

let refreshHistoryFn = async () => {};

/** @param {{ refreshHistory?: () => Promise<void> }} [opts] */
export function initSaveDraftUi(opts = {}) {
  refreshHistoryFn = opts.refreshHistory ?? refreshHistoryFn;
  const { saveDraftBtns } = getDom();

  saveDraftBtns?.forEach((btn) => {
    btn.addEventListener("click", () => {
      void handleSaveDraft();
    });
  });

  updateSaveDraftButtonState();
  renderActionStatus();
}

export function updateSaveDraftButtonState() {
  const state = getState();
  const enabled =
    state.sessionReady &&
    state.adminOk &&
    isImportEditable(state) &&
    state.items?.length > 0 &&
    !!state.parcel?.parcelId;

  getDom().saveDraftBtns?.forEach((btn) => {
    btn.disabled = !enabled;
    if (!isImportEditable(state) && state.importStatus === "approved") {
      btn.title = "Import approved — Save Draft disabled";
    } else {
      btn.title = "Save import draft";
    }
  });
}

export function renderActionStatus() {
  const { actionStatusEl } = getDom();
  if (!actionStatusEl) return;

  const { saveStatus, saveMessage, approvalStatus, approvalMessage, sessionReady, importStatus } =
    getState();

  let text = approvalMessage || saveMessage;
  let tone = "gray";

  if (approvalStatus === "error") tone = "red";
  else if (approvalStatus === "approved") tone = "green";
  else if (approvalStatus === "approving") tone = "amber";
  else if (saveStatus === "error") tone = "red";
  else if (saveStatus === "saved") tone = "green";
  else if (saveStatus === "saving") tone = "amber";

  if (!text) {
    text = !sessionReady
      ? "Log in as admin to save drafts and view import history."
      : importStatus === "approved"
        ? "Import approved — CPI applied. Edits disabled."
        : "Parse a Baestao file, then save a draft.";
  }

  actionStatusEl.textContent = text;
  actionStatusEl.classList.remove(
    "text-gray-500",
    "text-green-700",
    "text-red-700",
    "text-amber-700",
  );

  if (tone === "red") actionStatusEl.classList.add("text-red-700");
  else if (tone === "green") actionStatusEl.classList.add("text-green-700");
  else if (tone === "amber") actionStatusEl.classList.add("text-amber-700");
  else actionStatusEl.classList.add("text-gray-500");
}

export function renderDuplicateWarning(warning = getState().duplicateWarning) {
  const { duplicateWarningEl } = getDom();
  if (!duplicateWarningEl) return;

  if (!warning?.hasFileHashDuplicate && !warning?.hasParcelIdDuplicate) {
    duplicateWarningEl.classList.add("hidden");
    duplicateWarningEl.textContent = "";
    return;
  }

  const parts = [];
  if (warning.hasFileHashDuplicate) {
    const match = warning.fileHashMatches[0];
    parts.push(
      `This file was already imported as parcel ${match?.parcel_id || "unknown"} on ${formatShortDate(match?.imported_at)}. Open it from Previous Imports instead of creating a duplicate.`,
    );
  } else if (warning.hasParcelIdDuplicate) {
    const match = warning.parcelIdMatches[0];
    parts.push(
      `Parcel ${match?.parcel_id || "unknown"} was saved on ${formatShortDate(match?.imported_at)}. Use Open Draft if you want to continue that import.`,
    );
  }

  duplicateWarningEl.textContent = parts.join(" ");
  duplicateWarningEl.classList.remove("hidden");
}

/** @param {{ parcelId?: string, fileHash?: string }} [params] */
export async function refreshDuplicateWarning(params = {}) {
  const state = getState();
  if (!state.sessionReady || !state.adminOk) return;

  const parcelId = params.parcelId ?? state.parcel?.parcelId;
  let fileHash = params.fileHash ?? null;

  if (!fileHash && state.currentFile) {
    try {
      const payload = await buildSaveDraftPayload(state);
      fileHash = payload.fileMeta?.hash ?? null;
    } catch {
      // ignore
    }
  }

  if (!parcelId && !fileHash) return;

  try {
    const warning = await checkDuplicateParcelImport({
      parcelId,
      fileHash,
      currentImportId: state.currentImportId,
    });
    setDuplicateWarning(warning);
    renderDuplicateWarning(warning);
  } catch (err) {
    console.warn("[parcelImports] duplicate check failed", err);
  }
}

export async function handleSaveDraft() {
  const state = getState();
  if (!state.sessionReady || !state.adminOk) {
    setSaveStatus("error", "Admin session required to save drafts.");
    renderActionStatus();
    return;
  }

  if (!isImportEditable(state)) {
    setSaveStatus("error", "Approved imports cannot be edited.");
    renderActionStatus();
    return;
  }

  if (!state.items?.length || !state.parcel?.parcelId) {
    setSaveStatus("error", "Parse a Baestao file before saving.");
    renderActionStatus();
    return;
  }

  setSaveStatus("saving", "Saving draft…");
  renderActionStatus();
  updateSaveDraftButtonState();

  try {
    const payload = await buildSaveDraftPayload(state);
    const duplicate = await checkDuplicateParcelImport({
      parcelId: state.parcel.parcelId,
      fileHash: payload.fileMeta?.hash ?? null,
      currentImportId: state.currentImportId,
    });
    setDuplicateWarning(duplicate);
    renderDuplicateWarning(duplicate);

    const result = await saveParcelImportDraft(payload);
    setCurrentImportId(result.import_id);
    setImportStatus(result.status ?? payload.statusIntent ?? state.importStatus);

    const memory = await saveMappingMemoryFromMappedRows(
      state.rowMappings,
      state.items,
    );
    if (memory.warnings?.length) {
      console.warn("[parcelImports] mapping memory warnings", memory.warnings);
    }

    const label = result.created ? "Draft saved" : "Draft updated";
    setSaveStatus(
      "saved",
      `${label} — parcel ${state.parcel.parcelId} (${result.item_count} items).`,
    );

    await refreshHistoryFn();
    await refreshGlobalKpis();
  } catch (err) {
    console.error("[parcelImports] save draft failed", err);
    setSaveStatus("error", `Save failed: ${err?.message || "Unknown error"}`);
  } finally {
    renderActionStatus();
    updateSaveDraftButtonState();
    updateApprovalButtonState();
    updateInventoryReceiveUi();
    updateWorkflowChrome();
  }
}

function formatShortDate(value) {
  if (!value) return "unknown date";
  return String(value).slice(0, 10);
}
