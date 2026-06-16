/** Workflow tab switching for Parcel Imports — one visible panel at a time. */

import { updateWorkflowChrome } from "./exportActions.js";

const TAB_ACTIVE =
  "flex items-center justify-center sm:justify-start px-3 py-2.5 rounded-xl border-4 border-black bg-black text-white text-left min-h-[44px]";
const TAB_IDLE =
  "flex items-center justify-center sm:justify-start px-3 py-2.5 rounded-xl border-2 border-black bg-white text-black text-left min-h-[44px] hover:bg-gray-50";

/** @type {{ id: string, panelId: string }[]} */
export const PARCEL_TABS = [
  { id: "parcelTabUpload", panelId: "parcelImportUploadSummary" },
  { id: "parcelTabReview", panelId: "parcelImportChargeOverrides" },
  { id: "parcelTabMap", panelId: "parcelImportItemMapping" },
  { id: "parcelTabCpi", panelId: "parcelImportCpiPreview" },
  { id: "parcelTabHistory", panelId: "parcelImportHistory" },
];

/** @type {string} */
let activeTabId = PARCEL_TABS[0].id;

export function getActiveTabId() {
  return activeTabId;
}

export function initParcelTabs() {
  const tablist = document.querySelector("#parcelImportViewTabs [role='tablist']");
  if (!tablist) return;

  PARCEL_TABS.forEach(({ id }) => {
    const tab = document.getElementById(id);
    if (!tab) return;
    tab.addEventListener("click", () => activateTab(id));
  });

  const initial = document.querySelector(
    "#parcelImportViewTabs [role='tab'][aria-selected='true']",
  );
  activateTab(initial?.id || PARCEL_TABS[0].id);
}

/** @param {string} tabId */
export function activateTab(tabId) {
  activeTabId = tabId;

  PARCEL_TABS.forEach(({ id, panelId }) => {
    const tab = document.getElementById(id);
    const panel = document.getElementById(panelId);
    if (!tab || !panel) return;

    const active = id === tabId;
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
    tab.className = active ? TAB_ACTIVE : TAB_IDLE;
    panel.classList.toggle("hidden", !active);
    panel.hidden = !active;
  });

  updateWorkflowChrome();
}
