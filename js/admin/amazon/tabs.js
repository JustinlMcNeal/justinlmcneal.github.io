import { qs, qsa, setHidden } from "./dom.js";

const TAB_BASE =
  "flex flex-col items-start px-3 py-2.5 rounded-xl text-left min-h-[44px] transition-colors";
const TAB_ACTIVE = `${TAB_BASE} border-4 border-black bg-black text-white`;
const TAB_INACTIVE = `${TAB_BASE} border-2 border-black bg-white text-black hover:bg-gray-50`;

const DEFAULT_VIEW = "synced";

/**
 * @param {HTMLButtonElement} tab
 * @param {boolean} isActive
 */
function applyTabStyles(tab, isActive) {
  tab.className = isActive ? TAB_ACTIVE : TAB_INACTIVE;
  tab.setAttribute("aria-selected", isActive ? "true" : "false");
  tab.setAttribute("tabindex", isActive ? "0" : "-1");
}

/**
 * @param {string} viewKey
 * @param {HTMLButtonElement[]} tabs
 * @param {Element[]} panels
 */
function activateView(viewKey, tabs, panels) {
  tabs.forEach((tab) => {
    applyTabStyles(tab, tab.dataset.view === viewKey);
  });

  panels.forEach((panel) => {
    const isActive = panel.dataset.amazonViewPanel === viewKey;
    setHidden(panel, !isActive);
  });
}

export function initAmazonTabs() {
  const tabRoot = qs("#amazonViewTabs");
  if (!tabRoot) return;

  const tabs = qsa('[role="tab"][data-view]', tabRoot);
  const panels = qsa("[data-amazon-view-panel]");
  if (!tabs.length || !panels.length) return;

  tabs.forEach((tab) => {
    tab.removeAttribute("disabled");
    tab.removeAttribute("aria-disabled");
    tab.addEventListener("click", () => {
      const viewKey = tab.dataset.view;
      if (!viewKey) return;
      activateView(viewKey, tabs, panels);
      document.dispatchEvent(new CustomEvent("amazon:view-change", {
        detail: { view: viewKey },
      }));
    });
  });

  activateView(DEFAULT_VIEW, tabs, panels);
}
