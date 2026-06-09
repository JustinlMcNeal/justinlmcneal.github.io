/** Build local landed CPI preview from parse + overrides + mapping (Phase 4). */

import { MAPPING_STATUS, ROW_TYPE } from "../constants.js";
import {
  allocateFee,
  buildWeightAllocation,
  lineAllocationWeight,
} from "./costAllocation.js";

export const OUTBOUND_SHIPPING_PLACEHOLDER_USD = 5;

/**
 * @param {object} params
 * @param {object | null} params.parcel
 * @param {object[]} params.items
 * @param {object | null} params.overrides
 * @param {object[]} params.rowMappings
 */
export function buildCpiPreview({ parcel, items, overrides, rowMappings }) {
  /** @type {string[]} */
  const warnings = [];

  if (!items.length || !overrides) {
    return emptyPreview(warnings);
  }

  const mappingByRow = new Map(rowMappings.map((m) => [m.rowNumber, m]));
  const alloc = buildWeightAllocation(items);
  warnings.push(...alloc.warnings);

  const shipmentFee = overrides.shipmentFeeCny ?? 0;
  const serviceFee = overrides.serviceFeeCny ?? 0;
  const insuranceFee = overrides.insuranceCny ?? 0;
  const parcelWeight = overrides.parcelWeightGrams;
  const chargedWeight = overrides.chargedWeightGrams;

  if (
    chargedWeight != null &&
    parcelWeight != null &&
    chargedWeight > parcelWeight
  ) {
    warnings.push(
      "Charged weight exceeds parcel weight — billing likely used volume weight; row shares still use item weights.",
    );
  }

  const fxRate = resolveEffectiveFxRate(overrides);
  if (!fxRate) {
    warnings.push("Missing FX rate — USD values unavailable.");
  }

  /** @type {object[]} */
  const rows = [];
  let totalAllocatedShipment = 0;

  items.forEach((item) => {
    const mapping = mappingByRow.get(item.rowNumber) ?? {};
    const qty = item.quantity ?? 0;
    const lineWeight = alloc.rowWeights.get(item.rowNumber) ?? 0;
    const rowWarnings = [];

    const productCostCny = (item.unitPriceCny ?? 0) * (qty > 0 ? qty : 0);
    const sellerFreightCny = item.sellerFreightCny ?? 0;
    if (item.sellerFreightCny == null) {
      rowWarnings.push("Seller freight treated as ¥0.00.");
    }

    const parcelShippingShareCny = allocateFee(
      shipmentFee,
      lineWeight,
      alloc.totalWeight,
      alloc.method,
      items.length,
    );
    const serviceShareCny = allocateFee(
      serviceFee,
      lineWeight,
      alloc.totalWeight,
      alloc.method,
      items.length,
    );
    const insuranceShareCny = allocateFee(
      insuranceFee,
      lineWeight,
      alloc.totalWeight,
      alloc.method,
      items.length,
    );
    const fxPaymentShareCny = 0;

    totalAllocatedShipment += parcelShippingShareCny;

    if (lineAllocationWeight(item) <= 0) {
      rowWarnings.push("Missing or zero weight — excluded from weight allocation.");
    }
    if (qty <= 0) {
      rowWarnings.push("Missing or zero quantity — per-unit CPI unavailable.");
    }

    const landedTotalCny =
      productCostCny +
      sellerFreightCny +
      parcelShippingShareCny +
      serviceShareCny +
      insuranceShareCny +
      fxPaymentShareCny;

    const landedCpiCny = qty > 0 ? landedTotalCny / qty : null;
    const landedCpiUsd =
      landedCpiCny != null && fxRate ? landedCpiCny / fxRate : null;

    const includedInProductCpiPreview = isIncludedInCpiPreview(mapping);

    rows.push({
      rowNumber: item.rowNumber,
      sourceItemName: item.sourceItemName ?? "",
      rowType: mapping.rowType ?? ROW_TYPE.BUSINESS,
      mappingStatus: mapping.mappingStatus ?? MAPPING_STATUS.NEEDS_MAPPING,
      mappedProductLabel: mapping.mappedProductLabel,
      mappedVariantLabel: mapping.mappedVariantLabel,
      quantity: qty,
      itemWeightGrams: item.itemWeightGrams,
      productCostCny,
      sellerFreightCny,
      parcelShippingShareCny,
      serviceShareCny,
      insuranceShareCny,
      fxPaymentShareCny,
      landedTotalCny,
      landedCpiCny,
      landedCpiUsd,
      includedInProductCpiPreview,
      warnings: rowWarnings,
    });
  });

  const summary = buildSummary(rows, overrides, fxRate, {
    shipmentFee,
    totalAllocatedShipment,
  });

  if (summary.productsAffected === 0) {
    warnings.push("No matched business rows — product CPI preview is empty.");
  }
  if (!summary.readyToUpdate) {
    warnings.push("Mapping issues remain — not ready to update CPI.");
  }

  return { rows, summary, warnings: dedupeWarnings(warnings) };
}

