/** Products admin margin display using canonical landed CPI. */

import {
  calculateCustomerShipping,
  getSupplierShippingDetails,
} from "../pStorage/profitCalc.js";
import {
  calculateMarginFromCpi,
  countVariantCpiOverrides,
  formatMarginBadgeHtml,
  resolveProductsMarginCpiUsd,
} from "../../shared/landedCpi.js";

const BULK_QTY = 30;

function shippingContext(weightG) {
  const w = Number(weightG) || 0;
  const supplierShipPerUnitUsd =
    getSupplierShippingDetails(w, BULK_QTY).perUnitUSD || 0;
  const customerRaw = calculateCustomerShipping(w);
  const customerShipUsd =
    typeof customerRaw === "number" ? customerRaw : 0;
  return {
    supplierShipPerUnitUsd,
    customerShipUsd,
    tooHeavy: customerRaw === "Too Heavy",
  };
}

/**
 * @param {object} params
 * @param {number | null | undefined} params.price
 * @param {number | null | undefined} params.weightG
 * @param {number | null | undefined} params.unitCost
 * @param {number | null | undefined} params.unitCostOverrideCents
 */
export function computeVariantMargin({
  price,
  weightG,
  unitCost,
  unitCostOverrideCents,
}) {
  const priceN = Number(price);
  if (!priceN || priceN <= 0) return null;

  const { supplierShipPerUnitUsd, customerShipUsd } = shippingContext(weightG);
  const { cpiUsd, source } = resolveProductsMarginCpiUsd({
    unitCost,
    unitCostOverrideCents,
    supplierShipPerUnitUsd,
  });
  if (cpiUsd == null) return null;

  const margin = calculateMarginFromCpi({
    price: priceN,
    cpiUsd,
    outboundShippingUsd: customerShipUsd,
  });
  if (!margin) return null;

  return { ...margin, source };
}

/** @param {object} product */
export function computeProductMarginDisplay(product) {
  const price = Number(product.price);
  const weightG = Number(product.weight_g);
  const unitCost = product.unit_cost;
  const variants = (product.product_variants || []).filter(
    (v) => v.is_active !== false,
  );
  const overrideCount = countVariantCpiOverrides(variants);

  const productMargin = computeVariantMargin({
    price,
    weightG,
    unitCost,
    unitCostOverrideCents: null,
  });

  const overrideMargins = variants
    .filter((v) => v.unit_cost_override_cents != null)
    .map((v) =>
      computeVariantMargin({
        price,
        weightG,
        unitCost,
        unitCostOverrideCents: v.unit_cost_override_cents,
      }),
    )
    .filter(Boolean);

  const overridePercents = overrideMargins
    .map((m) => m.marginPercent)
    .filter((n) => Number.isFinite(n));

  const variantMin =
    overridePercents.length > 0 ? Math.min(...overridePercents) : null;
  const variantMax =
    overridePercents.length > 0 ? Math.max(...overridePercents) : null;

  return {
    productMargin,
    overrideCount,
    variantMin,
    variantMax,
    hasVariantOverrides: overrideCount > 0,
  };
}

/** Sort key: prefer variant max margin when overrides exist. */
export function productMarginSortValue(product) {
  const disp = computeProductMarginDisplay(product);
  if (disp.hasVariantOverrides && disp.variantMax != null) {
    return disp.variantMax;
  }
  return disp.productMargin?.marginPercent ?? -999;
}

/** @param {number | null} min @param {number | null} max */
export function formatVariantMarginRange(min, max) {
  if (min == null || max == null) return "";
  return Math.round(min) === Math.round(max)
    ? `${Math.round(min)}%`
    : `${Math.round(min)}–${Math.round(max)}%`;
}

/** Compact margin block for card/mobile views. */
export function formatCardMarginHtml(product) {
  const disp = computeProductMarginDisplay(product);
  let html = "";

  if (disp.productMargin) {
    const badge = formatMarginBadgeHtml(disp.productMargin.marginPercent);
    if (badge.hasData) {
      html += `<span title="Default product margin (free-shipping estimate)">${badge.html}</span>`;
      html += `<span class="text-[8px] font-bold uppercase tracking-wide text-gray-500 ml-1">default</span>`;
    }
  }

  if (
    disp.hasVariantOverrides &&
    disp.variantMin != null &&
    disp.variantMax != null
  ) {
    const range = formatVariantMarginRange(disp.variantMin, disp.variantMax);
    html += `<span class="text-[9px] font-bold text-amber-800 ml-1" title="Variant landed CPI margins">Var ${range}</span>`;
  }

  return html;
}

/** CPI override count hint for compact card rows. */
export function formatCardCpiHint(product) {
  const variants = (product.product_variants || []).filter(
    (v) => v.is_active !== false,
  );
  const overrideCount = countVariantCpiOverrides(variants);
  if (!overrideCount) return "";
  return `<span class="text-[9px] font-bold uppercase tracking-wide text-amber-800" title="Variant-level landed CPI overrides">${overrideCount} variant CPI</span>`;
}

