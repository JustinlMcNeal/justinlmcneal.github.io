/**
 * Baestao HTML-table .xls parser orchestrator (Phase 1B).
 */

import { ITEM_HEADER_ALIASES, PARCEL_LABEL_ALIASES, SOURCE_FORMAT } from "../constants.js";
import { extractFooterMetadata, rowIsFooterOrMetadata } from "./footerMetadata.js";
import {
  detectHtmlTableText,
  isLikelyBinaryContent,
  normalizeCellText,
  parseHtmlTables,
} from "./htmlTableParser.js";
import { normalizeItemRow, normalizeParcel, normalizeText } from "./normalizers.js";
import { issue, validateParseResult } from "./validators.js";

/**
 * @param {string} text
 * @param {{ name?: string, size?: number }} [fileMeta]
 */
export function parseBaestaoFileText(text, fileMeta = {}) {
  const base = {
    parcel: null,
    items: [],
    errors: [],
    warnings: [],
    sourceFormat: SOURCE_FORMAT.UNKNOWN,
    rawTables: [],
  };

  if (!text || !normalizeText(text)) {
    const v = validateParseResult(null, [], { emptyFile: true });
    return { ...base, errors: v.errors, warnings: v.warnings };
  }

  if (isLikelyBinaryContent(text)) {
    const v = validateParseResult(null, [], {
      unsupportedFormat: true,
      unsupportedMessage:
        "This file looks like binary Excel (.xlsx/.xls BIFF). Only HTML-table-style Baestao exports saved as .xls are supported.",
    });
    return { ...base, errors: v.errors, warnings: v.warnings };
  }

  if (!detectHtmlTableText(text)) {
    const v = validateParseResult(null, [], {
      unsupportedFormat: true,
      unsupportedMessage:
        "No HTML table markup detected. Export from Baestao as the HTML-style .xls file.",
    });
    return { ...base, errors: v.errors, warnings: v.warnings };
  }

  const rawTables = parseHtmlTables(text);
  base.rawTables = rawTables;
  base.sourceFormat = SOURCE_FORMAT.BAESTAO_HTML_XLS;

  if (!rawTables.length) {
    const v = validateParseResult(null, [], { noTables: true });
    return { ...base, errors: v.errors, warnings: v.warnings };
  }

  const parcelFields = mergeParcelFieldSources(
    extractFooterMetadata(rawTables, text),
    extractNarrowLabelTables(rawTables),
  );

  const itemResult = locateItemTable(rawTables);
  if (!itemResult) {
    const v = validateParseResult(parcelFields, [], {
      noTables: false,
      missingItemTable: true,
    });
    return { ...base, parcel: normalizeParcel(parcelFields, fileMeta), errors: v.errors, warnings: v.warnings };
  }

  const items = itemResult.dataRows.map((row, i) =>
    normalizeItemRow(row, itemResult.columnMap, i + 1),
  );

  const parcel = normalizeParcel(parcelFields, fileMeta);
  if (parcel.totalItems == null) {
    const qtySum = items.reduce((s, it) => s + (it.quantity || 0), 0);
    if (qtySum > 0) parcel.totalItems = qtySum;
  }

  const validation = validateParseResult(parcel, items, {
    columnMap: itemResult.columnMap,
  });

  return {
    parcel,
    items,
    errors: validation.errors,
    warnings: validation.warnings,
    sourceFormat: base.sourceFormat,
    rawTables,
  };
}

/**
 * @param {Record<string, unknown>} footer
 * @param {Record<string, unknown>} narrow
 */
function mergeParcelFieldSources(footer, narrow) {
  return {
    ...narrow,
    ...footer,
    raw: { ...(narrow.raw || {}), ...(footer.raw || {}) },
  };
}

/**
 * @param {string[][][]} tables
 */
function extractNarrowLabelTables(tables) {
  const fields = { raw: {} };
  for (const rows of tables) {
    const maxCols = Math.max(0, ...rows.map((r) => r.length));
    if (maxCols > 4) continue;
    for (const row of rows) {
      if (row.length !== 2) continue;
      applyParcelLabel(fields, normalizeHeaderLabel(row[0]), row[1]);
    }
  }
  return fields;
}

