/**
 * variantPanel.js — Push-modal variant panel rendering and image assignment helpers.
 *
 * Exports:
 *   renderVariantAssignedImages    — renders assigned image thumbnails inside a variant row
 *   getAssignedVariantImages       — reads [data-assigned-url] elements from a row DOM node
 *   setAssignedVariantImages       — writes a new image URL array back to a row's assigned-images container
 *   renderVariantCandidatePicker   — builds the candidate image picker HTML string
 *   refreshVariantCandidateButtons — hides already-assigned candidates in the picker
 *   wireVariantImageSetControls    — wires add/remove/set-main click handlers on a variant row
 *   renderVariantPanel             — renders the full variant list into #variantList
 *   getCheckedVariants             — reads checked variant checkboxes + qtys + assigned images from DOM
 *   renderEditVariantImageControls  — renders per-variant image+qty controls in the Edit modal
 *
 * Does NOT own:
 *   openPush / openEdit — stay in index.js
 *   create item/offer/publish handlers — stay in index.js
 *   page-level state (pushVariants, currentProduct, etc.) — passed as parameters
 *   edit save handler — stays in index.js
 */

import { esc, imageOptionLabel, buildImageUrls, variantSkuFromOption } from "./utils.js";
import { getItemForEdit } from "./editFetch.js";

// ── Assigned image strip ──────────────────────────────────────

export function renderVariantAssignedImages(container, urls) {
  container.innerHTML = urls.length
    ? urls.map((url, i) => `
      <div class="relative w-14 h-14 rounded border-2 ${i === 0 ? "border-kkpink" : "border-gray-200"} overflow-hidden flex-shrink-0" data-assigned-url="${esc(url)}">
        <img src="${esc(url)}" alt="" class="w-full h-full object-cover" />
        ${i === 0 ? `<span class="absolute left-0 bottom-0 bg-kkpink text-black text-[8px] font-black px-1">Main</span>` : `<button type="button" class="absolute left-0 bottom-0 bg-white/90 text-[8px] font-bold px-1" data-set-main-url="${esc(url)}">Main</button>`}
        <button type="button" class="absolute -top-1 -right-1 bg-black text-white rounded-full w-4 h-4 text-[10px] leading-4" data-remove-assigned-url="${esc(url)}">×</button>
      </div>`).join("")
    : `<div class="text-[10px] text-gray-400 border border-dashed border-gray-300 rounded px-2 py-3">No variant images assigned</div>`;
}

export function getAssignedVariantImages(row) {
  if (!row) return [];
  return [...row.querySelectorAll("[data-assigned-url]")].map(el => el.dataset.assignedUrl).filter(Boolean);
}

export function setAssignedVariantImages(row, urls) {
  const container = row.querySelector("[data-variant-assigned-images]");
  if (container) renderVariantAssignedImages(container, [...new Set(urls.filter(Boolean))].slice(0, 24));
}

// ── Candidate image picker ────────────────────────────────────

export function renderVariantCandidatePicker(urls) {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) return `<div class="text-[10px] text-gray-400 border border-dashed border-gray-200 rounded px-2 py-3">No candidate images available</div>`;
  return `
    <div class="grid grid-cols-2 gap-1" data-variant-candidate-list>
      ${unique.map((url, i) => `
        <button type="button" data-add-candidate-url="${esc(url)}" class="variant-candidate flex items-center gap-2 text-left border border-gray-200 rounded p-1 bg-white hover:border-kkpink hover:bg-pink-50 transition-colors">
          <img src="${esc(url)}" alt="" loading="lazy" class="w-9 h-9 rounded object-cover border border-gray-100 flex-shrink-0" />
          <span class="text-[9px] leading-tight text-gray-600 truncate">${esc(imageOptionLabel(url, i))}</span>
        </button>`).join("")}
    </div>
    <div data-no-variant-candidates class="hidden text-[10px] text-gray-400 border border-dashed border-gray-200 rounded px-2 py-3">All candidate images are already assigned.</div>`;
}

export function refreshVariantCandidateButtons(row) {
  const assigned = new Set(getAssignedVariantImages(row));
  const buttons = [...row.querySelectorAll("[data-add-candidate-url]")];
  let visible = 0;
  buttons.forEach(btn => {
    const isAssigned = assigned.has(btn.dataset.addCandidateUrl);
    btn.classList.toggle("hidden", isAssigned);
    if (!isAssigned) visible++;
  });
  row.querySelector("[data-no-variant-candidates]")?.classList.toggle("hidden", visible !== 0);
}

// ── Event wiring ──────────────────────────────────────────────

