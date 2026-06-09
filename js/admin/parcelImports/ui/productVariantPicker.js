/** Product search + variant picker cells for mapping table (Phase 7). */

import { PLACEHOLDER_PRODUCT, PLACEHOLDER_VARIANT } from "../constants.js";
import {
  formatVariantLabel,
  loadProductVariants,
  searchProducts,
} from "../api/productsApi.js";
import { getState, updateRowProductMapping } from "../state.js";

const searchTimers = new Map();

/**
 * @param {object} mapping
 */
export function buildProductPickerHtml(mapping) {
  const label =
    mapping.mappedProductLabel && mapping.mappedProductLabel !== PLACEHOLDER_PRODUCT
      ? mapping.mappedProductLabel
      : "";
  const row = mapping.rowNumber;

  return `
    <div class="relative min-w-[180px]" data-product-picker="${row}">
      <input
        type="search"
        data-product-search
        data-mapping-row="${row}"
        value="${escapeAttr(label)}"
        placeholder="Search product…"
        class="w-full border-2 border-gray-200 rounded-lg bg-white px-2 py-1.5 text-xs text-gray-900"
        aria-label="Search product row ${row}"
      />
      <input type="hidden" data-product-id value="${escapeAttr(mapping.productId || "")}" />
      <div
        data-product-results
        class="hidden absolute left-0 right-0 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg text-xs"
      ></div>
    </div>`;
}

/**
 * @param {object} mapping
 */
export function buildVariantPickerHtml(mapping) {
  const row = mapping.rowNumber;
  const disabled = !mapping.productId ? "disabled" : "";

  return `
    <select
      data-variant-select
      data-mapping-row="${row}"
      ${disabled}
      class="w-full border-2 border-gray-200 rounded-lg bg-white px-2 py-1.5 text-xs text-gray-900 disabled:bg-gray-50 disabled:text-gray-400"
      aria-label="Variant row ${row}"
    >
      <option value="">Select variant…</option>
      <option value="__unknown__"${mapping.mappedVariantLabel === "Unknown" ? " selected" : ""}>Unknown</option>
    </select>`;
}

let listenersBound = false;

export function initProductPickerListeners() {
  if (listenersBound) return;
  const tbody = document.getElementById("parcelMappingTbody");
  if (!tbody) return;

  tbody.addEventListener("input", onProductSearchInput);
  tbody.addEventListener("focusin", onProductSearchFocus);
  tbody.addEventListener("click", onPickerClick);
  tbody.addEventListener("change", onVariantChange);
  document.addEventListener("click", onDocumentClick);
  listenersBound = true;
}

/** @param {object[]} mappings */
export async function hydrateProductPickers(mappings = getState().rowMappings) {
  for (const mapping of mappings) {
    if (!mapping.productId) continue;
    await populateVariantSelect(mapping.rowNumber, mapping.productId, {
      selectedVariantId: mapping.productVariantId,
      selectedLabel: mapping.mappedVariantLabel,
    });
  }
}

/**
 * @param {number} rowNumber
 * @param {string} productId
 * @param {{ selectedVariantId?: string | null, selectedLabel?: string }} [opts]
 */
export async function populateVariantSelect(rowNumber, productId, opts = {}) {
  const select = document.querySelector(
    `[data-variant-select][data-mapping-row="${rowNumber}"]`,
  );
  if (!(select instanceof HTMLSelectElement)) return;

  select.disabled = false;
  select.innerHTML =
    '<option value="">Select variant…</option><option value="__unknown__">Unknown</option>';

  try {
    const variants = await loadProductVariants(productId);
    for (const variant of variants) {
      const opt = document.createElement("option");
      opt.value = variant.id;
      opt.textContent = formatVariantLabel(variant);
      if (opts.selectedVariantId && variant.id === opts.selectedVariantId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }

    if (
      !opts.selectedVariantId &&
      opts.selectedLabel &&
      opts.selectedLabel !== PLACEHOLDER_VARIANT &&
      opts.selectedLabel !== "Unknown"
    ) {
      const match = [...select.options].find((o) => o.textContent === opts.selectedLabel);
      if (match) match.selected = true;
    }

    if (opts.selectedLabel === "Unknown") {
      select.value = "__unknown__";
    }
  } catch (err) {
    console.warn("[parcelImports] variant load failed", err);
  }
}

function onProductSearchInput(e) {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || !input.matches("[data-product-search]")) {
    return;
  }

  const rowNumber = Number(input.getAttribute("data-mapping-row"));
  if (!Number.isFinite(rowNumber)) return;

  const prev = searchTimers.get(rowNumber);
  if (prev) clearTimeout(prev);

  searchTimers.set(
    rowNumber,
    setTimeout(() => void runProductSearch(rowNumber, input.value), 280),
  );
}

