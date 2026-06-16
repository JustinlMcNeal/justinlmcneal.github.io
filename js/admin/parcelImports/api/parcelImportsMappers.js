/** Payload mappers for save_parcel_import_draft RPC (Phase 6A/7). */

import { SOURCE_FORMAT, MAPPING_STATUS, ROW_TYPE, PLACEHOLDER_PRODUCT } from "../constants.js";
import { buildCpiPreview } from "../cpi/cpiPreview.js";
import { buildWeightAllocation } from "../cpi/costAllocation.js";
import { encodeAllocationMethod, encodeMappingStatus, encodeRowType } from "../mapping/enumCodec.js";
import {
  hasOverrideFieldErrors,
  validateOverrides,
} from "../validation/overrideValidators.js";

/**
 * @param {File} file
 */
export async function sha256File(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** @param {*} value */
function toJsonNumber(value) {
  if (value == null) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/** @param {object} overrides */
function stripOverrides(overrides) {
  if (!overrides) return {};
  const { dirtyFields: _d, ...rest } = overrides;
  return {
    parcelWeightGrams: toJsonNumber(rest.parcelWeightGrams),
    chargedWeightGrams: toJsonNumber(rest.chargedWeightGrams),
    shipmentFeeCny: toJsonNumber(rest.shipmentFeeCny),
    serviceFeeCny: toJsonNumber(rest.serviceFeeCny),
    insuranceYes: rest.insuranceYes ?? null,
    insuranceCny: toJsonNumber(rest.insuranceCny),
    totalParcelChargeCny: toJsonNumber(rest.totalParcelChargeCny),
    effectiveFxRate: toJsonNumber(rest.effectiveFxRate),
    usdEquivalent: toJsonNumber(rest.usdEquivalent),
  };
}

/** @param {object} item */
function serializeItem(item) {
  return {
    rowNumber: item.rowNumber,
    exportRowNo: toJsonNumber(item.exportRowNo),
    sourceItemName: item.sourceItemName ?? "",
    sellerName: item.sellerName ?? null,
    baestaoOrderId: item.baestaoOrderId ?? null,
    unitPriceCny: toJsonNumber(item.unitPriceCny),
    quantity: toJsonNumber(item.quantity),
    itemWeightGrams: toJsonNumber(item.itemWeightGrams),
    sellerFreightCny: toJsonNumber(item.sellerFreightCny),
    rowTotalCny: toJsonNumber(item.rowTotalCny),
    lineItemSubtotalCny: toJsonNumber(item.lineItemSubtotalCny),
    removePackage: item.removePackage ?? null,
    raw: item.raw ?? {},
    rowIssues: item.rowIssues ?? [],
  };
}

/** @param {object} row */
function resolveMappingSource(row) {
  if (row.mappingSource) return row.mappingSource;
  if (row.productId) return "manual";
  const label = row.mappedProductLabel;
  if (label && label !== PLACEHOLDER_PRODUCT) return "manual";
  return "imported_placeholder";
}

/** @param {object} row */
function serializeMapping(row) {
  return {
    rowNumber: row.rowNumber,
    rowType: encodeRowType(row.rowType),
    mappingStatus: encodeMappingStatus(row.mappingStatus),
    mappedProductLabel: row.mappedProductLabel ?? null,
    mappedVariantLabel: row.mappedVariantLabel ?? null,
    productId: row.productId ?? null,
    productVariantId: row.productVariantId ?? null,
    mappingSource: resolveMappingSource(row),
    notes: row.notes ?? null,
  };
}

/** @param {object} row @param {number | null} summaryFx */
function serializeAllocationRow(row, summaryFx) {
  return {
    rowNumber: row.rowNumber,
    productCostCny: toJsonNumber(row.productCostCny) ?? 0,
    sellerFreightCny: toJsonNumber(row.sellerFreightCny) ?? 0,
    parcelShippingShareCny: toJsonNumber(row.parcelShippingShareCny) ?? 0,
    serviceShareCny: toJsonNumber(row.serviceShareCny) ?? 0,
    insuranceShareCny: toJsonNumber(row.insuranceShareCny) ?? 0,
    fxPaymentShareCny: toJsonNumber(row.fxPaymentShareCny) ?? 0,
    landedTotalCny: toJsonNumber(row.landedTotalCny) ?? 0,
    landedCpiCny: toJsonNumber(row.landedCpiCny),
    landedCpiUsd: toJsonNumber(row.landedCpiUsd),
    effectiveFxRate: toJsonNumber(row.effectiveFxRate) ?? summaryFx,
    includedInProductCpiPreview: !!row.includedInProductCpiPreview,
    warnings: row.warnings ?? [],
  };
}

/** @param {object} state @param {object} cpiPreview */
export function computeStatusIntent(state, cpiPreview) {
  const validation = validateOverrides(state.overrides, state.xlsBaseline);
  const overrideErrors = hasOverrideFieldErrors(validation.fieldMessages);

  if (state.errors?.length > 0) return "needs_review";
  if (overrideErrors) return "needs_review";

  const summary = cpiPreview.summary ?? {};
  if (summary.readyToUpdate && !overrideErrors) return "ready_to_approve";
  if (summary.needsMappingRows > 0) return "needs_review";
  if (summary.productsAffected === 0 && summary.businessRows > 0) {
    return "needs_review";
  }

  for (const row of state.rowMappings ?? []) {
    if (row.mappingStatus === MAPPING_STATUS.VARIANT_UNCERTAIN) {
      return "needs_review";
    }
    if (row.rowType === ROW_TYPE.UNKNOWN) return "needs_review";
    if (
      row.mappingStatus === MAPPING_STATUS.PARSER_WARNING &&
      row.rowType === ROW_TYPE.BUSINESS
    ) {
      return "needs_review";
    }
  }

  if (cpiPreview.warnings?.length > 0) return "needs_review";
  if (state.warnings?.length > 0) return "needs_review";
  return "draft";
}

/** @param {object} state */
export async function buildSaveDraftPayload(state) {
  if (!state.parcel?.parcelId) {
    throw new Error("Missing parcel ID — parse a file first.");
  }
  if (!state.items?.length) {
    throw new Error("No items to save — parse a file first.");
  }

  const cpiPreview = buildCpiPreview({
    parcel: state.parcel,
    items: state.items,
    overrides: state.overrides,
    rowMappings: state.rowMappings,
  });

  const alloc = buildWeightAllocation(state.items);
  const validation = validateOverrides(state.overrides, state.xlsBaseline);
  const mappingByRow = new Map(
    (state.rowMappings ?? []).map((m) => [m.rowNumber, m]),
  );

  const mappings = state.items.map((item) => {
    const row = mappingByRow.get(item.rowNumber);
    if (!row) {
      return {
        rowNumber: item.rowNumber,
        rowType: "unknown",
        mappingStatus: "needs_mapping",
        mappedProductLabel: null,
        mappedVariantLabel: null,
        productId: null,
        productVariantId: null,
        mappingSource: "imported_placeholder",
        notes: null,
      };
    }
    return serializeMapping(row);
  });

  let fileMeta = {
    name: null,
    sizeBytes: null,
    hash: null,
    sourceFormat: SOURCE_FORMAT.BAESTAO_HTML_XLS,
  };

  if (state.currentFile) {
    fileMeta = {
      name: state.currentFile.name ?? null,
      sizeBytes: state.currentFile.size ?? null,
      hash: await sha256File(state.currentFile),
      sourceFormat: SOURCE_FORMAT.BAESTAO_HTML_XLS,
    };
  } else if (state.parcel?.sourceFileName) {
    fileMeta.name = state.parcel.sourceFileName;
  }

  const summaryFx = toJsonNumber(cpiPreview.summary?.effectiveFxRate);
  const overridesForSave = stripOverrides(state.overrides);
  if (overridesForSave.effectiveFxRate == null && summaryFx != null) {
    overridesForSave.effectiveFxRate = summaryFx;
  }

  return {
    importId: state.currentImportId ?? null,
    fileMeta,
    parcel: { ...state.parcel },
    xlsBaseline: state.xlsBaseline ? { ...state.xlsBaseline } : {},
    overrides: overridesForSave,
    items: state.items.map(serializeItem),
    mappings,
    cpiPreview: {
      allocationMethod: encodeAllocationMethod(alloc.method),
      rows: cpiPreview.rows.map((r) => serializeAllocationRow(r, summaryFx)),
      summary: {
        productsAffected: toJsonNumber(cpiPreview.summary?.productsAffected) ?? 0,
        rowsExcluded: toJsonNumber(cpiPreview.summary?.rowsExcluded) ?? 0,
        needsMappingRows: toJsonNumber(cpiPreview.summary?.needsMappingRows) ?? 0,
        readyToUpdate: !!cpiPreview.summary?.readyToUpdate,
        effectiveFxRate: summaryFx,
      },
      warnings: cpiPreview.warnings ?? [],
    },
    warnings: {
      parseErrors: state.errors ?? [],
      parseWarnings: state.warnings ?? [],
      overrideErrors: validation.fieldMessages,
      cpiWarnings: cpiPreview.warnings ?? [],
    },
    statusIntent: computeStatusIntent(state, cpiPreview),
  };
}
