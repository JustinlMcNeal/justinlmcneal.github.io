/**
 * Baestao parcel footer / metadata key-value extraction (English + Chinese).
 */

import { PARCEL_FOOTER_ALIASES } from "../constants.js";
import { normalizeCellText } from "./htmlTableParser.js";
import {
  normalizeCurrencyCny,
  normalizeInteger,
  normalizeText,
  normalizeWeightToGrams,
} from "./normalizers.js";

const KV_IN_CELL =
  /([A-Za-z\u4e00-\u9fff][A-Za-z0-9\u4e00-\u9fff\s/().-]{0,48}?)\s*[:：]\s*([^:;]+?)(?=\s+[A-Za-z\u4e00-\u9fff][^:：]{1,24}\s*[:：]|$)/gi;

/** Rows/cells that are never item lines. */
export const FOOTER_ROW_MARKERS = [
  /item\s*qty/i,
  /parcel\s*id/i,
  /parcel\s*weight/i,
  /shipment\s*fee/i,
  /total\s*item\s*fee/i,
  /with\s*insurance/i,
  /^name\s*[:：]/i,
  /^address\s*[:：]/i,
  /^country\s*[:：]/i,
  /post\s*code/i,
  /邮编/,
  /地址/,
  /姓名/,
  /国家/,
  /包裹编号/,
  /商品件数/,
  /总件数/,
];

/**
 * Scan all table rows/cells for parcel footer metadata.
 * @param {string[][][]} tables
 * @param {string} fullText
 */
export function extractFooterMetadata(tables, fullText) {
  /** @type {Record<string, unknown>} */
  const fields = { raw: {} };

  for (const rows of tables) {
    for (const row of rows) {
      ingestRow(fields, row);
    }
  }

  const idMatch = fullText.match(/\bParcel\s*ID\s*[:：]\s*(\d+)/i);
  if (idMatch) fields.parcelId = idMatch[1];

  return fields;
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string[]} row
 */
function ingestRow(fields, row) {
  const joined = row.map(normalizeCellText).filter(Boolean).join(" | ");
  if (joined) parseKeyValueText(fields, joined);

  for (let i = 0; i < row.length; i++) {
    const cell = normalizeCellText(row[i]);
    if (!cell) continue;
    parseKeyValueText(fields, cell);
    if (i < row.length - 1) {
      const next = normalizeCellText(row[i + 1]);
      if (next && looksLikeLabel(cell)) applyFooterField(fields, cell, next);
    }
  }
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} text
 */
function parseKeyValueText(fields, text) {
  KV_IN_CELL.lastIndex = 0;
  let m;
  while ((m = KV_IN_CELL.exec(text)) !== null) {
    applyFooterField(fields, m[1], m[2]);
  }
}

/**
 * @param {string} label
 */
function looksLikeLabel(label) {
  return /[:：]/.test(label) || label.length < 40;
}

/**
 * @param {Record<string, unknown>} fields
 * @param {string} labelRaw
 * @param {string} valueRaw
 */
function applyFooterField(fields, labelRaw, valueRaw) {
  const label = normalizeFooterLabel(labelRaw);
  const value = normalizeText(valueRaw);
  if (!label || !value) return;

  for (const [key, aliases] of Object.entries(PARCEL_FOOTER_ALIASES)) {
    if (!aliases.some((a) => footerLabelMatches(label, a))) continue;

    fields.raw[key] = value;
    if (key === "insurance") {
      fields.insuranceLabel = value;
      fields.insuranceYes = /^yes$/i.test(value) || value === "是";
      break;
    }
    if (key === "totalItems") {
      fields.totalItems = normalizeQtyPcs(value);
      break;
    }
    if (key === "parcelWeightGrams") {
      fields.parcelWeightGrams = value;
      break;
    }
    if (key === "chargedWeightGrams") {
      fields.chargedWeightGrams = value;
      break;
    }
    if (key === "shipmentFeeCny") {
      fields.shipmentFeeCny = value;
      break;
    }
    if (key === "totalItemFeeCny") {
      fields.totalItemFeeCny = value;
      break;
    }
    if (key === "parcelId") {
      fields.parcelId = value.replace(/\D/g, "") || value;
      break;
    }
    fields[key] = value;
    break;
  }
}

/**
 * @param {string} raw
 */
function normalizeQtyPcs(raw) {
  const pcs = raw.match(/(\d+)\s*pcs/i);
  if (pcs) return parseInt(pcs[1], 10);
  return normalizeInteger(raw);
}

function normalizeFooterLabel(cell) {
  return normalizeText(cell)
    .replace(/[:：]\s*$/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function footerLabelMatches(label, alias) {
  const l = normalizeFooterLabel(label);
  const a = normalizeFooterLabel(alias);
  if (!l || !a) return false;
  return l === a || l.endsWith(a) || l.includes(a);
}

/**
 * @param {string[]} row
 */
export function rowIsFooterOrMetadata(row) {
  const blob = row.map(normalizeCellText).join(" ").toLowerCase();
  if (!blob) return true;
  return FOOTER_ROW_MARKERS.some((re) => re.test(blob));
}
