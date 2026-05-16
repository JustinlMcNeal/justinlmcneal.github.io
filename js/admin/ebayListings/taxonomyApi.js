/**
 * taxonomyApi.js — Pure wrappers around the ebay-taxonomy Edge Function.
 *
 * Exports:
 *   fetchAspectsForCategory(categoryId) — calls get_aspects, returns raw result
 *   fetchCategorySuggestions(query)     — calls suggest_category, returns raw result
 *
 * Does NOT own:
 *   currentAspects / editAspects         — state stays in index.js
 *   DOM rendering of aspect fields       — stays in index.js
 *   category input event listeners       — stay in index.js
 *   modal open flows (openPush/openEdit) — stay in index.js
 *   create/update payload assembly       — stays in index.js
 *   showStatus / error UI                — stays in index.js
 */

import { callEdge } from "./api.js";

/**
 * Fetches item specifics (aspects) for a given eBay category ID.
 * Returns the raw Edge Function result ({ success, aspects, ... }).
 *
 * @param {string|number} categoryId
 * @returns {Promise<object>}
 */
export async function fetchAspectsForCategory(categoryId) {
  return callEdge("ebay-taxonomy", { action: "get_aspects", categoryId });
}

/**
 * Fetches eBay category suggestions for a search query.
 * Returns the raw Edge Function result ({ success, suggestions, ... }).
 *
 * @param {string} query
 * @returns {Promise<object>}
 */
export async function fetchCategorySuggestions(query) {
  return callEdge("ebay-taxonomy", { action: "suggest_category", query });
}