export function wireVariantImageSetControls(row, onChange) {
  row.addEventListener("click", (e) => {
    const toggle = e.target?.closest?.("[data-toggle-variant-picker]");
    if (toggle) {
      row.querySelector("[data-variant-picker]")?.classList.toggle("hidden");
      return;
    }
    const candidate = e.target?.closest?.("[data-add-candidate-url]");
    if (candidate) {
      setAssignedVariantImages(row, [...getAssignedVariantImages(row), candidate.dataset.addCandidateUrl]);
      row.querySelector("[data-variant-picker]")?.classList.add("hidden");
      refreshVariantCandidateButtons(row);
      onChange?.(getAssignedVariantImages(row));
      return;
    }
    const removeUrl = e.target?.dataset?.removeAssignedUrl;
    const mainUrl = e.target?.dataset?.setMainUrl;
    if (!removeUrl && !mainUrl) return;
    const urls = getAssignedVariantImages(row);
    if (removeUrl) setAssignedVariantImages(row, urls.filter(u => u !== removeUrl));
    if (mainUrl) setAssignedVariantImages(row, [mainUrl, ...urls.filter(u => u !== mainUrl)]);
    refreshVariantCandidateButtons(row);
    onChange?.(getAssignedVariantImages(row));
  });
  refreshVariantCandidateButtons(row);
}

// ── Variant panel render ──────────────────────────────────────

/**
 * Renders the full variant list into #variantList.
 * @param {Array}  variants  Active product variants
 * @param {string} baseCode  Product base code (e.g. "KK-0001")
 * @param {Object} product   Full product record (used to build available candidate images)
 */