function onProductSearchFocus(e) {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || !input.matches("[data-product-search]")) {
    return;
  }
  const rowNumber = Number(input.getAttribute("data-mapping-row"));
  if (input.value.trim().length >= 2) {
    void runProductSearch(rowNumber, input.value);
  }
}

async function runProductSearch(rowNumber, query) {
  const wrap = document.querySelector(`[data-product-picker="${rowNumber}"]`);
  const resultsEl = wrap?.querySelector("[data-product-results]");
  if (!resultsEl) return;

  const q = String(query || "").trim();
  if (q.length < 2) {
    resultsEl.classList.add("hidden");
    resultsEl.innerHTML = "";
    return;
  }

  try {
    const products = await searchProducts(q);
    if (!products.length) {
      resultsEl.innerHTML =
        '<div class="px-3 py-2 text-gray-500">No products found</div>';
      resultsEl.classList.remove("hidden");
      return;
    }

    resultsEl.innerHTML = products
      .map(
        (p) => `
        <button
          type="button"
          data-pick-product
          data-mapping-row="${rowNumber}"
          data-product-id="${escapeAttr(p.id)}"
          data-product-name="${escapeAttr(p.name)}"
          class="block w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
        >
          <span class="font-medium text-gray-900">${escapeHtml(p.name)}</span>
          <span class="block text-[10px] text-gray-500 font-mono">${escapeHtml(p.code || p.id)}</span>
        </button>`,
      )
      .join("");
    resultsEl.classList.remove("hidden");
  } catch (err) {
    resultsEl.innerHTML = `<div class="px-3 py-2 text-red-600">${escapeHtml(err.message || "Search failed")}</div>`;
    resultsEl.classList.remove("hidden");
  }
}

function onPickerClick(e) {
  const btn = e.target.closest("[data-pick-product]");
  if (!btn) return;

  const rowNumber = Number(btn.getAttribute("data-mapping-row"));
  const productId = btn.getAttribute("data-product-id");
  const productName = btn.getAttribute("data-product-name") || "";
  if (!productId || !Number.isFinite(rowNumber)) return;

  const wrap = document.querySelector(`[data-product-picker="${rowNumber}"]`);
  const input = wrap?.querySelector("[data-product-search]");
  const hidden = wrap?.querySelector("[data-product-id]");
  const resultsEl = wrap?.querySelector("[data-product-results]");

  if (input instanceof HTMLInputElement) input.value = productName;
  if (hidden instanceof HTMLInputElement) hidden.value = productId;
  resultsEl?.classList.add("hidden");

  updateRowProductMapping(rowNumber, {
    productId,
    productVariantId: null,
    mappedProductLabel: productName,
    mappedVariantLabel: PLACEHOLDER_VARIANT,
    mappingSource: "manual",
  });

  void populateVariantSelect(rowNumber, productId);
  document.dispatchEvent(
    new CustomEvent("parcel-mapping-changed", { detail: { rowNumber } }),
  );
}

function onVariantChange(e) {
  const select = e.target;
  if (!(select instanceof HTMLSelectElement) || !select.matches("[data-variant-select]")) {
    return;
  }

  const rowNumber = Number(select.getAttribute("data-mapping-row"));
  if (!Number.isFinite(rowNumber)) return;

  const value = select.value;
  if (!value) {
    updateRowProductMapping(rowNumber, {
      productVariantId: null,
      mappedVariantLabel: PLACEHOLDER_VARIANT,
    });
  } else if (value === "__unknown__") {
    updateRowProductMapping(rowNumber, {
      productVariantId: null,
      mappedVariantLabel: "Unknown",
    });
  } else {
    const label = select.options[select.selectedIndex]?.textContent || PLACEHOLDER_VARIANT;
    updateRowProductMapping(rowNumber, {
      productVariantId: value,
      mappedVariantLabel: label,
    });
  }

  document.dispatchEvent(
    new CustomEvent("parcel-mapping-changed", { detail: { rowNumber } }),
  );
}

function onDocumentClick(e) {
  if (e.target.closest("[data-product-picker]")) return;
  document.querySelectorAll("[data-product-results]").forEach((el) => {
    el.classList.add("hidden");
  });
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