/**
 * @param {object} mapping
 */
function isIncludedInCpiPreview(mapping) {
  return (
    mapping.rowType === ROW_TYPE.BUSINESS &&
    mapping.mappingStatus === MAPPING_STATUS.MATCHED
  );
}

/**
 * @param {object} overrides
 */
function resolveEffectiveFxRate(overrides) {
  const direct = overrides.effectiveFxRate;
  if (direct != null && direct > 0) return direct;

  const total = overrides.totalParcelChargeCny;
  const usd = overrides.usdEquivalent;
  if (total != null && total > 0 && usd != null && usd > 0) {
    return total / usd;
  }
  return null;
}

/**
 * @param {object[]} rows
 * @param {object} overrides
 * @param {number | null} fxRate
 * @param {{ shipmentFee: number, totalAllocatedShipment: number }} fees
 */
function buildSummary(rows, overrides, fxRate, fees) {
  let businessRows = 0;
  let matchedRows = 0;
  let variantUncertainRows = 0;
  let personalRows = 0;
  let suppliesRows = 0;
  let needsMappingRows = 0;
  let productsAffected = 0;
  let businessMappingIssues = 0;

  rows.forEach((r) => {
    if (r.rowType === ROW_TYPE.BUSINESS) businessRows++;
    if (r.rowType === ROW_TYPE.PERSONAL) personalRows++;
    if (r.rowType === ROW_TYPE.SUPPLIES) suppliesRows++;
    if (r.mappingStatus === MAPPING_STATUS.MATCHED) matchedRows++;
    if (r.mappingStatus === MAPPING_STATUS.VARIANT_UNCERTAIN) {
      variantUncertainRows++;
    }
    if (
      r.mappingStatus === MAPPING_STATUS.NEEDS_MAPPING ||
      r.mappingStatus === MAPPING_STATUS.PARSER_WARNING ||
      r.rowType === ROW_TYPE.UNKNOWN
    ) {
      needsMappingRows++;
    }
    if (r.includedInProductCpiPreview) productsAffected++;

    if (r.rowType === ROW_TYPE.BUSINESS) {
      if (
        r.mappingStatus === MAPPING_STATUS.NEEDS_MAPPING ||
        r.mappingStatus === MAPPING_STATUS.VARIANT_UNCERTAIN ||
        r.mappingStatus === MAPPING_STATUS.PARSER_WARNING
      ) {
        businessMappingIssues++;
      }
    }
    if (r.rowType === ROW_TYPE.UNKNOWN) businessMappingIssues++;
  });

  const included = rows.filter((r) => r.includedInProductCpiPreview);
  const previewRows = included.length
    ? included
    : rows.filter((r) => r.rowType === ROW_TYPE.BUSINESS);
  const weighted = weightedAverages(previewRows, fxRate);

  const readyToUpdate =
    productsAffected > 0 && businessMappingIssues === 0;

  const fulfilledCpiPreviewUsd =
    weighted.weightedAverageLandedCpiUsd != null
      ? weighted.weightedAverageLandedCpiUsd + OUTBOUND_SHIPPING_PLACEHOLDER_USD
      : null;

  return {
    businessRows,
    matchedRows,
    variantUncertainRows,
    personalRows,
    suppliesRows,
    needsMappingRows,
    productsAffected,
    readyToUpdate,
    rowsExcluded: personalRows + suppliesRows,
    totalShipmentFeeCny: fees.shipmentFee,
    totalAllocatedShipmentCny: fees.totalAllocatedShipment,
    ...weighted,
    fulfilledCpiPreviewUsd,
    effectiveFxRate: fxRate,
    parcelWeightGrams: overrides.parcelWeightGrams,
    chargedWeightGrams: overrides.chargedWeightGrams,
  };
}

