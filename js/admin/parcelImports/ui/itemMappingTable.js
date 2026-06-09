/** Item mapping table — real product/variant mapping (Phase 7). */

import { MAPPING_TYPE_OPTIONS, TRUNCATE_ITEM_NAME, TRUNCATE_SELLER } from "../constants.js";
import { getDom } from "../dom.js";
import { statusPillClasses } from "../mapping/mappingState.js";
import { formatCny, truncateText } from "../parser/normalizers.js";
import { getState, updateRowMappingField } from "../state.js";
import { renderCpiPreviewFromState } from "./cpiPreviewPanel.js";
import {
  buildProductPickerHtml,
  buildVariantPickerHtml,
  hydrateProductPickers,
  initProductPickerListeners,
} from "./productVariantPicker.js";
import { renderStatsFromParse } from "./stats.js";

let mappingListenersBound = false;

/** @param {object[]} items */
export function renderItemMappingTable(items) {
  const { mappingTbody } = getDom();
  if (!mappingTbody) return;

  if (!items.length) {
    mappingTbody.innerHTML = `
      <tr>
        <td colspan="13" class="px-4 py-10 text-center text-sm text-gray-500">
          Upload a Baestao file or open a saved import to map items.
        </td>
      </tr>`;
    clearMappingChips();
    return;
  }

  mappingTbody.innerHTML = "";

  const { rowMappings } = getState();
  const itemByRow = new Map(items.map((i) => [i.rowNumber, i]));

  rowMappings.forEach((mapping) => {
    const item = itemByRow.get(mapping.rowNumber);
    if (item) mappingTbody.appendChild(buildMappingRow(item, mapping));
  });

  void hydrateProductPickers(rowMappings);

  const { derived } = getState();
  if (derived) {
    renderMappingChips(derived);
    renderMappingFooter(derived.rowCount);
    updateMappingToolbarNote(derived.rowCount);
    renderStatsFromParse(derived);
  }
  renderCpiPreviewFromState();
}

export function initMappingListeners() {
  initProductPickerListeners();
  if (mappingListenersBound) return;
  const { mappingTbody } = getDom();
  if (!mappingTbody) return;

  mappingTbody.addEventListener("change", onMappingChange);
  document.addEventListener("parcel-mapping-changed", onParcelMappingChanged);
  mappingListenersBound = true;
}

function onMappingChange(e) {
  const el = e.target;
  if (!(el instanceof HTMLSelectElement)) return;
  const field = el.getAttribute("data-mapping-field");
  const rowNumber = Number(el.getAttribute("data-mapping-row"));
  if (!field || !Number.isFinite(rowNumber)) return;

  updateRowMappingField(rowNumber, field, el.value);
  refreshMappingRowUi(rowNumber);
  refreshMappingSummaryUi();
}

function onParcelMappingChanged(e) {
  const rowNumber = e.detail?.rowNumber;
  if (Number.isFinite(rowNumber)) refreshMappingRowUi(rowNumber);
  refreshMappingSummaryUi();
}

/** @param {number} rowNumber */
function refreshMappingRowUi(rowNumber) {
  const tr = document.querySelector(`tr[data-mapping-row="${rowNumber}"]`);
  const { rowMappings } = getState();
  const mapping = rowMappings.find((r) => r.rowNumber === rowNumber);
  if (!tr || !mapping) return;

  const statusEl = tr.querySelector("[data-mapping-status]");
  if (statusEl) {
    statusEl.textContent = mapping.mappingStatus;
    statusEl.className = `text-[10px] font-black uppercase tracking-wide border rounded-full px-2 py-0.5 whitespace-nowrap ${statusPillClasses(mapping.mappingStatus)}`;
  }

  syncSelectValue(tr, "rowType", mapping.rowType);
}

function refreshMappingSummaryUi() {
  const { derived } = getState();
  if (!derived) return;
  renderMappingChips(derived);
  renderStatsFromParse(derived);
  renderCpiPreviewFromState();
}

/** @param {Element} tr @param {string} field @param {string} value */
function syncSelectValue(tr, field, value) {
  const sel = tr.querySelector(`[data-mapping-field="${field}"]`);
  if (sel instanceof HTMLSelectElement && sel.value !== value) {
    sel.value = value;
  }
}

