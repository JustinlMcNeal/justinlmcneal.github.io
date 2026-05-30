import { fetchAmazonReadyToPushProducts } from "./api.js";
import { showAmazonNotification } from "./notifications.js";
import { renderReadyToPush } from "./renderReadyToPush.js";

/**
 * @param {{ onLoaded?: () => void }} [deps]
 */
export function initAmazonReadyToPush(deps = {}) {
  async function refreshReadyToPush() {
    try {
      const rows = await fetchAmazonReadyToPushProducts({ limit: 50 });
      renderReadyToPush(rows);
      deps.onLoaded?.();
      return rows;
    } catch {
      showAmazonNotification("Could not load Ready to Push products.", { tone: "error" });
      return [];
    }
  }

  document.addEventListener("amazon:view-change", (event) => {
    const view = event.detail?.view;
    if (view === "ready-to-push") refreshReadyToPush().catch(() => {});
  });

  return { refreshReadyToPush };
}
