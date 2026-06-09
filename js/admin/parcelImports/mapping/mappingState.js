/** Local per-row mapping state and status derivation (Phase 3). */

import {
  MAPPING_STATUS,
  PLACEHOLDER_PRODUCT,
  PLACEHOLDER_VARIANT,
  ROW_TYPE,
} from "../constants.js";

/**
 * @param {object[]} items
 * @param {object[]} errors
 * @param {object[]} warnings
 */
export function initMappingFromItems(items, errors = [], warnings = []) {
  const rowIssueNumbers = buildRowIssueNumbers(errors, warnings);
  return items.map((item) => {
    const hasParserIssue =
      rowIssueNumbers.has(item.rowNumber) ||
      (item.rowIssues && item.rowIssues.length > 0);
    const row = createRowMapping(item, hasParserIssue);
    row.mappingStatus = deriveMappingStatus(row);
    return row;
  });
}

/**
 * @param {object} item
 * @param {boolean} hasParserIssue
 */
export function createRowMapping(item, hasParserIssue) {
  return {
    rowNumber: item.rowNumber,
    exportRowNo: item.exportRowNo ?? item.rowNumber,
    rowType: ROW_TYPE.BUSINESS,
    mappingStatus: hasParserIssue
      ? MAPPING_STATUS.PARSER_WARNING
      : MAPPING_STATUS.NEEDS_MAPPING,
    mappedProductLabel: PLACEHOLDER_PRODUCT,
    mappedVariantLabel: PLACEHOLDER_VARIANT,
    productId: null,
    productVariantId: null,
    mappingSource: "imported_placeholder",
    notes: "",
    hasParserIssue: !!hasParserIssue,
  };
}

/**
 * @param {object} row
 * @param {string} field
 * @param {string} value
 */
export function applyMappingFieldChange(row, field, value) {
  if (field === "rowType") {
    row.rowType = value;
    if (value === ROW_TYPE.PERSONAL) {
      row.mappingStatus = MAPPING_STATUS.PERSONAL_EXCLUDED;
      return row;
    }
  } else if (field === "mappedProductLabel") {
    row.mappedProductLabel = value;
  } else if (field === "mappedVariantLabel") {
    row.mappedVariantLabel = value;
  } else if (field === "notes") {
    row.notes = value;
    return row;
  }

  row.mappingStatus = deriveMappingStatus(row);
  return row;
}

/**
 * @param {object} row
 */
export function deriveMappingStatus(row) {
  if (row.rowType === ROW_TYPE.PERSONAL) {
    return MAPPING_STATUS.PERSONAL_EXCLUDED;
  }

  const hasProductId = !!row.productId;
  const hasVariantId = !!row.productVariantId;
  const product = row.mappedProductLabel;
  const variant = row.mappedVariantLabel;
  const isRealProduct =
    hasProductId || (product && product !== PLACEHOLDER_PRODUCT);
  const variantIsUnknown = variant === "Unknown";
  const variantEmpty = !variant || variant === PLACEHOLDER_VARIANT;

  if (row.hasParserIssue && !isRealProduct) {
    return MAPPING_STATUS.PARSER_WARNING;
  }

  if (row.rowType === ROW_TYPE.UNKNOWN) {
    return MAPPING_STATUS.NEEDS_MAPPING;
  }

  if (!isRealProduct) {
    if (row.rowType === ROW_TYPE.SUPPLIES) {
      return MAPPING_STATUS.NEEDS_MAPPING;
    }
    return row.hasParserIssue
      ? MAPPING_STATUS.PARSER_WARNING
      : MAPPING_STATUS.NEEDS_MAPPING;
  }

  if (hasProductId) {
    if (!hasVariantId) return MAPPING_STATUS.VARIANT_UNCERTAIN;
    return MAPPING_STATUS.MATCHED;
  }

  if (variantIsUnknown || variantEmpty) {
    return MAPPING_STATUS.VARIANT_UNCERTAIN;
  }

  return MAPPING_STATUS.MATCHED;
}

/**
 * @param {object} row
 * @param {object} patch
 */
export function applyProductMappingPatch(row, patch) {
  if (patch.productId !== undefined) row.productId = patch.productId || null;
  if (patch.productVariantId !== undefined) {
    row.productVariantId = patch.productVariantId || null;
  }
  if (patch.mappedProductLabel !== undefined) {
    row.mappedProductLabel = patch.mappedProductLabel;
  }
  if (patch.mappedVariantLabel !== undefined) {
    row.mappedVariantLabel = patch.mappedVariantLabel;
  }
  if (patch.mappingSource !== undefined) row.mappingSource = patch.mappingSource;
  if (patch.rowType !== undefined) row.rowType = patch.rowType;

  if (
    row.productId &&
    row.rowType !== ROW_TYPE.PERSONAL &&
    row.rowType !== ROW_TYPE.SUPPLIES
  ) {
    row.rowType = ROW_TYPE.BUSINESS;
  }

  row.mappingStatus = deriveMappingStatus(row);
  return row;
}

/**
 * @param {object[]} rowMappings
 */
export function computeMappingCounts(rowMappings) {
  const counts = {
    rowCount: rowMappings.length,
    matchedCount: 0,
    variantUncertainCount: 0,
    personalExcludedCount: 0,
    needsMappingCount: 0,
    parserWarningCount: 0,
    suppliesCount: 0,
  };

  rowMappings.forEach((row) => {
    const status = row.mappingStatus;
    if (row.rowType === ROW_TYPE.SUPPLIES) counts.suppliesCount++;

    switch (status) {
      case MAPPING_STATUS.MATCHED:
        counts.matchedCount++;
        break;
      case MAPPING_STATUS.VARIANT_UNCERTAIN:
        counts.variantUncertainCount++;
        break;
      case MAPPING_STATUS.PERSONAL_EXCLUDED:
        counts.personalExcludedCount++;
        break;
      case MAPPING_STATUS.PARSER_WARNING:
        counts.parserWarningCount++;
        break;
      case MAPPING_STATUS.NEEDS_MAPPING:
      default:
        counts.needsMappingCount++;
        break;
    }
  });

  counts.unmappedRowsKpi =
    counts.needsMappingCount +
    counts.variantUncertainCount +
    counts.parserWarningCount;

  return counts;
}

/**
 * @param {string} status
 */
export function statusPillClasses(status) {
  switch (status) {
    case MAPPING_STATUS.MATCHED:
      return "text-green-800 bg-green-50 border-green-200";
    case MAPPING_STATUS.VARIANT_UNCERTAIN:
      return "text-amber-800 bg-amber-50 border-amber-200";
    case MAPPING_STATUS.PERSONAL_EXCLUDED:
      return "text-gray-600 bg-gray-100 border-gray-300";
    case MAPPING_STATUS.PARSER_WARNING:
      return "text-amber-800 bg-amber-50 border-amber-200";
    case MAPPING_STATUS.NEEDS_MAPPING:
    default:
      return "text-red-800 bg-red-50 border-red-200";
  }
}

/**
 * @param {object[]} errors
 * @param {object[]} warnings
 */
function buildRowIssueNumbers(errors, warnings) {
  const set = new Set();
  [...errors, ...warnings].forEach((i) => {
    if (i.rowNumber != null) set.add(i.rowNumber);
  });
  return set;
}

/**
 * @param {object[]} rowMappings
 * @param {number} rowNumber
 */
export function findRowMapping(rowMappings, rowNumber) {
  return rowMappings.find((r) => r.rowNumber === rowNumber) ?? null;
}
