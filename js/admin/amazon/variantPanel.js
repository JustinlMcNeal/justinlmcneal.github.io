// Amazon push modal — single-variant selector (Phase 7A standalone child SKUs).

import { escapeHtml } from "./renderListings.js";

/** @type {Array<Record<string, unknown>>} */
let pushVariants = [];

/** @type {string | null} */
let selectedVariantId = null;

/**
 * @param {string} productCode
 * @param {string} optionValue
 */
export function variantSkuFromOption(productCode, optionValue) {
  const suffix = String(optionValue || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .substring(0, 6);
  return suffix ? `${productCode}-${suffix}` : productCode;
}

/**
 * @param {Record<string, unknown>} variant
 * @param {string} productCode
 */
export function resolveVariantSellerSku(variant, productCode) {
  const explicit = String(variant?.sku || "").trim();
  if (explicit) return explicit;
  return variantSkuFromOption(productCode, String(variant?.option_value || ""));
}

/**
 * @param {Array<Record<string, unknown>>} variants
 * @param {string} productCode
 * @param {string | null} [preferredVariantId]
 */
export function initAmazonVariantPanel(variants, productCode, preferredVariantId = null) {
  pushVariants = (variants || []).filter((v) => v?.is_active !== false);
  selectedVariantId = null;

  const section = document.getElementById("amazonPushVariantSection");
  const list = document.getElementById("amazonPushVariantList");
  const countEl = document.getElementById("amazonPushVariantCount");
  if (!section || !list) return null;

  if (pushVariants.length <= 1) {
    section.classList.add("hidden");
    list.innerHTML = "";
    if (countEl) countEl.textContent = "";
    selectedVariantId = pushVariants[0]?.id ? String(pushVariants[0].id) : null;
    return pushVariants[0] || null;
  }

  section.classList.remove("hidden");
  const preferred = preferredVariantId && pushVariants.some((v) => String(v.id) === preferredVariantId)
    ? preferredVariantId
    : String(pushVariants[0]?.id || "");

  list.innerHTML = pushVariants.map((v, i) => {
    const id = String(v.id || "");
    const label = String(v.option_value || v.title || `Variant ${i + 1}`);
    const sku = resolveVariantSellerSku(v, productCode);
    const qty = Number(v.stock ?? 0);
    const checked = id === preferred ? "checked" : "";
    const oos = qty <= 0 ? '<span class="text-[9px] text-orange-600 font-bold ml-1">OOS</span>' : "";
    return `
      <label class="flex items-start gap-2 p-2 rounded-lg border border-gray-200 bg-gray-50 cursor-pointer hover:border-black">
        <input type="radio" name="amazonPushVariant" class="mt-1 accent-pink-500" value="${escapeHtml(id)}" ${checked} data-action="amazon-select-variant" />
        <span class="min-w-0 flex-1">
          <span class="block text-xs font-bold">${escapeHtml(label)}${oos}</span>
          <span class="block text-[10px] font-mono text-gray-500">${escapeHtml(sku)} · ${qty} in stock</span>
        </span>
      </label>`;
  }).join("");

  if (countEl) {
    countEl.textContent = `${pushVariants.length} active variants · pick one per Amazon listing`;
  }

  selectedVariantId = preferred || null;
  return getSelectedAmazonVariant(productCode);
}

/**
 * @param {string} [productCode]
 */
export function getSelectedAmazonVariant(productCode = "") {
  if (!pushVariants.length) return null;
  if (pushVariants.length === 1) return { ...pushVariants[0], sellerSku: resolveVariantSellerSku(pushVariants[0], productCode) };

  const picked = pushVariants.find((v) => String(v.id) === String(selectedVariantId || ""));
  const variant = picked || pushVariants[0];
  return {
    ...variant,
    sellerSku: resolveVariantSellerSku(variant, productCode),
    quantity: Number(variant.stock ?? 0),
  };
}

/** @param {string} variantId */
export function setSelectedAmazonVariantId(variantId) {
  selectedVariantId = variantId || null;
}

export function wireAmazonVariantPanel(onChange) {
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.name !== "amazonPushVariant") return;
    selectedVariantId = target.value || null;
    onChange?.(selectedVariantId);
  });
}

export function resetAmazonVariantPanel() {
  pushVariants = [];
  selectedVariantId = null;
  const section = document.getElementById("amazonPushVariantSection");
  const list = document.getElementById("amazonPushVariantList");
  if (section) section.classList.add("hidden");
  if (list) list.innerHTML = "";
}
