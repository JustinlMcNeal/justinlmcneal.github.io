/** UI label ↔ DB enum codec for parcel import mappings. */

import { MAPPING_STATUS, ROW_TYPE } from "../constants.js";

const ROW_TYPE_ENCODE = {
  [ROW_TYPE.BUSINESS]: "business_inventory",
  [ROW_TYPE.PERSONAL]: "personal_excluded",
  [ROW_TYPE.SUPPLIES]: "supplies",
  [ROW_TYPE.UNKNOWN]: "unknown",
};

const ROW_TYPE_DECODE = Object.fromEntries(
  Object.entries(ROW_TYPE_ENCODE).map(([k, v]) => [v, k]),
);

const MAPPING_STATUS_ENCODE = {
  [MAPPING_STATUS.NEEDS_MAPPING]: "needs_mapping",
  [MAPPING_STATUS.MATCHED]: "matched",
  [MAPPING_STATUS.VARIANT_UNCERTAIN]: "variant_uncertain",
  [MAPPING_STATUS.PERSONAL_EXCLUDED]: "personal_excluded",
  [MAPPING_STATUS.PARSER_WARNING]: "parser_warning",
};

const MAPPING_STATUS_DECODE = Object.fromEntries(
  Object.entries(MAPPING_STATUS_ENCODE).map(([k, v]) => [v, k]),
);

/** @param {string} uiLabel */
export function encodeRowType(uiLabel) {
  const encoded = ROW_TYPE_ENCODE[uiLabel];
  if (!encoded) throw new Error(`Unknown row type label: ${uiLabel}`);
  return encoded;
}

/** @param {string} dbValue */
export function decodeRowType(dbValue) {
  return ROW_TYPE_DECODE[dbValue] ?? ROW_TYPE.UNKNOWN;
}

/** @param {string} uiLabel */
export function encodeMappingStatus(uiLabel) {
  const encoded = MAPPING_STATUS_ENCODE[uiLabel];
  if (!encoded) throw new Error(`Unknown mapping status label: ${uiLabel}`);
  return encoded;
}

/** @param {string} dbValue */
export function decodeMappingStatus(dbValue) {
  return MAPPING_STATUS_DECODE[dbValue] ?? MAPPING_STATUS.NEEDS_MAPPING;
}

/** @param {string} method */
export function encodeAllocationMethod(method) {
  if (method === "weight") return "weight_based";
  if (method === "equal") return "equal_split";
  throw new Error(`Unknown allocation method: ${method}`);
}