/**
 * Modal product profit panel — default product estimate only.
 * @param {object} params
 * @param {number | null | undefined} params.price
 * @param {number | null | undefined} params.weightG
 * @param {number | null | undefined} params.unitCost
 * @param {Array<{ unit_cost_override_cents?: number | null, is_active?: boolean }>} [params.variants]
 */
export function renderModalProductProfitPanel({
  price,
  weightG,
  unitCost,
  variants = [],
}) {
  const priceN = Number(price) || 0;
  const weightN = Number(weightG) || 0;
  const unitCostN = Number(unitCost) || 0;
  const activeVariants = variants.filter((v) => v.is_active !== false);

  if (!unitCostN && !weightN && !priceN) return null;

  const productLike = {
    price: priceN,
    weight_g: weightN,
    unit_cost: unitCostN || null,
    product_variants: activeVariants,
  };
  const disp = computeProductMarginDisplay(productLike);
  const margin = disp.productMargin;

  const { supplierShipPerUnitUsd, customerShipUsd, tooHeavy } =
    shippingContext(weightN);
  const inboundCpi = margin?.inboundCpiUsd ?? null;
  const outbound = customerShipUsd;
  const totalCpi = margin?.totalCpiUsd ?? null;

  const fmt = (n) =>
    n == null || !Number.isFinite(n) ? "—" : `$${Number(n).toFixed(2)}`;
  const marginBadge = margin
    ? formatMarginBadgeHtml(margin.marginPercent)
    : null;

  let variantNote = "";
  if (disp.hasVariantOverrides) {
    const range = formatVariantMarginRange(disp.variantMin, disp.variantMax);
    variantNote = `
      <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-variant-override-note>
        <div class="font-bold">Variant CPI overrides exist — see variant rows for variant-specific margins.</div>
        ${
          range
            ? `<div class="mt-1 font-semibold">Variant margins (est.): ${range}</div>`
            : ""
        }
        <div class="mt-0.5 text-[10px] text-amber-700">${disp.overrideCount} variant CPI override${disp.overrideCount === 1 ? "" : "s"}</div>
      </div>`;
  }

  return `
    <div data-product-profit-panel="default-estimate" class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs font-black uppercase tracking-wider text-gray-700">Default product estimate</div>
        ${marginBadge?.hasData ? marginBadge.html : ""}
      </div>
      <div class="text-[10px] text-gray-500">Free-shipping margin using product CPI + estimated inbound/outbound ship. Does not apply when variant landed CPI overrides exist.</div>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="rounded-lg bg-gray-50 px-3 py-2">
          <div class="text-[10px] font-bold uppercase text-gray-500">Product CPI</div>
          <div class="font-mono font-bold">${fmt(unitCostN || null)}</div>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2">
          <div class="text-[10px] font-bold uppercase text-gray-500">Est. inbound ship</div>
          <div class="font-mono font-bold">${fmt(supplierShipPerUnitUsd)}</div>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2">
          <div class="text-[10px] font-bold uppercase text-gray-500">Est. outbound ship</div>
          <div class="font-mono font-bold">${tooHeavy ? "Too heavy" : fmt(outbound)}</div>
        </div>
        <div class="rounded-lg bg-gray-50 px-3 py-2">
          <div class="text-[10px] font-bold uppercase text-gray-500">Total CPI (est.)</div>
          <div class="font-mono font-bold">${fmt(totalCpi)}</div>
        </div>
      </div>
      ${
        margin
          ? `<div class="flex items-center justify-between text-sm">
              <span class="text-gray-600">Profit @ ${fmt(priceN)}</span>
              <span class="font-bold ${margin.profitUsd >= 0 ? "text-green-700" : "text-red-700"}">${fmt(margin.profitUsd)}</span>
            </div>`
          : `<div class="text-xs text-gray-500">Add price and CPI/weight for margin estimate.</div>`
      }
      ${variantNote}
    </div>`;
}

/** @param {object} product */
export function renderProductMarginCell(product) {
  const disp = computeProductMarginDisplay(product);
  if (!disp.productMargin && !disp.hasVariantOverrides) {
    return '<span class="text-gray-400">—</span>';
  }

  let html = '<div class="flex flex-col items-center gap-0.5">';

  if (disp.productMargin) {
    const badge = formatMarginBadgeHtml(disp.productMargin.marginPercent);
    if (badge.hasData) {
      html += `<div title="Product default margin (free-shipping estimate using product CPI + est. inbound ship)">${badge.html}</div>`;
      html += `<div class="text-[8px] font-bold uppercase tracking-wide text-gray-500">default</div>`;
    }
  }

  if (
    disp.hasVariantOverrides &&
    disp.variantMin != null &&
    disp.variantMax != null
  ) {
    const range = formatVariantMarginRange(disp.variantMin, disp.variantMax);
    html += `<div class="text-[9px] font-bold text-amber-800" title="Variant landed CPI margins (free-shipping estimate)">Var ${range}</div>`;
  }

  html += "</div>";
  return html;
}
