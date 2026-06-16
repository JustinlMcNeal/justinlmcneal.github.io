/**
 * Bundle mode controls (Phase 10D — preview_only / shadow only; live disabled).
 */

import { esc } from "../utils/formatters.js";
import {
  fetchBundleGlobalSettings,
  updateBundleGlobalMode,
  updateBundleVariantMode,
} from "../api/bundleShadowApi.js";
import { showInventoryToast } from "../events.js";

const MODE_OPTIONS = [
  { value: "preview_only", label: "Preview only" },
  { value: "shadow", label: "Shadow (checkout log)" },
];

/** @returns {Promise<string>} */
export async function renderGlobalModeControls() {
  const settings = await fetchBundleGlobalSettings();
  const options = MODE_OPTIONS.map(
    (o) =>
      `<option value="${esc(o.value)}" ${settings.globalMode === o.value ? "selected" : ""}>${esc(o.label)}</option>`,
  ).join("");

  return `
    <section class="border border-gray-200 rounded-lg p-3" data-bundle-global-mode-section>
      <h3 class="text-[10px] font-black uppercase text-gray-400 mb-2">Global virtual bundle mode</h3>
      <div class="flex flex-wrap gap-2 items-center">
        <select data-global-bundle-mode class="border border-gray-300 rounded px-2 py-1 text-[11px]">${options}</select>
        <button type="button" data-save-global-mode class="border-2 border-indigo-600 text-indigo-800 px-3 py-1 text-[10px] font-black uppercase">Save</button>
      </div>
      <p class="text-[10px] text-gray-500 mt-2">
        Shadow mode logs checkout/ship shadow events only — no inventory changes.
        Live mode requires allow-per-bundle-live and explicit per-bundle enablement (Phase 10F).
      </p>
    </section>`;
}

/**
 * @param {string} bundleVariantId
 * @param {string} currentMode
 */
export function renderBundleModeSelect(bundleVariantId, currentMode = "preview_only") {
  const options = MODE_OPTIONS.map(
    (o) =>
      `<option value="${esc(o.value)}" ${currentMode === o.value ? "selected" : ""}>${esc(o.label)}</option>`,
  ).join("");

  return `
    <div class="flex flex-wrap gap-2 items-center mt-2" data-bundle-variant-mode="${esc(bundleVariantId)}">
      <label class="text-[9px] font-black uppercase text-gray-500">Bundle mode</label>
      <select data-variant-bundle-mode class="border border-gray-300 rounded px-2 py-1 text-[10px]">${options}</select>
      <button type="button" data-save-variant-mode class="text-[9px] font-black uppercase text-indigo-700">Save</button>
    </div>`;
}

/** @param {HTMLElement} container @param {() => Promise<void>} reload */
export function wireGlobalModeControls(container, reload) {
  container.querySelector("[data-save-global-mode]")?.addEventListener("click", async () => {
    const select = container.querySelector("[data-global-bundle-mode]");
    if (!(select instanceof HTMLSelectElement)) return;
    try {
      await updateBundleGlobalMode(select.value);
      showInventoryToast("Global bundle mode updated.", { variant: "success" });
      await reload();
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });
}

/** @param {HTMLElement} container @param {() => Promise<void>} reload */
export function wireVariantModeControls(container, reload) {
  container.querySelectorAll("[data-bundle-variant-mode]").forEach((wrap) => {
    const variantId = wrap.getAttribute("data-bundle-variant-mode");
    if (!variantId) return;
    wrap.querySelector("[data-save-variant-mode]")?.addEventListener("click", async () => {
      const select = wrap.querySelector("[data-variant-bundle-mode]");
      if (!(select instanceof HTMLSelectElement)) return;
      try {
        await updateBundleVariantMode(variantId, select.value, select.value === "shadow");
        showInventoryToast("Bundle mode updated.", { variant: "success" });
        await reload();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });
  });
}
