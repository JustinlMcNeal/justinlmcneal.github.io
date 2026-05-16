/**
 * modalPreviews.js — Push and Edit modal profit preview + price reference refresh helpers.
 *
 * Pure DOM-reading helpers. No page state. All state is passed as parameters.
 *
 * Exports:
 *   refreshPushPreview(product)                               — re-render Push profit preview
 *   refreshEditPreview(product)                               — re-render Edit profit preview
 *   refreshPushRef(product, salesMetrics)                     — re-render Push price reference
 *   refreshEditRef(product, salesMetrics)                     — re-render Edit price reference
 *   loadAndRenderPriceRef(containerId, product, priceInputId,
 *                         onMetricsReady, isStillActive)      — async initial+full price ref load
 *
 * Does NOT own:
 *   openPush / openEdit — stay in index.js
 *   page-level state (currentProduct, editProduct, pushSalesMetrics, etc.) — passed as parameters
 *   create/edit/publish handlers — stay in index.js
 *   callEdge / API calls — not used here
 */

import { buildEstimate, renderPreview } from "./profitPreview.js";
import { buildPriceRef, renderPriceRef, fetchSalesMetrics } from "./priceReference.js";

// ── Push profit preview ───────────────────────────────────────

/**
 * Re-render the Push modal profit preview using current DOM input values.
 * @param {object} product — currentProduct (from index.js)
 */
export function refreshPushPreview(product) {
  if (!product) return;
  const priceVal  = parseFloat(document.getElementById("modalPrice")?.value);
  const ozVal     = parseFloat(document.getElementById("modalWeightOz")?.value);
  const pushAdRate = parseInt(document.getElementById("modalAdRate")?.value ?? "0", 10) || 0;
  renderPreview("modalProfitPreview", buildEstimate({
    priceCents:   isNaN(priceVal) ? null : Math.round(priceVal * 100),
    kkPriceCents: product.price      ? Math.round(Number(product.price) * 100) : null,
    unitCostUsd:  product.unit_cost != null ? Number(product.unit_cost) : null,
    weightG:      product.weight_g  ?? null,
    labelWeightG: isNaN(ozVal) ? null : Math.round(ozVal * 28.3495),
    adRatePct:    pushAdRate,
  }));
}

// ── Edit profit preview ───────────────────────────────────────

/**
 * Re-render the Edit modal profit preview using current DOM input values.
 * @param {object} product — editProduct (from index.js)
 */
export function refreshEditPreview(product) {
  if (!product) return;
  const priceVal   = parseFloat(document.getElementById("editPrice")?.value);
  const ozVal      = parseFloat(document.getElementById("editWeightOz")?.value);
  const editAdRate = parseInt(document.getElementById("editAdRate")?.value ?? "0", 10) || 0;
  renderPreview("editProfitPreview", buildEstimate({
    priceCents:   isNaN(priceVal) ? null : Math.round(priceVal * 100),
    kkPriceCents: product.price      ? Math.round(Number(product.price) * 100) : null,
    unitCostUsd:  product.unit_cost != null ? Number(product.unit_cost) : null,
    weightG:      product.weight_g  ?? null,
    labelWeightG: isNaN(ozVal) ? null : Math.round(ozVal * 28.3495),
    adRatePct:    editAdRate,
  }));
}

// ── Push price reference ──────────────────────────────────────

/**
 * Re-render the Push modal price reference using the current price input value.
 * loading=true only while metrics are still being fetched (salesMetrics===null).
 * @param {object} product      — currentProduct (from index.js)
 * @param {object|null} salesMetrics — pushSalesMetrics (from index.js)
 */
export function refreshPushRef(product, salesMetrics) {
  if (!product) return;
  const priceVal = parseFloat(document.getElementById("modalPrice")?.value);
  const ref = buildPriceRef(
    product,
    salesMetrics,
    isNaN(priceVal) ? null : Math.round(priceVal * 100),
  );
  renderPriceRef("modalPriceRef", ref, salesMetrics === null);
}

// ── Edit price reference ──────────────────────────────────────

/**
 * Re-render the Edit modal price reference using the current price input value.
 * @param {object} product      — editProduct (from index.js)
 * @param {object|null} salesMetrics — editSalesMetrics (from index.js)
 */
export function refreshEditRef(product, salesMetrics) {
  if (!product) return;
  const priceVal = parseFloat(document.getElementById("editPrice")?.value);
  const ref = buildPriceRef(
    product,
    salesMetrics,
    isNaN(priceVal) ? null : Math.round(priceVal * 100),
  );
  renderPriceRef("editPriceRef", ref, salesMetrics === null);
}

// ── Async load + render ───────────────────────────────────────

/**
 * Load sales metrics async, then re-render the price reference panel.
 * Renders immediately (loading=true), then again with full data once fetched.
 *
 * @param {string}   containerId      — 'modalPriceRef' or 'editPriceRef'
 * @param {object}   product          — the product being opened
 * @param {string}   priceInputId     — ID of the price <input> element (e.g. 'modalPrice')
 * @param {Function} onMetricsReady   — callback(metrics) — index.js assigns pushSalesMetrics or editSalesMetrics
 * @param {Function} isStillActive    — callback(product) → boolean — guard check for stale async
 */
export async function loadAndRenderPriceRef(containerId, product, priceInputId, onMetricsReady, isStillActive) {
  // Initial render — instant data only, loading=true for async range
  const priceInput = document.getElementById(priceInputId);
  const priceVal0  = parseFloat(priceInput?.value);
  const initRef    = buildPriceRef(
    product,
    null,
    isNaN(priceVal0) ? null : Math.round(priceVal0 * 100),
  );
  renderPriceRef(containerId, initRef, true);

  // Async fetch min/max from v_ebay_product_recent_sales
  const metrics = await fetchSalesMetrics(product.code);
  onMetricsReady(metrics);

  // Guard: only update if the same product is still open
  if (!isStillActive(product)) return;

  const priceVal = parseFloat(priceInput?.value);
  const fullRef  = buildPriceRef(
    product,
    metrics,
    isNaN(priceVal) ? null : Math.round(priceVal * 100),
  );
  renderPriceRef(containerId, fullRef, false);
}
