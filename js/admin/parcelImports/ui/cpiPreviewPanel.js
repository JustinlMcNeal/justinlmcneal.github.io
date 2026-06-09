/** CPI preview panel — local landed cost render (Phase 4). */

import { buildCpiPreview, OUTBOUND_SHIPPING_PLACEHOLDER_USD } from "../cpi/cpiPreview.js";
import { getDom } from "../dom.js";
import { formatCny } from "../parser/normalizers.js";
import { getState } from "../state.js";

const DASH = "—";

/**
 * Rebuild and render CPI preview from current in-memory state.
 */
export function renderCpiPreviewFromState() {
  const state = getState();
  if (!state.items?.length) {
    clearCpiPanel();
    return;
  }
  const preview = buildCpiPreview({
    parcel: state.parcel,
    items: state.items,
    overrides: state.overrides,
    rowMappings: state.rowMappings,
  });

  renderCpiPanel(preview);
}

function clearCpiPanel() {
  const { cpiFields, cpiWarningsEl, cpiBadgeEl } = getDom();
  if (!cpiFields) return;

  const textKeys = [
    "cpiLandedPreview",
    "cpiLatest",
    "cpiWeightedAvg",
    "cpiFulfilledPreview",
    "cpiProductsAffected",
    "cpiRowsExcluded",
    "cpiRowsNeedingMapping",
    "cpiReadyToUpdate",
  ];
  textKeys.forEach((key) => setText(cpiFields, key, DASH));

  const breakdownPrefixes = [
    "cpiCostProduct",
    "cpiCostSellerFreight",
    "cpiCostParcelShipping",
    "cpiCostInsuranceService",
    "cpiCostFx",
    "cpiCostTotal",
  ];
  breakdownPrefixes.forEach((key) => {
    setBreakdownRow(cpiFields, key, null, null, null);
  });

  setHint(cpiFields, "cpiLatestHint", "");
  setHint(cpiFields, "cpiWeightedAvgHint", "");
  setHint(cpiFields, "cpiFulfilledHint", "");

  if (cpiBadgeEl) {
    cpiBadgeEl.textContent = "";
    cpiBadgeEl.classList.add("hidden");
  }
  renderWarnings(cpiWarningsEl, []);
}

/**
 * @param {{ rows: object[], summary: object, warnings: string[] }} preview
 */
function renderCpiPanel(preview) {
  const { cpiFields, cpiWarningsEl, cpiBadgeEl } = getDom();
  if (!cpiFields) return;

  const { summary, warnings } = preview;
  const fx = summary.effectiveFxRate;

  setText(cpiFields, "cpiLandedPreview", formatLandedMetric(summary));
  setText(cpiFields, "cpiLatest", DASH);
  setHint(cpiFields, "cpiLatestHint", "No database — last approved import unavailable");
  setText(
    cpiFields,
    "cpiWeightedAvg",
    formatUsdOnly(summary.weightedAverageLandedCpiUsd),
  );
  setHint(cpiFields, "cpiWeightedAvgHint", "Local preview");
  setText(
    cpiFields,
    "cpiFulfilledPreview",
    summary.fulfilledCpiPreviewUsd != null
      ? `$${summary.fulfilledCpiPreviewUsd.toFixed(2)}`
      : DASH,
  );
  setHint(
    cpiFields,
    "cpiFulfilledHint",
    summary.fulfilledCpiPreviewUsd != null
      ? `Includes $${OUTBOUND_SHIPPING_PLACEHOLDER_USD.toFixed(2)} placeholder outbound avg`
      : "USD preview unavailable",
  );

  setBreakdownRow(cpiFields, "cpiCostProduct", summary.breakdownProductCny, summary.breakdownProductUsd, fx);
  setBreakdownRow(cpiFields, "cpiCostSellerFreight", summary.breakdownSellerFreightCny, summary.breakdownSellerFreightUsd, fx);
  setBreakdownRow(cpiFields, "cpiCostParcelShipping", summary.breakdownParcelShippingCny, summary.breakdownParcelShippingUsd, fx);
  setBreakdownRow(cpiFields, "cpiCostInsuranceService", summary.breakdownInsuranceServiceCny, summary.breakdownInsuranceServiceUsd, fx);
  setBreakdownRow(cpiFields, "cpiCostFx", summary.breakdownFxCny, summary.breakdownFxUsd, fx);
  setBreakdownRow(cpiFields, "cpiCostTotal", summary.breakdownTotalCny ?? summary.weightedAverageLandedCpiCny, summary.breakdownTotalUsd ?? summary.weightedAverageLandedCpiUsd, fx, true);

  setText(cpiFields, "cpiProductsAffected", String(summary.productsAffected));
  setText(cpiFields, "cpiRowsExcluded", String(summary.rowsExcluded));
  setText(cpiFields, "cpiRowsNeedingMapping", String(summary.needsMappingRows));
  setText(
    cpiFields,
    "cpiReadyToUpdate",
    summary.readyToUpdate ? "Yes — matched business rows ready" : "No — mapping issues remain",
  );
  setClass(
    cpiFields,
    "cpiReadyToUpdate",
    summary.readyToUpdate ? "text-green-800" : "text-amber-800",
  );

  if (cpiBadgeEl) {
    cpiBadgeEl.classList.remove("hidden");
    cpiBadgeEl.textContent = preview.rows.length ? "Local preview" : "Static estimate";
    cpiBadgeEl.classList.toggle("text-blue-800", preview.rows.length > 0);
    cpiBadgeEl.classList.toggle("bg-blue-50", preview.rows.length > 0);
    cpiBadgeEl.classList.toggle("text-gray-600", preview.rows.length === 0);
    cpiBadgeEl.classList.toggle("bg-gray-100", preview.rows.length === 0);
  }

  renderWarnings(cpiWarningsEl, warnings);
}

