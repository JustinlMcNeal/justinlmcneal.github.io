/**
 * Apply Inventory → Parcel Imports deep links via URL query params.
 */

import { activateTab } from "./tabs.js";
import { applyHistoryDeepLinkParams } from "./historyTable.js";

const TAB_IDS = {
  upload: "parcelTabUpload",
  review: "parcelTabReview",
  map: "parcelTabMap",
  cpi: "parcelTabCpi",
  history: "parcelTabHistory",
};

/**
 * @returns {Promise<boolean>} true when deep link handled history load
 */
export async function applyParcelImportsDeepLink() {
  const params = new URLSearchParams(location.search);
  if (!params.toString()) return false;

  const tabKey = params.get("tab");
  const tabId = tabKey ? TAB_IDS[tabKey] : null;
  if (tabId) activateTab(tabId);

  const hasHistoryParams =
    tabKey === "history" ||
    params.has("status") ||
    params.has("received") ||
    params.has("expense") ||
    params.has("search");

  if (hasHistoryParams) {
    await applyHistoryDeepLinkParams({
      status: params.get("status") ?? undefined,
      received: params.get("received") ?? undefined,
      expense: params.get("expense") ?? undefined,
      search: params.get("search") ?? undefined,
    });
    return true;
  }

  return Boolean(tabId);
}
