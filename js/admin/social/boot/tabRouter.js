// Main tab navigation — buttons, panels, lazy tab loaders

import { getSocialBootContext } from "./socialBootContext.js";

const TAB_BTN_SELECTOR = ".tab-btn";
const TAB_PANEL_SELECTOR = ".tab-panel";

export function setupTabRouter() {
  document.querySelectorAll(TAB_BTN_SELECTOR).forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      activateTab(tab);
    });
  });
}

export function getActiveTab() {
  return getSocialBootContext().state.currentTab;
}

export function activateTab(tab) {
  const { state, $, tabHandlers } = getSocialBootContext();
  state.currentTab = tab;

  document.querySelectorAll(TAB_BTN_SELECTOR).forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  document.querySelectorAll(TAB_PANEL_SELECTOR).forEach(panel => {
    panel.classList.add("hidden");
  });

  const activePanel = $(`tab-${tab}`);
  if (activePanel) activePanel.classList.remove("hidden");

  switch (tab) {
    case "calendar":
      tabHandlers.loadCalendarPosts?.();
      break;
    case "queue":
      tabHandlers.loadQueuePosts?.();
      break;
    case "assets":
      tabHandlers.loadAssets?.();
      break;
    case "templates":
      tabHandlers.loadTemplates?.();
      break;
    case "boards":
      tabHandlers.renderBoardList?.();
      break;
    case "autoqueue":
      tabHandlers.loadAutoQueueStats?.();
      break;
    case "analytics":
      tabHandlers.loadAnalytics?.();
      break;
    case "carousel":
      tabHandlers.loadRecentCarousels?.();
      break;
  }
}

/** Alias used by feature modules (upload, auto-queue, post detail, etc.). */
export function switchTab(tab) {
  activateTab(tab);
}