/** @param {object} item @param {object} mapping */
function buildMappingRow(item, mapping) {
  const fullName = item.sourceItemName || "—";
  const shortName = truncateText(fullName, TRUNCATE_ITEM_NAME);
  const seller = item.sellerName || "—";
  const shortSeller = truncateText(seller, TRUNCATE_SELLER);
  const statusClass = statusPillClasses(mapping.mappingStatus);
  const rowNo = mapping.exportRowNo ?? item.rowNumber;

  const tr = document.createElement("tr");
  tr.className = "hover:bg-gray-50/80";
  tr.setAttribute("data-mapping-row", String(mapping.rowNumber));

  tr.innerHTML = `
    <td class="px-2 py-2"><input type="checkbox" disabled aria-label="Select row ${rowNo}" class="w-4 h-4 border-2 border-gray-400 rounded-sm cursor-not-allowed opacity-60" /></td>
    <td class="px-2 py-2 tabular-nums text-gray-500">${rowNo}</td>
    <td class="px-3 py-2 max-w-[200px]">
      <span class="block truncate" title="${escapeAttr(fullName)}">${escapeHtml(shortName)}</span>
    </td>
    <td class="px-2 py-2 text-xs text-gray-800 max-w-[120px]">
      <span class="block truncate" title="${escapeAttr(seller)}">${escapeHtml(shortSeller)}</span>
    </td>
    <td class="px-2 py-2 font-mono text-xs">${escapeHtml(item.baestaoOrderId || "—")}</td>
    <td class="px-2 py-2 text-right tabular-nums">${formatCny(item.unitPriceCny)}</td>
    <td class="px-2 py-2 text-right tabular-nums">${item.quantity ?? "—"}</td>
    <td class="px-2 py-2 text-right tabular-nums">${item.itemWeightGrams ?? "—"}</td>
    <td class="px-2 py-2 text-right tabular-nums">${formatCny(item.sellerFreightCny ?? 0)}</td>
    <td class="px-3 py-2">${buildProductPickerHtml(mapping)}</td>
    <td class="px-2 py-2">${buildVariantPickerHtml(mapping)}</td>
    <td class="px-2 py-2">${buildTypeSelect(mapping)}</td>
    <td class="px-2 py-2 text-center">
      <span data-mapping-status class="text-[10px] font-black uppercase tracking-wide ${statusClass} border rounded-full px-2 py-0.5 whitespace-nowrap">${escapeHtml(mapping.mappingStatus)}</span>
    </td>
  `;

  return tr;
}

/** @param {object} mapping */
function buildTypeSelect(mapping) {
  const opts = MAPPING_TYPE_OPTIONS.map((o) => {
    const sel = o === mapping.rowType ? " selected" : "";
    return `<option value="${escapeAttr(o)}"${sel}>${escapeHtml(o)}</option>`;
  }).join("");

  return `<select data-mapping-field="rowType" data-mapping-row="${mapping.rowNumber}" aria-label="Type row ${mapping.rowNumber}" class="w-full border-2 border-gray-200 rounded-lg bg-white px-2 py-1.5 text-xs text-gray-900">${opts}</select>`;
}

export function clearMappingChips() {
  const { mappingChipFields, mappingRangeText } = getDom();
  const keys = [
    "mapChipRowsImported",
    "mapChipMatched",
    "mapChipVariantUncertain",
    "mapChipPersonalExcluded",
    "mapChipNeedMapping",
  ];
  keys.forEach((key) => {
    const el = mappingChipFields?.[key];
    if (el) el.textContent = "—";
  });
  if (mappingRangeText) mappingRangeText.textContent = "";
  const note = document.getElementById("parcelMappingParseNote");
  if (note) {
    note.textContent = "Upload a file to parse and map Baestao rows.";
  }
}

/** @param {object} counts */
function renderMappingChips(counts) {
  const { mappingChipFields } = getDom();
  if (!mappingChipFields) return;

  const set = (key, label) => {
    const el = mappingChipFields[key];
    if (el) el.textContent = label;
  };

  const n = counts.rowCount;
  set("mapChipRowsImported", `${n} row${n === 1 ? "" : "s"} imported`);
  set("mapChipMatched", `${counts.matchedCount} matched`);
  set("mapChipVariantUncertain", `${counts.variantUncertainCount} variant uncertain`);
  set("mapChipPersonalExcluded", `${counts.personalExcludedCount} personal / excluded`);
  set("mapChipNeedMapping", `${counts.needsMappingCount} need mapping`);
}

/** @param {number} rowCount */
function renderMappingFooter(rowCount) {
  const { mappingRangeText } = getDom();
  if (mappingRangeText && rowCount > 0) {
    mappingRangeText.textContent = `Showing 1 to ${rowCount} of ${rowCount} imported rows`;
  }
}

function updateMappingToolbarNote(count) {
  const note = document.getElementById("parcelMappingParseNote");
  if (note) {
    note.textContent = `Parsed ${count} row(s) — search products and select variants per row.`;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
