/** Parcel Planner math — shipping model fit, landed cost per unit, eBay profit, readiness. */

import { estimateLabelCost } from "/js/admin/ebayListings/profitPreview.js";

export const DEFAULT_PLAN_SETTINGS = {
  fxRate: null,
  fixedCny: null,
  perKgCny: null,
  volumeFactor: null,
  targetSharePct: 45,
  fvfPct: 13.25,
  fixedFeeUsd: 0.4,
  adPct: 8,
};

const FALLBACK_MODEL = { fixedCny: 300, perKgCny: 55, volumeFactor: 1.25, fxRate: 7.21 };
const MIN_CHARGED_KG = 0.5;
const TOO_EARLY_SHARE = 0.6;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Least-squares fit of (shipping + service fee) ¥ against charged kg across past parcels.
 * @param {object[]} history rows from parcel_imports
 */
export function fitShippingModel(history) {
  const points = [];
  const volumeRatios = [];
  const pastShares = [];
  let latestFx = null;

  history.forEach((row) => {
    const chargedG = num(row.actual_charged_weight_grams ?? row.xls_charged_weight_grams);
    const parcelG = num(row.actual_parcel_weight_grams ?? row.xls_parcel_weight_grams);
    const fee =
      num(row.actual_shipment_fee_cny ?? row.xls_shipment_fee_cny) +
      num(row.actual_service_fee_cny ?? row.xls_service_fee_cny);
    if (chargedG > 0 && fee > 0) points.push({ kg: chargedG / 1000, fee });
    const itemsCny = num(row.xls_total_item_fee_cny);
    if (fee > 0 && itemsCny > 0) pastShares.push(fee / (fee + itemsCny));
    if (chargedG > 0 && parcelG > 0) volumeRatios.push(chargedG / parcelG);
    if (num(row.effective_fx_rate) > 0) latestFx = num(row.effective_fx_rate);
  });

  let fixedCny = FALLBACK_MODEL.fixedCny;
  let perKgCny = FALLBACK_MODEL.perKgCny;
  if (points.length >= 2) {
    const meanX = points.reduce((s, p) => s + p.kg, 0) / points.length;
    const meanY = points.reduce((s, p) => s + p.fee, 0) / points.length;
    const sxx = points.reduce((s, p) => s + (p.kg - meanX) ** 2, 0);
    const sxy = points.reduce((s, p) => s + (p.kg - meanX) * (p.fee - meanY), 0);
    const slope = sxx > 0 ? sxy / sxx : 0;
    if (slope > 0 && meanY - slope * meanX > 0) {
      perKgCny = slope;
      fixedCny = meanY - slope * meanX;
    }
  }

  return {
    fixedCny,
    perKgCny,
    volumeFactor: median(volumeRatios) ?? FALLBACK_MODEL.volumeFactor,
    fxRate: latestFx,
    samples: points.length,
    points,
    pastShares,
  };
}

/**
 * Settings override the fitted model wherever the admin entered a value.
 * @param {ReturnType<typeof fitShippingModel>} model
 * @param {typeof DEFAULT_PLAN_SETTINGS} settings
 */
export function resolveModel(model, settings) {
  const pick = (override, fitted) => (override != null && override !== "" ? num(override) : fitted);
  return {
    fixedCny: pick(settings.fixedCny, model.fixedCny),
    perKgCny: pick(settings.perKgCny, model.perKgCny),
    volumeFactor: pick(settings.volumeFactor, model.volumeFactor),
    fxRate: num(settings.fxRate) || model.fxRate || FALLBACK_MODEL.fxRate,
  };
}

/** @param {number} chargedKg @param {{ fixedCny: number, perKgCny: number }} m */
export function shippingCnyForKg(chargedKg, m) {
  return m.fixedCny + m.perKgCny * Math.max(chargedKg, MIN_CHARGED_KG);
}

/**
 * @param {object[]} items parcel_plan_items rows (status planned)
 * @param {ReturnType<typeof resolveModel>} m
 * @param {typeof DEFAULT_PLAN_SETTINGS} settings
 */
export function estimatePlan(items, m, settings) {
  const units = items.reduce((s, it) => s + num(it.qty), 0);
  const rawG = items.reduce((s, it) => s + num(it.unit_weight_g) * num(it.qty), 0);
  const itemsCny = items.reduce(
    (s, it) => s + num(it.unit_price_cny) * num(it.qty) + num(it.seller_freight_cny),
    0,
  );
  const chargedKg = (rawG * m.volumeFactor) / 1000;
  const shipCny = items.length ? shippingCnyForKg(chargedKg, m) : 0;
  const totalCny = itemsCny + shipCny;
  const shippingShare = totalCny > 0 ? shipCny / totalCny : 0;

  const fvf = num(settings.fvfPct) / 100;
  const ad = num(settings.adPct) / 100;
  const fixedFee = num(settings.fixedFeeUsd);

  const rows = items.map((it) => {
    const qty = Math.max(num(it.qty), 1);
    const weight = num(it.unit_weight_g);
    const shipPerUnitCny =
      rawG > 0 ? shipCny * (weight / rawG) : units > 0 ? shipCny / units : 0;
    const landedCny = num(it.unit_price_cny) + num(it.seller_freight_cny) / qty + shipPerUnitCny;
    const landedUsd = landedCny / m.fxRate;
    const sellUsd = num(it.target_price_usd);
    let profitUsd = null;
    let marginPct = null;
    if (sellUsd > 0) {
      const label = estimateLabelCost(weight) ?? 0;
      profitUsd = sellUsd * (1 - fvf - ad) - fixedFee - label - landedUsd;
      marginPct = (profitUsd / sellUsd) * 100;
    }
    return { id: it.id, shipPerUnitUsd: shipPerUnitCny / m.fxRate, landedUsd, profitUsd, marginPct };
  });

  return {
    units,
    rawG,
    chargedKg,
    itemsCny,
    shipCny,
    totalCny,
    totalUsd: totalCny / m.fxRate,
    shipUsd: shipCny / m.fxRate,
    shippingShare,
    avgShipPer100gUsd: rawG > 0 ? (shipCny / m.fxRate) * (100 / rawG) : null,
    marginalShipPer100gUsd: (m.perKgCny * m.volumeFactor * 0.1) / m.fxRate,
    rows,
    readiness: readinessFor(items.length, shippingShare, num(settings.targetSharePct) / 100),
  };
}

/** @returns {{ level: 'empty'|'early'|'close'|'ready', label: string }} */
function readinessFor(count, share, targetShare) {
  if (!count) return { level: "empty", label: "Add items to start planning" };
  if (share <= targetShare) return { level: "ready", label: "Ready to order" };
  if (share <= TOO_EARLY_SHARE) return { level: "close", label: "Getting close — add a bit more" };
  return { level: "early", label: "Too early — shipping eats the margin" };
}

/**
 * Shipping cost ladder at a few parcel sizes so the fixed-fee effect is visible.
 * @param {ReturnType<typeof resolveModel>} m
 */
export function shippingLadder(m) {
  return [1, 2, 4, 6, 8, 10].map((kg) => {
    const cny = shippingCnyForKg(kg, m);
    return { kg, cny, usd: cny / m.fxRate, usdPerKg: cny / m.fxRate / kg };
  });
}