/**
 * @param {object[]} includedRows
 * @param {number | null} fxRate
 */
function weightedAverages(includedRows, fxRate) {
  let totalQty = 0;
  let sumCpiCny = 0;
  let sumProduct = 0;
  let sumSeller = 0;
  let sumParcel = 0;
  let sumInsSvc = 0;
  let sumFx = 0;
  let sumLanded = 0;

  includedRows.forEach((r) => {
    const q = r.quantity ?? 0;
    if (q <= 0 || r.landedCpiCny == null) return;
    totalQty += q;
    sumCpiCny += r.landedCpiCny * q;
    sumProduct += r.productCostCny;
    sumSeller += r.sellerFreightCny;
    sumParcel += r.parcelShippingShareCny;
    sumInsSvc += r.serviceShareCny + r.insuranceShareCny;
    sumFx += r.fxPaymentShareCny;
    sumLanded += r.landedTotalCny;
  });

  if (totalQty <= 0) {
    return {
      averageLandedCpiCny: null,
      averageLandedCpiUsd: null,
      weightedAverageLandedCpiCny: null,
      weightedAverageLandedCpiUsd: null,
      breakdownProductCny: null,
      breakdownSellerFreightCny: null,
      breakdownParcelShippingCny: null,
      breakdownInsuranceServiceCny: null,
      breakdownFxCny: null,
      breakdownTotalCny: null,
      breakdownProductUsd: null,
      breakdownSellerFreightUsd: null,
      breakdownParcelShippingUsd: null,
      breakdownInsuranceServiceUsd: null,
      breakdownFxUsd: null,
      breakdownTotalUsd: null,
    };
  }

  const weightedAverageLandedCpiCny = sumCpiCny / totalQty;
  const weightedAverageLandedCpiUsd = fxRate
    ? weightedAverageLandedCpiCny / fxRate
    : null;

  const toPerUnit = (sum) => sum / totalQty;
  const toUsd = (cny) => (fxRate ? cny / fxRate : null);

  const breakdownProductCny = toPerUnit(sumProduct);
  const breakdownSellerFreightCny = toPerUnit(sumSeller);
  const breakdownParcelShippingCny = toPerUnit(sumParcel);
  const breakdownInsuranceServiceCny = toPerUnit(sumInsSvc);
  const breakdownFxCny = toPerUnit(sumFx);
  const breakdownTotalCny = toPerUnit(sumLanded);

  return {
    averageLandedCpiCny: weightedAverageLandedCpiCny,
    averageLandedCpiUsd: weightedAverageLandedCpiUsd,
    weightedAverageLandedCpiCny,
    weightedAverageLandedCpiUsd,
    breakdownProductCny,
    breakdownSellerFreightCny,
    breakdownParcelShippingCny,
    breakdownInsuranceServiceCny,
    breakdownFxCny,
    breakdownTotalCny,
    breakdownProductUsd: toUsd(breakdownProductCny),
    breakdownSellerFreightUsd: toUsd(breakdownSellerFreightCny),
    breakdownParcelShippingUsd: toUsd(breakdownParcelShippingCny),
    breakdownInsuranceServiceUsd: toUsd(breakdownInsuranceServiceCny),
    breakdownFxUsd: toUsd(breakdownFxCny),
    breakdownTotalUsd: toUsd(breakdownTotalCny),
  };
}

/**
 * @param {string[]} warnings
 */
function dedupeWarnings(warnings) {
  return [...new Set(warnings.filter(Boolean))];
}

/**
 * @param {string[]} warnings
 */
function emptyPreview(warnings) {
  return {
    rows: [],
    summary: {
      businessRows: 0,
      matchedRows: 0,
      variantUncertainRows: 0,
      personalRows: 0,
      suppliesRows: 0,
      needsMappingRows: 0,
      productsAffected: 0,
      readyToUpdate: false,
      rowsExcluded: 0,
      totalShipmentFeeCny: 0,
      totalAllocatedShipmentCny: 0,
      averageLandedCpiCny: null,
      averageLandedCpiUsd: null,
      weightedAverageLandedCpiCny: null,
      weightedAverageLandedCpiUsd: null,
      fulfilledCpiPreviewUsd: null,
      effectiveFxRate: null,
    },
    warnings,
  };
}
