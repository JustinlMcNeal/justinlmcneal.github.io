/**
 * Bundle rule add/edit form with variant pickers (Phase 10B).
 */

import { esc } from "../utils/formatters.js";
import { renderVariantPickerField, wireAllVariantPickers, toPickerSelection } from "./bundleVariantPicker.js";
import { fetchVariantSearchById } from "../api/bundlePreviewApi.js";

/** @typedef {import('./bundleVariantPicker.js').VariantPickerSelection} Selection */
/** @typedef {import('../api/bundlePreviewApi.js').BundleAvailabilityPreview} RuleRow */

/** @type {Record<string, Selection|null>} */
const pickerState = { bundleVariantId: null, componentVariantId: null };

/** @type {RuleRow|null} */
let editingRule = null;

/** @param {RuleRow|null} rule */
export function setEditingRule(rule) {
  editingRule = rule;
}

export function clearEditingRule() {
  editingRule = null;
  pickerState.bundleVariantId = null;
  pickerState.componentVariantId = null;
}

/** @param {Selection|null} bundle @param {Selection|null} component */
export function renderBundleRuleForm(bundle = null, component = null) {
  const qty = editingRule?.componentQty ?? 1;
  const notes = editingRule?.notes ?? "";
  return `
    <form id="bundleRuleForm" class="space-y-3 text-[10px]">
      <input type="hidden" name="ruleId" value="${esc(editingRule?.ruleId ?? "")}" />
      ${renderVariantPickerField({ fieldKey: "bundleVariantId", label: "Bundle variant", selected: bundle })}
      ${renderVariantPickerField({ fieldKey: "componentVariantId", label: "Component variant", selected: component })}
      <label class="block">Qty per bundle
        <input name="componentQty" type="number" min="0.0001" step="any" required value="${qty}" class="w-full border rounded px-2 py-1 mt-0.5" />
      </label>
      <label class="block">Notes
        <input name="notes" value="${esc(notes)}" class="w-full border rounded px-2 py-1 mt-0.5" placeholder="optional" />
      </label>
      <div class="flex flex-wrap gap-2">
        <button type="submit" class="flex-1 border-2 border-indigo-700 text-indigo-800 px-3 py-2 font-black uppercase tracking-wide min-h-[36px]">
          ${editingRule ? "Update Rule (Preview Config)" : "Save Rule (Preview Config)"}
        </button>
        ${editingRule ? `<button type="button" data-cancel-edit class="border-2 border-gray-300 text-gray-600 px-3 py-2 font-black uppercase min-h-[36px]">Cancel edit</button>` : ""}
      </div>
    </form>`;
}

/** @param {HTMLElement} mount @param {(fieldKey: string, sel: Selection|null) => void} onPickerChange */
export function mountBundleRuleForm(mount, onPickerChange) {
  mount.innerHTML = renderBundleRuleForm(pickerState.bundleVariantId, pickerState.componentVariantId);
  wireAllVariantPickers(mount, (fieldKey, sel) => {
    pickerState[fieldKey] = sel;
    onPickerChange(fieldKey, sel);
  });
}

/** @param {string} variantId @param {"bundleVariantId"|"componentVariantId"} field */
export async function prefillPickerVariant(variantId, field) {
  const row = await fetchVariantSearchById(variantId);
  if (row) pickerState[field] = toPickerSelection(row);
}

/** @returns {{ bundle: Selection|null, component: Selection|null }} */
export function getPickerState() {
  return {
    bundle: pickerState.bundleVariantId,
    component: pickerState.componentVariantId,
  };
}

/** @param {RuleRow} rule */
export async function loadRuleForEdit(rule) {
  editingRule = rule;
  await Promise.all([
    prefillPickerVariant(rule.bundleVariantId, "bundleVariantId"),
    prefillPickerVariant(rule.componentVariantId, "componentVariantId"),
  ]);
}
