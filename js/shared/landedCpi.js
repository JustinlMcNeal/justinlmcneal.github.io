/**
 * Canonical admin landed CPI resolution (Parcel Imports mirror).
 * Read-only — never writes product/variant cost fields.
 */

export const CPI_SOURCE = {
  VARIANT: "variant",
  PRODUCT: "product",
  MISSING: "missing",
};

/**
 * @param {{ unitCost?: number | null, unitCostOverrideCents?: number | null }} params
 * @returns {{ landedCpiUsd: number | null, source: string }}
 */
export function resolveLandedCpiUsd({ unitCost, unitCostOverrideCents }) {
  const override = toNumber(unitCostOverrideCents);
  if (override != null) {
    return { landedCpiUsd: override / 100, source: CPI_SOURCE.VARIANT };
  }

  const productCost = toNumber(unitCost);
  if (productCost != null && productCost > 0) {
    return { landedCpiUsd: productCost, source: CPI_SOURCE.PRODUCT };
  }

  return { landedCpiUsd: null, source: CPI_SOURCE.MISSING };
}

/**
 * Order-line CPI: variant landed CPI is all-in; product fallback keeps estimated supplier ship.
 * @param {object} params
 * @param {number | null | undefined} params.productUnitCost
 * @param {number | null | undefined} params.variantOverrideCents
 * @param {number | null | undefined} params.supplierShipPerUnitUsd
 * @param {number | null | undefined} params.quantity
 */
export function resolveOrderLineItemCost({
  productUnitCost,
  variantOverrideCents,
  supplierShipPerUnitUsd = 0,
  quantity = 1,
}) {
  const { landedCpiUsd, source } = resolveLandedCpiUsd({
    unitCost: productUnitCost,
    unitCostOverrideCents: variantOverrideCents,
  });

  let cpiDollars = 0;
  let includesEstimatedSupplierShip = false;

  if (source === CPI_SOURCE.VARIANT && landedCpiUsd != null) {
    cpiDollars = landedCpiUsd;
  } else if (source === CPI_SOURCE.PRODUCT && landedCpiUsd != null) {
    const ship = toNumber(supplierShipPerUnitUsd) ?? 0;
    cpiDollars = landedCpiUsd + ship;
    includesEstimatedSupplierShip = ship > 0;
  }

  const qty = Math.max(1, Number(quantity) || 1);
  const cpiCents = Math.round(cpiDollars * 100);

  return {
    landedCpiUsd,
    cpiDollars,
    cpiCents,
    lineCostCents: cpiCents * qty,
    costSource: source,
    includesEstimatedSupplierShip,
    supplierShipCents:
      source === CPI_SOURCE.PRODUCT
        ? Math.round((toNumber(supplierShipPerUnitUsd) ?? 0) * 100)
        : 0,
    unitCostCents:
      landedCpiUsd != null ? Math.round(landedCpiUsd * 100) : 0,
  };
}

/** @param {string} source */
export function cpiSourceLabel(source) {
  if (source === CPI_SOURCE.VARIANT) return "Variant CPI";
  if (source === CPI_SOURCE.PRODUCT) return "Product CPI";
  return "Missing CPI";
}

/** @param {number | null | undefined} usd */
export function formatLandedCpiUsd(usd) {
  if (usd == null || !Number.isFinite(usd)) return "—";
  return `$${usd.toFixed(2)}`;
}

/**
 * @param {Array<{ unit_cost_override_cents?: number | null }>} variants
 * @returns {number}
 */
export function countVariantCpiOverrides(variants = []) {
  return variants.filter(
    (v) => v?.unit_cost_override_cents != null && Number.isFinite(Number(v.unit_cost_override_cents)),
  ).length;
}

/** @param {string | null | undefined} value */
export function normalizeVariantKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Products admin margin CPI (inbound only).
 * Variant override = landed CPI; product fallback adds estimated supplier ship.
 * @param {object} params
 * @param {number | null | undefined} params.unitCost
 * @param {number | null | undefined} params.unitCostOverrideCents
 * @param {number | null | undefined} [params.supplierShipPerUnitUsd]
 */
export function resolveProductsMarginCpiUsd({
  unitCost,
  unitCostOverrideCents,
  supplierShipPerUnitUsd = 0,
}) {
  const { landedCpiUsd, source } = resolveLandedCpiUsd({
    unitCost,
    unitCostOverrideCents,
  });
  if (source === CPI_SOURCE.VARIANT && landedCpiUsd != null) {
    return { cpiUsd: landedCpiUsd, source };
  }
  if (source === CPI_SOURCE.PRODUCT && landedCpiUsd != null) {
    const ship = toNumber(supplierShipPerUnitUsd) ?? 0;
    return { cpiUsd: landedCpiUsd + ship, source };
  }
  return { cpiUsd: null, source: CPI_SOURCE.MISSING };
}

/**
 * Margin from landed inbound CPI + optional outbound shipping (free-shipping est.).
 * @param {object} params
 * @param {number | null | undefined} params.price
 * @param {number | null | undefined} params.cpiUsd — inbound CPI from resolveProductsMarginCpiUsd
 * @param {number | null | undefined} [params.outboundShippingUsd]
 */
export function calculateMarginFromCpi({ price, cpiUsd, outboundShippingUsd = 0 }) {
  const p = toNumber(price);
  const c = toNumber(cpiUsd);
  if (p == null || p <= 0 || c == null) return null;
  const outbound = toNumber(outboundShippingUsd) ?? 0;
  const totalCpi = c + outbound;
  const profitUsd = p - totalCpi;
  return {
    profitUsd,
    marginPercent: (profitUsd / p) * 100,
    inboundCpiUsd: c,
    totalCpiUsd: totalCpi,
  };
}

/** @param {number | null | undefined} marginPercent */
export function marginHealthFromPercent(marginPercent) {
  const m = toNumber(marginPercent);
  if (m == null) {
    return { profitHealth: "unknown", healthColor: "gray", healthEmoji: "❓" };
  }
  if (m >= 50) return { profitHealth: "excellent", healthColor: "green", healthEmoji: "🔥" };
  if (m >= 40) return { profitHealth: "good", healthColor: "emerald", healthEmoji: "✅" };
  if (m >= 30) return { profitHealth: "okay", healthColor: "yellow", healthEmoji: "👍" };
  if (m >= 15) return { profitHealth: "low", healthColor: "orange", healthEmoji: "⚠️" };
  if (m > 0) return { profitHealth: "poor", healthColor: "red", healthEmoji: "❌" };
  return { profitHealth: "loss", healthColor: "red", healthEmoji: "💸" };
}

/**
 * HTML badge matching products table style (free-shipping margin estimate).
 * @param {number | null | undefined} marginPercent
 */
export function formatMarginBadgeHtml(marginPercent) {
  const m = toNumber(marginPercent);
  if (m == null) return { html: "", hasData: false };

  const health = marginHealthFromPercent(m);
  const colorClass = {
    green: "bg-green-100 text-green-700",
    emerald: "bg-emerald-100 text-emerald-700",
    yellow: "bg-yellow-100 text-yellow-700",
    orange: "bg-orange-100 text-orange-700",
    red: "bg-red-100 text-red-700",
    gray: "bg-gray-100 text-gray-700",
  }[health.healthColor] || "bg-gray-100 text-gray-700";

  return {
    html: `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${colorClass}">${health.healthEmoji} ${Math.round(m)}%</span>`,
    hasData: true,
    margin: m,
    health: health.profitHealth,
  };
}

/** @param {*} value */
function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
