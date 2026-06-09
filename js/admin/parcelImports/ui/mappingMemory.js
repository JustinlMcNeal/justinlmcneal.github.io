/** DB-backed mapping memory suggestions (Phase 7). */

import { PLACEHOLDER_VARIANT } from "../constants.js";
import { findMappingSuggestions } from "../api/mappingMemoryApi.js";
import { getState, setMappingSuggestions, updateRowProductMapping } from "../state.js";
import { renderItemMappingTable } from "./itemMappingTable.js";

let listenersBound = false;

export function initMappingMemoryUi() {
  const list = document.getElementById("parcelMatchSuggestionsList");
  if (!list || listenersBound) return;

  list.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-apply-suggestion]");
    if (!btn) return;
    const rowNumber = Number(btn.getAttribute("data-target-row"));
    const suggestionId = btn.getAttribute("data-suggestion-id");
    if (!Number.isFinite(rowNumber) || !suggestionId) return;
    applySuggestionToRow(rowNumber, suggestionId);
  });

  listenersBound = true;
}

export async function refreshMappingSuggestions() {
  const state = getState();
  if (!state.sessionReady || !state.adminOk || !state.items.length) {
    setMappingSuggestions([]);
    renderMappingSuggestions([]);
    return;
  }

  const targetItem =
    state.items.find((item) => {
      const mapping = state.rowMappings.find((r) => r.rowNumber === item.rowNumber);
      return mapping?.mappingStatus === "Needs Mapping" || !mapping?.productId;
    }) || state.items[0];

  try {
    const suggestions = await findMappingSuggestions({
      sellerName: targetItem?.sellerName,
      sourceItemName: targetItem?.sourceItemName,
    });
    setMappingSuggestions(suggestions);
    renderMappingSuggestions(suggestions, targetItem?.rowNumber);
  } catch (err) {
    console.warn("[parcelImports] mapping suggestions failed", err);
    setMappingSuggestions([]);
    renderMappingSuggestions([], targetItem?.rowNumber, err.message);
  }
}

/**
 * @param {object[]} [suggestions]
 * @param {number | null} [targetRow]
 * @param {string} [errorMessage]
 */
export function renderMappingSuggestions(
  suggestions = getState().mappingSuggestions,
  targetRow = null,
  errorMessage = "",
) {
  const note = document.getElementById("parcelMatchSuggestionsNote");
  const list = document.getElementById("parcelMatchSuggestionsList");
  if (!note || !list) return;

  const state = getState();
  if (!state.items.length) {
    note.textContent = "Upload a parcel file to load mapping suggestions.";
    list.innerHTML = "";
    return;
  }

  const row =
    targetRow ??
    state.items.find((item) => {
      const mapping = state.rowMappings.find((r) => r.rowNumber === item.rowNumber);
      return !mapping?.productId;
    })?.rowNumber ??
    state.items[0]?.rowNumber;

  if (errorMessage) {
    note.textContent = `Suggestions unavailable: ${errorMessage}`;
    list.innerHTML = "";
    return;
  }

  if (!suggestions.length) {
    note.textContent =
      "No saved mapping memory yet for this seller/title. Map a row and save draft to build memory.";
    list.innerHTML = "";
    return;
  }

  note.textContent = `Showing ${suggestions.length} saved suggestion(s) for row ${row}.`;

  list.innerHTML = suggestions
    .map((s) => {
      const confidence =
        s.confidence_score != null
          ? `${Math.round(Number(s.confidence_score) * 100)}%`
          : "saved";
      return `
        <li class="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-green-200 bg-green-50/40 px-3 py-3 sm:px-4">
          <div class="flex-1 min-w-0">
            <p class="text-[10px] font-black uppercase tracking-[.12em] text-green-800">Saved mapping memory</p>
            <p class="text-sm text-gray-800 mt-1 leading-snug">
              <span class="font-medium">${escapeHtml(s.seller_name || "Unknown seller")}</span>
              → <span class="font-semibold">${escapeHtml(s.productName)}</span>
              <span class="text-gray-600"> / ${escapeHtml(s.variantLabel)}</span>
            </p>
            <span class="inline-block mt-2 text-[10px] font-black uppercase tracking-wide text-green-800 bg-green-100 border border-green-200 rounded-full px-2 py-0.5">
              ${escapeHtml(confidence)} · used ${escapeHtml(String(s.usage_count ?? 1))}×
            </span>
          </div>
          <button
            type="button"
            data-apply-suggestion
            data-suggestion-id="${escapeAttr(s.id)}"
            data-target-row="${row}"
            class="shrink-0 border-2 border-green-700 bg-white text-green-800 px-3 py-2 text-[10px] font-black uppercase tracking-[.12em] min-h-[40px] hover:bg-green-100"
          >
            Apply to row ${row}
          </button>
        </li>`;
    })
    .join("");
}

/**
 * @param {number} rowNumber
 * @param {string} suggestionId
 */
export function applySuggestionToRow(rowNumber, suggestionId) {
  const suggestion = getState().mappingSuggestions.find((s) => s.id === suggestionId);
  if (!suggestion) return;

  updateRowProductMapping(rowNumber, {
    productId: suggestion.product_id,
    productVariantId: suggestion.product_variant_id ?? null,
    mappedProductLabel: suggestion.mappedProductLabel || suggestion.productName,
    mappedVariantLabel: suggestion.mappedVariantLabel || PLACEHOLDER_VARIANT,
    mappingSource: "mapping_memory",
  });

  renderItemMappingTable(getState().items);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