/**
 * @param {object} summary
 */
function formatLandedMetric(summary) {
  const cny = summary.weightedAverageLandedCpiCny;
  if (cny == null) return DASH;
  const cnyPart = formatCny(cny);
  const usdPart =
    summary.weightedAverageLandedCpiUsd != null
      ? ` / $${summary.weightedAverageLandedCpiUsd.toFixed(2)}`
      : ` / ${DASH}`;
  return `${cnyPart}${usdPart}`;
}

function formatUsdOnly(usd) {
  return usd != null ? `$${usd.toFixed(2)}` : DASH;
}

/**
 * @param {Record<string, HTMLElement>} fields
 * @param {string} key
 * @param {number | null} cny
 * @param {number | null} usd
 * @param {number | null} fx
 * @param {boolean} [bold]
 */
function setBreakdownRow(fields, key, cny, usd, fx, bold = false) {
  const cnyEl = fields[`${key}Cny`];
  const usdEl = fields[`${key}Usd`];
  if (cnyEl) {
    cnyEl.textContent = cny != null ? formatCny(cny) : DASH;
    if (bold) cnyEl.classList.add("font-black");
  }
  if (usdEl) {
    usdEl.textContent = usd != null ? `$${usd.toFixed(2)}` : DASH;
    if (bold) usdEl.classList.add("font-black");
  }
}

/**
 * @param {Record<string, HTMLElement>} fields
 * @param {string} key
 * @param {string} text
 */
function setText(fields, key, text) {
  const el = fields[key];
  if (el) el.textContent = text;
}

/**
 * @param {Record<string, HTMLElement>} fields
 * @param {string} key
 * @param {string} hintKey
 */
function setHint(fields, hintKey, text) {
  const el = fields[hintKey];
  if (el) el.textContent = text;
}

/**
 * @param {Record<string, HTMLElement>} fields
 * @param {string} key
 * @param {string} className
 */
function setClass(fields, key, className) {
  const el = fields[key];
  if (!el) return;
  el.classList.remove("text-green-800", "text-amber-800");
  el.classList.add(className);
}

/**
 * @param {HTMLElement | null | undefined} el
 * @param {string[]} warnings
 */
function renderWarnings(el, warnings) {
  if (!el) return;
  if (!warnings.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = warnings
    .map((w) => `<p class="text-[11px] text-amber-900">• ${escapeHtml(w)}</p>`)
    .join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