/**
 * @param {object} fields
 * @param {string} label
 * @param {string} value
 */
function applyParcelLabel(fields, label, value) {
  if (!label) return;
  for (const [key, aliases] of Object.entries(PARCEL_LABEL_ALIASES)) {
    if (aliases.some((a) => parcelLabelMatches(label, a))) {
      if (key === "insurance") {
        fields.insuranceLabel = value;
        fields.insuranceYes = /^yes$/i.test(value) || value === "是";
      } else {
        fields[key] = value;
      }
      fields.raw[key] = value;
      break;
    }
  }
}

/**
 * @param {string[][][]} tables
 */
function locateItemTable(tables) {
  let best = null;
  let bestScore = 0;

  for (const rows of tables) {
    if (rows.length < 2) continue;
    const headerIdx = findHeaderRowIndex(rows);
    if (headerIdx < 0) continue;
    const headerRow = rows[headerIdx];
    const columnMap = mapHeadersToKeys(headerRow);
    const dataRows = rows
      .slice(headerIdx + 1)
      .filter((r) => isItemDataRow(r, columnMap));
    const score = Object.keys(columnMap).length * 10 + dataRows.length;
    if (
      columnMap.sourceItemName != null &&
      columnMap.quantity != null &&
      score > bestScore
    ) {
      bestScore = score;
      best = { columnMap, dataRows, headerRow };
    }
  }

  return best;
}

/**
 * @param {string[][]} rows
 */
function findHeaderRowIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const map = mapHeadersToKeys(rows[i]);
    if (map.sourceItemName != null && map.quantity != null) return i;
  }
  return -1;
}

/**
 * @param {string[]} headerRow
 */
function mapHeadersToKeys(headerRow) {
  /** @type {Record<string, number>} */
  const columnMap = {};
  headerRow.forEach((cell, idx) => {
    const label = normalizeItemHeader(cell);
    if (!label) return;
    for (const [key, aliases] of Object.entries(ITEM_HEADER_ALIASES)) {
      if (columnMap[key] != null) continue;
      if (aliases.some((a) => itemHeaderMatches(label, a))) {
        columnMap[key] = idx;
        break;
      }
    }
  });
  return columnMap;
}

/**
 * @param {string[]} row
 * @param {Record<string, number>} columnMap
 */
function isItemDataRow(row, columnMap) {
  if (rowIsFooterOrMetadata(row)) return false;

  const nameIdx = columnMap.sourceItemName;
  if (nameIdx == null) return false;
  const name = normalizeText(row[nameIdx]);
  if (!name || /^(合计|总计|total|sum)$/i.test(name)) return false;

  const noIdx = columnMap.exportRowNo;
  if (noIdx != null) {
    const noVal = normalizeText(row[noIdx]);
    if (!/^\d{1,4}$/.test(noVal)) return false;
  }

  const orderIdx = columnMap.baestaoOrderId;
  const sellerIdx = columnMap.sellerName;
  const order = orderIdx != null ? normalizeText(row[orderIdx]) : "";
  const seller = sellerIdx != null ? normalizeText(row[sellerIdx]) : "";
  if (!order && !seller) return false;

  const qtyIdx = columnMap.quantity;
  if (qtyIdx != null) {
    const q = normalizeText(row[qtyIdx]);
    if (!q || !/^\d+$/.test(q.replace(/,/g, ""))) return false;
  }

  return true;
}

function normalizeItemHeader(cell) {
  return normalizeText(cell)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()]/g, "");
}

function normalizeHeaderLabel(cell) {
  return normalizeText(cell).toLowerCase().replace(/\s+/g, "");
}

function itemHeaderMatches(label, alias) {
  const n = normalizeItemHeader(label);
  const a = normalizeItemHeader(alias);
  if (!n || !a) return false;
  if (n === a) return true;
  if (a === "no" && (n === "no" || n === "no.")) return true;
  if (a.length >= 6 && n.includes(a)) return true;
  return false;
}

function parcelLabelMatches(label, alias) {
  const l = normalizeHeaderLabel(label);
  const a = normalizeHeaderLabel(alias);
  if (!l || !a) return false;
  return l === a || l.includes(a);
}
