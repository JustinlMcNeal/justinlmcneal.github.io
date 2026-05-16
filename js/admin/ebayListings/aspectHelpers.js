/**
 * aspectHelpers.js — Pure aspect field helpers for Push and Edit modals.
 *
 * Exports:
 *   buildAspectField      — DOM element builder for Push modal aspect inputs
 *   buildEditAspectField  — DOM element builder for Edit modal aspect inputs
 *   collectAspects        — collects [data-aspect] values from DOM
 *   validateRequiredAspects — returns list of missing required [data-aspect] names
 *
 * Does NOT own:
 *   fetchAspects() — stays in index.js (calls callEdge, mutates currentAspects state)
 *   edit aspect collection/validation — those are inlined in the edit save handler
 *   openPush / openEdit — stay in index.js
 *   payload assembly — stays in index.js
 */

import { esc } from "./utils.js";

/**
 * Builds a single aspect input field div for the Push modal.
 * Uses data-aspect attribute and dl_ datalist prefix.
 */
export function buildAspectField(aspect, defaults, isRequired) {
  const div    = document.createElement("div");
  const listId = `dl_${aspect.name.replace(/\W/g, "_")}`;
  const defaultVal = defaults[aspect.name] || "";
  const label  = isRequired ? `${aspect.name} <span class="text-red-500">*</span>` : aspect.name;

  div.innerHTML = `
    <label class="block text-[10px] font-bold uppercase tracking-wider ${isRequired ? "text-black" : "text-gray-500"} mb-0.5">${label}</label>
    <input type="text" data-aspect="${esc(aspect.name)}" data-required="${isRequired}"
      value="${esc(defaultVal)}" list="${listId}"
      class="w-full border-2 ${isRequired ? "border-black" : "border-gray-300"} px-2 py-1.5 text-xs outline-none focus:border-kkpink transition-colors" />
    ${aspect.values?.length
      ? `<datalist id="${listId}">${aspect.values.slice(0, 30).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`
      : ""}
  `;
  return div;
}

/**
 * Builds a single aspect input field div for the Edit modal.
 * Uses data-edit-aspect attribute and edl_ datalist prefix.
 */
export function buildEditAspectField(aspect, defaults, isRequired) {
  const div    = document.createElement("div");
  const listId = `edl_${aspect.name.replace(/\W/g, "_")}`;
  const defaultVal = defaults[aspect.name] || "";
  const label  = isRequired ? `${aspect.name} <span class="text-red-500">*</span>` : aspect.name;

  div.innerHTML = `
    <label class="block text-[10px] font-bold uppercase tracking-wider ${isRequired ? "text-black" : "text-gray-500"} mb-0.5">${label}</label>
    <input type="text" data-edit-aspect="${esc(aspect.name)}" data-required="${isRequired}"
      value="${esc(defaultVal)}" list="${listId}"
      class="w-full border-2 ${isRequired ? "border-black" : "border-gray-300"} px-2 py-1.5 text-xs outline-none focus:border-kkpink transition-colors" />
    ${aspect.values?.length
      ? `<datalist id="${listId}">${aspect.values.slice(0, 30).map(v => `<option value="${esc(v)}">`).join("")}</datalist>`
      : ""}
  `;
  return div;
}

/**
 * Collects all [data-aspect] input values from the Push modal DOM.
 * Returns an object of { aspectName: [value] } (eBay item specifics shape).
 */
export function collectAspects() {
  const aspects = {};
  document.querySelectorAll("[data-aspect]").forEach(input => {
    const val = input.value.trim();
    if (val) aspects[input.dataset.aspect] = [val];
  });
  return aspects;
}

/**
 * Validates required [data-aspect] inputs from the Push modal DOM.
 * Returns an array of missing aspect names (empty array = all filled).
 */
export function validateRequiredAspects() {
  const missing = [];
  document.querySelectorAll("[data-aspect][data-required='true']").forEach(input => {
    if (!input.value.trim()) missing.push(input.dataset.aspect);
  });
  return missing;
}