export function renderVariantPanel(variants, baseCode, product) {
  const list = document.getElementById("variantList");
  const availableImages = buildImageUrls(product);
  list.innerHTML = variants.map((v, i) => {
    const suffix  = v.option_value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
    const sku     = `${baseCode}-${suffix}`;
    const qty     = v.stock ?? 0;
    const oosNote = qty === 0 ? `<span class="text-[9px] text-orange-500 font-semibold ml-1">OOS</span>` : "";
    const assignedImages = v.preview_image_url ? [v.preview_image_url] : [];
    const candidatePicker = renderVariantCandidatePicker([...availableImages, ...assignedImages]);
    return `<div class="p-2 rounded-lg border border-gray-200 bg-gray-50">
      <div class="flex items-center gap-2">
        <input type="checkbox" class="variant-check accent-pink-500" data-idx="${i}" checked />
      <div class="flex-1 min-w-0">
        <div class="text-xs font-bold truncate">${esc(v.option_value)}${oosNote}</div>
        <div class="text-[10px] text-gray-400 font-mono">${esc(sku)}</div>
      </div>
      <input type="number" class="variant-qty w-14 border border-gray-300 rounded px-1 py-0.5 text-xs text-center" value="${qty}" min="0" data-idx="${i}" />
      <span class="text-[10px] text-gray-400">qty</span>
      </div>
      <div class="mt-2">
        <div class="text-[9px] text-gray-500 uppercase font-bold mb-1">Images assigned to ${esc(v.option_value)}</div>
        <div class="flex flex-wrap gap-1 mb-2" data-variant-assigned-images data-idx="${i}"></div>
        <button type="button" class="text-[10px] font-bold text-blue-600 hover:text-kkpink" data-toggle-variant-picker>+ Add image</button>
        <div class="hidden mt-2 rounded border border-gray-200 bg-white p-2" data-variant-picker>${candidatePicker}</div>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-variant-assigned-images]").forEach(container => {
    const variant = variants[Number(container.dataset.idx)];
    renderVariantAssignedImages(container, variant?.preview_image_url ? [variant.preview_image_url] : []);
  });
  [...list.children].forEach(row => {
    wireVariantImageSetControls(row);
  });

  document.getElementById("variantCount").textContent      = variants.length;
  document.getElementById("variantSkuPattern").textContent = `${baseCode}-{COLOR}`;
}

// ── Edit modal variant image/qty controls ────────────────────

/**
 * Renders per-variant image and quantity controls in the Edit modal.
 * Fetches each variant's current eBay item data, populates overrides maps,
 * and builds interactive image-assignment rows.
 *
 * @param {object} product                   Full product record (with product_variants)
 * @param {object} group                     eBay inventory item group data (with variantSKUs)
 * @param {object} deps
 * @param {string[]} deps.editImageUrls      Current edit-modal candidate images (read-only)
 * @param {object}  deps.editVariantImageOverrides  Map of sku → image URL array (mutated in place)
 * @param {object}  deps.editVariantQtyOverrides    Map of sku → qty (mutated in place)
 * @returns {Promise<{rows, failures}|undefined>}
 */
export async function renderEditVariantImageControls(product, group, {
  editImageUrls,
  editVariantImageOverrides,
  editVariantQtyOverrides,
}) {
  const section   = document.getElementById("editVariantImagesSection");
  const list      = document.getElementById("editVariantImagesList");
  list.innerHTML  = "";

  const variantSKUs = group?.variantSKUs || [];
  if (!variantSKUs.length) { section.classList.add("hidden"); return; }

  const variants = (product.product_variants || []).filter(v => v.is_active);
  const bySku    = new Map();
  variants.forEach(v => {
    const sku = variantSkuFromOption(product.code, v.option_value);
    bySku.set(sku, v);
  });

  const rows = await Promise.all(variantSKUs.map(async (sku) => {
    const local       = bySku.get(sku);
    let currentImages = local?.preview_image_url ? [local.preview_image_url] : [];
    let currentQty = 0;
    const r = await getItemForEdit(sku);
    if (r.success) {
      currentImages = r.item?.product?.imageUrls?.length ? [...r.item.product.imageUrls] : currentImages;
      currentQty  = r.item?.availability?.shipToLocationAvailability?.quantity ?? 0;
    }
    editVariantImageOverrides[sku] = currentImages;
    editVariantQtyOverrides[sku]   = currentQty;
    return { sku, label: local?.option_value || sku, images: currentImages, qty: currentQty, failed: !r.success, retried: !!r.retried, error: r.error || "eBay item lookup failed" };
  }));

  const failures = rows.filter(r => r.failed);
  if (failures.length) {
    const warning = document.createElement("div");
    warning.className = "text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2";
    warning.textContent = `${failures.length} variant detail lookup(s) failed; fallback controls are shown for: ${failures.map(f => f.sku).join(", ")}`;
    list.appendChild(warning);
  }

  rows.forEach(r => {
    const row = document.createElement("div");
    row.className   = "mb-3";
    const assignedImages = [...new Set((r.images || []).filter(Boolean))];
    const candidateImages = [...new Set([...editImageUrls, ...assignedImages].filter(Boolean))];
    const candidatePicker = renderVariantCandidatePicker(candidateImages);

    row.innerHTML = `
      <div class="flex items-center gap-3 mb-1">
        <span class="text-[10px] font-bold text-gray-700">${esc(r.label)}</span>
        ${assignedImages.length ? `<span class="text-[9px] text-green-700 bg-green-50 border border-green-200 rounded px-1">${assignedImages.length} variant image${assignedImages.length === 1 ? "" : "s"}</span>` : `<span class="text-[9px] text-gray-500 bg-gray-100 border border-gray-200 rounded px-1">no variant images assigned</span>`}
        ${r.failed ? `<span class="text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1" title="${esc(r.error)}">fallback${r.retried ? " after retry" : ""}</span>` : ""}
        <label class="flex items-center gap-1 ml-auto">
          <span class="text-[9px] text-gray-500 uppercase font-bold">Qty</span>
          <input type="number" min="0" value="${r.qty}"
            data-var-qty-sku="${esc(r.sku)}"
            class="w-14 border-2 border-gray-300 rounded px-1 py-0.5 text-xs text-center focus:border-kkpink outline-none" />
        </label>
      </div>
      <div class="text-[9px] text-gray-500 mb-1">Images assigned to this variant. First image is the eBay main image for this variant.</div>
      <div class="flex flex-wrap gap-1 mb-2" data-variant-assigned-images></div>
      <button type="button" class="text-[10px] font-bold text-blue-600 hover:text-kkpink" data-toggle-variant-picker>+ Add image</button>
      <div class="hidden mt-2 rounded border border-gray-200 bg-white p-2" data-variant-picker>${candidatePicker}</div>`;

    setAssignedVariantImages(row, assignedImages);
    wireVariantImageSetControls(row, (urls) => { editVariantImageOverrides[r.sku] = urls; });
    row.querySelectorAll("[data-var-qty-sku]").forEach(input => {
      input.addEventListener("change", () => {
        editVariantQtyOverrides[input.dataset.varQtySku] = parseInt(input.value) || 0;
      });
    });
    list.appendChild(row);
  });

  section.classList.remove("hidden");
  return { rows, failures };
}

// ── Checked variants reader ───────────────────────────────────

/**
 * Reads checked variant checkboxes, quantities, and assigned images from the DOM.
 * @param {Array}  variants     The pushVariants array (active variants for this product)
 * @param {string} productCode  The product's base code (e.g. "KK-0001")
 * @returns {Array} Array of variant objects with sku, quantity, variant_image_urls added
 */
export function getCheckedVariants(variants, productCode) {
  const checks = document.querySelectorAll(".variant-check");
  const qtys   = document.querySelectorAll(".variant-qty");
  const rows   = document.querySelectorAll("#variantList > div");
  const result = [];
  checks.forEach((cb, i) => {
    if (cb.checked && variants[i]) {
      const v      = variants[i];
      const suffix = v.option_value.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
      const rawQty = parseInt(qtys[i]?.value, 10);
      const qty    = Number.isFinite(rawQty) && rawQty >= 0 ? rawQty : 0;
      result.push({ ...v, sku: `${productCode}-${suffix}`, quantity: qty, variant_image_urls: getAssignedVariantImages(rows[i]) });
    }
  });
  return result;
}
