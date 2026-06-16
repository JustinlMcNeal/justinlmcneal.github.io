/** Shared Playwright helpers for Parcel Imports tab panels. */

export const PARCEL_TAB_PANELS = {
  parcelTabUpload: "parcelImportUploadSummary",
  parcelTabReview: "parcelImportChargeOverrides",
  parcelTabMap: "parcelImportItemMapping",
  parcelTabCpi: "parcelImportCpiPreview",
  parcelTabHistory: "parcelImportHistory",
};

/** @param {import('@playwright/test').Page} page @param {keyof typeof PARCEL_TAB_PANELS} tabId */
export async function goToParcelTab(page, tabId) {
  const panelId = PARCEL_TAB_PANELS[tabId];
  if (!panelId) throw new Error(`Unknown parcel tab: ${tabId}`);

  await page.locator(`#${tabId}`).click();
  await page.waitForFunction(
    (pid) => {
      const panel = document.getElementById(pid);
      return panel && !panel.classList.contains("hidden") && !panel.hidden;
    },
    panelId,
    { timeout: 5000 },
  );
}
