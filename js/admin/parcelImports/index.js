/**
 * Parcel Imports admin — entry (Phase 1A + 6B + 7).
 */

import { requireAuthenticatedSession } from "./api/parcelImportsApi.js";
import { initDom } from "./dom.js";
import { initParcelEvents } from "./events.js";
import {
  getState,
  initState,
  setSaveStatus,
  setSessionReady,
} from "./state.js";
import { loadAndRenderHistory, initHistoryTable } from "./ui/historyTable.js";
import { initMappingListeners } from "./ui/itemMappingTable.js";
import {
  initMappingMemoryUi,
  refreshMappingSuggestions,
} from "./ui/mappingMemory.js";
import { initOverrideListeners } from "./ui/overrides.js";
import {
  initApprovalActions,
  updateApprovalButtonState,
} from "./ui/approvalActions.js";
import {
  initExpenseLinkActions,
  updateExpenseLinkUi,
} from "./ui/expenseLinkActions.js";
import { initNewImportUi } from "./ui/newImport.js";
import {
  initInventoryReceiveActions,
  updateInventoryReceiveUi,
} from "./ui/inventoryReceiveActions.js";
import { clearStatsDisplay, refreshGlobalKpis } from "./ui/stats.js";
import {
  initSaveDraftUi,
  renderActionStatus,
  updateSaveDraftButtonState,
} from "./ui/saveDraft.js";
import { initUploadUi, renderUploadStatus } from "./ui/upload.js";
import { clearParcelSummary } from "./ui/parcelSummary.js";
import { clearChargeOverrides } from "./ui/overrides.js";
import { clearMappingChips, renderItemMappingTable } from "./ui/itemMappingTable.js";
import { renderCpiPreviewFromState } from "./ui/cpiPreviewPanel.js";
import { UPLOAD_STATUS } from "./constants.js";
import { setUploadStatus } from "./state.js";
import { requireAdmin } from "/js/shared/guard.js";

async function init() {
  initState();
  initDom();
  initUploadUi();
  initOverrideListeners();
  initMappingListeners();
  initMappingMemoryUi();
  initParcelEvents();
  resetIdleWorkspace();

  const authed = await initSessionGate();
  const refreshHistory = authed ? loadAndRenderHistory : async () => {};
  initSaveDraftUi({ refreshHistory });
  initApprovalActions({ refreshHistory });
  initExpenseLinkActions({ refreshHistory });
  initInventoryReceiveActions({ refreshHistory });
  initNewImportUi({ refreshHistory });
  initHistoryTable();

  if (authed) {
    await loadAndRenderHistory();
  }

  updateSaveDraftButtonState();
  updateApprovalButtonState();
  updateExpenseLinkUi();
  updateInventoryReceiveUi();
  renderActionStatus();

  if (/localhost|127\.0\.0\.1/.test(location.hostname)) {
    console.info("[parcelImports] Phase 6A RPC smoke available");
    initDevSmokeHarness();
  }
}

function resetIdleWorkspace() {
  clearParcelSummary();
  clearStatsDisplay();
  clearChargeOverrides();
  clearMappingChips();
  renderItemMappingTable([]);
  renderCpiPreviewFromState();
  setUploadStatus(UPLOAD_STATUS.IDLE, "Upload a Baestao HTML-table .xls file to start.");
  renderUploadStatus(UPLOAD_STATUS.IDLE, getState().uploadMessage);
}

async function initSessionGate() {
  try {
    await requireAuthenticatedSession();
    const admin = await requireAdmin();
    if (!admin.ok) {
      setSessionReady(false, false);
      setSaveStatus(
        "error",
        "Admin access required. Log in to the admin area first.",
      );
      return false;
    }
    setSessionReady(true, true);
    return true;
  } catch (err) {
    console.warn("[parcelImports] session gate", err);
    setSessionReady(false, false);
    setSaveStatus(
      "error",
      "Log in as admin to save drafts and view import history.",
    );
    return false;
  }
}

async function initDevSmokeHarness() {
  try {
    const { runSaveDraftSmokeTest } = await import("./api/saveDraftSmokeTest.js");
    window.ParcelImports = { runSaveDraftSmokeTest };
    console.info(
      "[parcelImports] Dev smoke: await ParcelImports.runSaveDraftSmokeTest()",
    );
  } catch (err) {
    console.warn("[parcelImports] Dev smoke harness failed to load", err);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void init();
  });
} else {
  void init();
}

export { getState, refreshMappingSuggestions };
