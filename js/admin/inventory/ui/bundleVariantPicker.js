/**
 * Searchable variant picker for bundle rule configuration (Phase 10B).
 */

import { esc } from "../utils/formatters.js";
import { searchInventoryVariants } from "../api/bundlePreviewApi.js";

/** @typedef {import('../api/bundlePreviewApi.js').VariantSearchResult} VariantSearchResult */

/**
 * @typedef {Object} VariantPickerSelection
 * @property {string} variantId
 * @property {string} label
 * @property {string} sku
 * @property {number} onHand
 * @property {number} available
 * @property {boolean} isActive
 */

/** @param {VariantSearchResult} row @returns {VariantPickerSelection} */
export function toPickerSelection(row) {
  return {
    variantId: row.variantId,
    label: row.productTitle + (row.variantLabel ? ` · ${row.variantLabel}` : ""),
    sku: row.internalSku || "—",
    onHand: row.onHand,
    available: row.available,
    isActive: row.isActive,
  };
}

/**
 * @param {Object} opts
 * @param {string} opts.fieldKey
 * @param {string} opts.label
 * @param {VariantPickerSelection|null} [opts.selected]
 */
export function renderVariantPickerField(opts) {
  const sel = opts.selected;
  return `
    <div class="bundle-variant-picker" data-picker-key="${esc(opts.fieldKey)}">
      <label class="block text-[10px] font-black uppercase text-gray-500 mb-1">${esc(opts.label)}</label>
      <input type="hidden" name="${esc(opts.fieldKey)}" value="${esc(sel?.variantId ?? "")}" data-picker-value />
      <input type="search" autocomplete="off" placeholder="Search title or SKU…" class="w-full border rounded px-2 py-1.5 text-[11px]" data-picker-search />
      ${
        sel
          ? `<div class="mt-1 border border-indigo-200 bg-indigo-50 rounded px-2 py-1.5 text-[10px]" data-picker-selected>
              <p class="font-bold">${esc(sel.label)}</p>
              <p class="font-mono text-gray-600">${esc(sel.sku)} · on-hand ${sel.onHand} · avail ${sel.available}</p>
              <button type="button" class="text-[9px] font-black uppercase text-gray-500 hover:underline mt-0.5" data-picker-clear>Clear</button>
            </div>`
          : `<p class="text-[10px] text-gray-400 mt-1" data-picker-placeholder>No variant selected</p>`
      }
      <div class="hidden mt-1 border border-gray-200 rounded max-h-36 overflow-y-auto bg-white shadow-sm" data-picker-results role="listbox"></div>
    </div>`;
}

/** @param {HTMLElement} root @param {(fieldKey: string, selection: VariantPickerSelection|null) => void} [onChange] */
export function wireVariantPicker(root, onChange) {
  const picker = root.classList.contains("bundle-variant-picker")
    ? root
    : root.querySelector(".bundle-variant-picker");
  if (!picker) return;

  const fieldKey = picker.getAttribute("data-picker-key") || "";
  const valueInput = /** @type {HTMLInputElement|null} */ (picker.querySelector("[data-picker-value]"));
  const searchInput = /** @type {HTMLInputElement|null} */ (picker.querySelector("[data-picker-search]"));
  const resultsEl = picker.querySelector("[data-picker-results]");
  if (!valueInput || !searchInput || !resultsEl) return;

  let debounce = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

  function setSelection(sel) {
    valueInput.value = sel?.variantId ?? "";
    onChange?.(fieldKey, sel);
    const label = picker.querySelector("label")?.textContent || fieldKey;
    const replacement = renderVariantPickerField({ fieldKey, label, selected: sel });
    const temp = document.createElement("div");
    temp.innerHTML = replacement;
    const next = temp.firstElementChild;
    if (next?.parentNode && picker.parentNode) {
      picker.parentNode.replaceChild(next, picker);
      wireVariantPicker(/** @type {HTMLElement} */ (next), onChange);
    }
  }

  picker.querySelector("[data-picker-clear]")?.addEventListener("click", () => setSelection(null));

  searchInput.addEventListener("input", () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const q = searchInput.value.trim();
      if (q.length < 2) {
        resultsEl.classList.add("hidden");
        resultsEl.innerHTML = "";
        return;
      }
      try {
        const rows = await searchInventoryVariants(q, 12);
        if (!rows.length) {
          resultsEl.innerHTML = `<p class="p-2 text-[10px] text-gray-400">No matches</p>`;
        } else {
          resultsEl.innerHTML = rows
            .map(
              (r, idx) => `
            <button type="button" class="block w-full text-left px-2 py-1.5 text-[10px] hover:bg-indigo-50 border-b border-gray-100 last:border-0" data-picker-pick="${idx}">
              <span class="font-bold">${esc(r.productTitle)}</span>
              <span class="block text-gray-600 font-mono">${esc(r.internalSku || r.variantLabel || "—")} · stock ${r.onHand} · avail ${r.available}${!r.isActive ? " · inactive" : ""}</span>
            </button>`,
            )
            .join("");
          resultsEl.querySelectorAll("[data-picker-pick]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const idx = Number(btn.getAttribute("data-picker-pick"));
              const row = rows[idx];
              if (row) setSelection(toPickerSelection(row));
              resultsEl.classList.add("hidden");
            });
          });
        }
        resultsEl.classList.remove("hidden");
      } catch {
        resultsEl.innerHTML = `<p class="p-2 text-[10px] text-red-600">Search failed</p>`;
        resultsEl.classList.remove("hidden");
      }
    }, 250);
  });
}

/** @param {HTMLElement} container @param {(fieldKey: string, selection: VariantPickerSelection|null) => void} [onChange] */
export function wireAllVariantPickers(container, onChange) {
  container.querySelectorAll(".bundle-variant-picker").forEach((el) => {
    wireVariantPicker(/** @type {HTMLElement} */ (el), onChange);
  });
}
