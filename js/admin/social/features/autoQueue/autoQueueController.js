// Auto-Queue & Auto-Repost — public API (init, setup, settings, stats)

import { initAutoQueueContext, getAutoQueueContext } from "./autoQueueContext.js";
import { resetScoringWeightsForm } from "./scoringControls.js";
import {
  getAutoQueueSettings,
  loadAutoQueueSettings,
  saveAutoQueueSettings,
} from "./autoQueueSettings.js";
import {
  previewAutoQueue,
  generateAutoQueue,
  confirmAutoQueue,
} from "./autoQueueActions.js";
import {
  previewRepost,
  generateRepost,
  confirmRepost,
} from "./autoQueueRepost.js";
import { loadAutoQueueStats } from "./autoQueueStats.js";

export function initAutoQueue(deps) {
  initAutoQueueContext({
    ...deps,
    loadAutoQueueStats: deps.loadAutoQueueStats || loadAutoQueueStats,
  });
}

export function setupAutoQueue() {
  const { els, switchTab } = getAutoQueueContext();

  els.btnAutoQueue?.addEventListener("click", () => switchTab("autoqueue"));
  els.btnPreviewQueue?.addEventListener("click", previewAutoQueue);
  els.btnGenerateQueue?.addEventListener("click", generateAutoQueue);
  els.btnConfirmQueue?.addEventListener("click", confirmAutoQueue);

  document.getElementById("btnSaveAutoQueueSettings")?.addEventListener("click", () => saveAutoQueueSettings(true));
  document.getElementById("btnResetScoringDefaults")?.addEventListener("click", resetScoringWeightsForm);
  document.getElementById("btnPreviewRepost")?.addEventListener("click", previewRepost);
  document.getElementById("btnGenerateRepost")?.addEventListener("click", generateRepost);
  document.getElementById("btnConfirmRepost")?.addEventListener("click", confirmRepost);

  loadAutoQueueSettings();
}

export { getAutoQueueSettings, loadAutoQueueSettings, saveAutoQueueSettings, loadAutoQueueStats };
