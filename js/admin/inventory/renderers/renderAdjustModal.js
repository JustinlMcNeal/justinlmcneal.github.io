/**
 * Render manual adjustment modal markup (rendering only).
 */

import { esc } from "../utils/formatters.js";
import { ADJUSTMENT_REASONS } from "../api/adjustInventoryApi.js";
import { renderAdjustChannelPreviewShell } from "./renderAdjustChannelPreview.js";

/**
 * @param {import('../services/mapWorkspaceRow.js').InventoryRow} row
 */
export function renderAdjustModalContent(row) {
  const reasonOptions = ADJUSTMENT_REASONS.map(
    (r) => `<option value="${esc(r.value)}">${esc(r.label)}</option>`,
  ).join("");

  return `
    <div class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" data-adjust-overlay>
      <div class="absolute inset-0 bg-black/50" data-adjust-close aria-hidden="true"></div>
      <div
        class="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl border-4 border-black shadow-xl max-h-[92vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventoryAdjustTitle"
      >
        <header class="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <p class="text-[10px] font-black uppercase tracking-[.16em] text-gray-500">Manual adjustment</p>
            <h2 id="inventoryAdjustTitle" class="text-base font-black text-gray-900 mt-0.5">Adjust Stock</h2>
          </div>
          <button type="button" data-adjust-close class="p-2 text-gray-500 hover:text-gray-900 min-h-[44px] min-w-[44px]" aria-label="Close">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </header>

        <form id="inventoryAdjustForm" class="p-4 space-y-4">
          <div class="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p class="font-bold text-sm text-gray-900">${esc(row.title)}</p>
            <p class="text-xs text-gray-600 mt-0.5">${esc(row.variantDetail || row.variant)}</p>
            <p class="text-[11px] font-mono text-gray-500 mt-1">${esc(row.internalSku)}</p>
            <p class="text-xs font-black text-gray-700 mt-2">Current on hand: <span class="font-mono tabular-nums" data-adjust-current>${row.onHand}</span></p>
          </div>

          <fieldset class="space-y-2">
            <legend class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">Adjustment type</legend>
            <div class="flex flex-wrap gap-2">
              <label class="inline-flex items-center gap-2 border-2 border-black px-3 py-2 text-xs font-bold cursor-pointer has-[:checked]:bg-black has-[:checked]:text-white min-h-[44px]">
                <input type="radio" name="adjustMode" value="add" checked class="accent-black" /> Add stock
              </label>
              <label class="inline-flex items-center gap-2 border-2 border-black px-3 py-2 text-xs font-bold cursor-pointer has-[:checked]:bg-black has-[:checked]:text-white min-h-[44px]">
                <input type="radio" name="adjustMode" value="remove" class="accent-black" /> Remove stock
              </label>
              <label class="inline-flex items-center gap-2 border-2 border-black px-3 py-2 text-xs font-bold cursor-pointer has-[:checked]:bg-black has-[:checked]:text-white min-h-[44px]">
                <input type="radio" name="adjustMode" value="set" class="accent-black" /> Set exact qty
              </label>
            </div>
          </fieldset>

          <div>
            <label for="inventoryAdjustQty" class="block text-[10px] font-black uppercase tracking-[.14em] text-gray-500 mb-1">Quantity</label>
            <input id="inventoryAdjustQty" name="quantity" type="number" min="0" step="1" inputmode="numeric" required class="w-full border-4 border-black px-3 py-2.5 text-base font-mono tabular-nums" placeholder="0" />
          </div>

          <div>
            <label for="inventoryAdjustReason" class="block text-[10px] font-black uppercase tracking-[.14em] text-gray-500 mb-1">Reason</label>
            <select id="inventoryAdjustReason" name="reason" required class="w-full border-2 border-black px-3 py-2.5 text-sm font-bold bg-white min-h-[44px]">
              <option value="">Select reason…</option>
              ${reasonOptions}
            </select>
          </div>

          <div>
            <label for="inventoryAdjustNote" class="block text-[10px] font-black uppercase tracking-[.14em] text-gray-500 mb-1">Note <span class="text-gray-400 normal-case font-medium">(required)</span></label>
            <textarea id="inventoryAdjustNote" name="note" rows="3" required class="w-full border-2 border-black px-3 py-2 text-sm resize-y min-h-[80px]" placeholder="Describe why this adjustment is needed…"></textarea>
          </div>

          <div class="rounded-xl border-2 border-dashed border-gray-300 p-3 space-y-1 text-sm" data-adjust-preview>
            <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">Stock preview</p>
            <p>Current: <span class="font-mono font-bold tabular-nums" data-preview-current>${row.onHand}</span></p>
            <p>Delta: <span class="font-mono font-bold tabular-nums" data-preview-delta>—</span></p>
            <p>New stock: <span class="font-mono font-black tabular-nums" data-preview-new>—</span></p>
          </div>

          ${renderAdjustChannelPreviewShell()}

          <p class="hidden text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-adjust-negative-warning role="alert">
            Warning: this adjustment will result in negative on-hand stock. Negative stock is allowed but will appear as an inventory issue.
          </p>

          <p class="hidden text-xs font-bold text-red-700" data-adjust-form-error role="alert"></p>

          <div class="flex flex-col-reverse sm:flex-row gap-2 pt-1">
            <button type="button" data-adjust-close class="flex-1 border-2 border-black bg-white text-black px-4 py-3 text-sm font-black min-h-[44px] hover:bg-gray-50">Cancel</button>
            <button type="submit" data-adjust-submit class="flex-1 border-4 border-black bg-black text-white px-4 py-3 text-sm font-black min-h-[44px] hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed">Confirm adjustment</button>
          </div>
        </form>
      </div>
    </div>
  `;
}
