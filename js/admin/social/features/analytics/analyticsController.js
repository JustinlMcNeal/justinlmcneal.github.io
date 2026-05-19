// Analytics — public API (init, setup, tab load, re-exports)

import { initAnalyticsContext, getAnalyticsContext } from "./analyticsContext.js";
import { reloadAnalyticsTab } from "./analyticsReload.js";
import { syncInstagramInsights } from "./instagramInsights.js";
import {
  openPostAnalytics,
  initPostAnalyticsModal,
} from "./postAnalyticsModal.js";
import {
  loadLearningInsights,
  processAllPostsForLearning,
  initLearningInsights,
} from "./learningInsights.js";
import { loadCategoryInsightsUI } from "./categoryInsights.js";

export function initAnalytics(deps) {
  initAnalyticsContext(deps);
}

export function setupAnalytics() {
  document.getElementById("btnRefreshAnalytics")?.addEventListener("click", loadAnalytics);
  document.getElementById("btnSyncInstagramInsights")?.addEventListener("click", () => syncInstagramInsights());
}

export async function loadAnalytics() {
  await reloadAnalyticsTab();
}

export { syncInstagramInsights, openPostAnalytics, loadLearningInsights, processAllPostsForLearning, initPostAnalyticsModal, initLearningInsights, loadCategoryInsightsUI };
