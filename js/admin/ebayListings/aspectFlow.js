/**
 * aspectFlow.js — Fetch-and-render bridge for eBay aspect (item specifics) fields.
 *
 * Sits between taxonomyApi.js (raw API wrappers) and aspectHelpers.js (field markup).
 * Owns the fetch → normalize → render → callback pipeline.
 *
 * Exports:
 *   fetchAndRenderAspects — fetch aspects for a category ID and render into target containers
 *
 * Does NOT own:
 *   currentAspects / editAspects  — state stays in index.js (passed back via onAspects callback)
 *   DOM IDs                        — resolved by the caller; elements passed as params
 *   openPush / openEdit            — stay in index.js
 *   category search button handler — stays in index.js
 *   payload assembly               — stays in index.js
 *   showStatus globally            — not used here; errors written to loadingEl by contract
 */

import { fetchAspectsForCategory } from "./taxonomyApi.js";

/**
 * Fetches eBay item specifics for a category and renders them into the provided containers.
 *
 * Behavior preserved exactly from the inline fetchAspects() in index.js:
 *   - Shows sectionEl and loadingEl before the fetch
 *   - Clears containers and resets aspect state (onAspects([])) before the fetch
 *   - On empty/failed result: writes message to loadingEl, does not hide it
 *   - On success: calls onAspects(aspects), renders required (all) + optional (first 15),
 *     then hides loadingEl
 *   - On thrown error: writes error message to loadingEl
 *
 * @param {object}      opts
 * @param {string}      opts.categoryId    - eBay category ID to fetch aspects for
 * @param {HTMLElement} opts.sectionEl     - wrapper element to show (remove "hidden")
 * @param {HTMLElement} opts.loadingEl     - loading/error text element
 * @param {HTMLElement} opts.reqContainer  - mount point for required aspect fields
 * @param {HTMLElement} opts.optContainer  - mount point for optional aspect fields
 * @param {Function}    opts.buildField    - (aspect, defaults, isRequired) => HTMLElement
 * @param {object}      [opts.defaults={}] - pre-seeded default values keyed by aspect name
 * @param {Function}    opts.onAspects     - called with raw aspects array (empty on reset/error)
 */
export async function fetchAndRenderAspects({
  categoryId,
  sectionEl,
  loadingEl,
  reqContainer,
  optContainer,
  buildField,
  defaults = {},
  onAspects,
}) {
  sectionEl.classList.remove("hidden");
  loadingEl.classList.remove("hidden");
  reqContainer.innerHTML = "";
  optContainer.innerHTML = "";
  onAspects([]);

  try {
    const result = await fetchAspectsForCategory(categoryId);
    if (!result.success || !result.aspects?.length) {
      loadingEl.textContent = "No item specifics found for this category";
      return;
    }

    onAspects(result.aspects);
    const required = result.aspects.filter(a => a.required);
    const optional = result.aspects.filter(a => !a.required).slice(0, 15);

    required.forEach(a => reqContainer.appendChild(buildField(a, defaults, true)));
    optional.forEach(a => optContainer.appendChild(buildField(a, defaults, false)));
    loadingEl.classList.add("hidden");
  } catch (e) {
    loadingEl.textContent = "Failed to load item specifics: " + e.message;
  }
}
