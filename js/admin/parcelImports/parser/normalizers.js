/** Pure normalizers for Baestao parcel + item fields. */

import { SOURCE_FORMAT } from "../constants.js";

/**
 * @param {string | null | undefined} raw
 */
export function normalizeText(raw) {
  if (raw == null) return "";
  return String(raw).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * @param {string | number | null | undefined} raw
 */
export function normalizeInteger(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).replace(/,/g, "").replace(/[^\d.-]/g, "");
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string | number | null | undefined} raw
 */
export function normalizeCurrencyCny(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw)
    .replace(/¥|￥|CNY|RMB/gi, "")
    .replace(/,/g, "")
    .trim();
  if (!s || s === "—" || s === "-") return null;
  const n = parseFloat(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string | number | null | undefined} raw
 */
export function normalizeWeightToGrams(raw) {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim().toLowerCase();
  if (!text || text === "—" || text === "-") return null;

  const kgMatch = text.match(/([\d.,]+)\s*kg/);
  if (kgMatch) {
    const kg = parseFloat(kgMatch[1].replace(/,/g, ""));
    return Number.isFinite(kg) ? Math.round(kg * 1000) : null;
  }

  const gMatch = text.match(/([\d.,]+)\s*g(?:\b|$)/i);
  if (gMatch) {
    const g = parseFloat(gMatch[1].replace(/,/g, ""));
    return Number.isFinite(g) ? Math.round(g) : null;
  }

  const num = parseFloat(text.replace(/,/g, "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(num)) return null;
  if (text.includes("kg")) return Math.round(num * 1000);
  if (num >= 50 && !text.includes("g")) return Math.round(num);
  if (num < 50 && !text.includes("g")) return Math.round(num * 1000);
  return Math.round(num);
}

/**
 * @param {Record<string, unknown>} fields
 * @param {{ name?: string }} [fileMeta]
 */
export function normalizeParcel(fields, fileMeta = {}) {
  const now = new Date().toISOString().slice(0, 10);
  const insuranceLabel = fields.insuranceLabel
    ? normalizeText(String(fields.insuranceLabel))
    : null;
  const insuranceYes =
    fields.insuranceYes === true ||
    (insuranceLabel && /^yes$/i.test(insuranceLabel)) ||
    insuranceLabel === "是";

  return {
    parcelId: fields.parcelId ? normalizeText(String(fields.parcelId)) : null,
    sourceFileName: fileMeta.name ? normalizeText(fileMeta.name) : null,
    sourceFormat: SOURCE_FORMAT.BAESTAO_HTML_XLS,
    importedAt: fields.importedAt || now,
    totalItems: normalizeInteger(fields.totalItems),
    parcelWeightGrams: normalizeWeightToGrams(
      fields.parcelWeightGrams ?? fields.parcelWeight,
    ),
    chargedWeightGrams: normalizeWeightToGrams(
      fields.chargedWeightGrams ?? fields.chargedWeight,
    ),
    totalItemFeeCny: normalizeCurrencyCny(fields.totalItemFeeCny),
    shipmentFeeCny: normalizeCurrencyCny(fields.shipmentFeeCny),
    insuranceCny: normalizeCurrencyCny(fields.insuranceCny),
    insuranceLabel: insuranceYes ? "Yes" : insuranceLabel,
    insuranceYes,
    serviceFeeCny: normalizeCurrencyCny(fields.serviceFeeCny),
    totalParcelChargeCny: normalizeCurrencyCny(fields.totalParcelChargeCny),
    effectiveFxRate:
      fields.effectiveFxRate != null
        ? parseFloat(String(fields.effectiveFxRate)) || null
        : null,
    usdEquivalent: normalizeCurrencyCny(fields.usdEquivalent),
    warnings: [],
    raw: fields.raw || {},
  };
}

/**
 * @param {string[]} row
 * @param {Record<string, number>} columnMap
 * @param {number} rowNumber
 */
export function normalizeItemRow(row, columnMap, rowNumber) {
  const get = (key) => {
    const idx = columnMap[key];
    if (idx == null || idx < 0) return null;
    return row[idx] ?? null;
  };

  const sourceItemName = normalizeText(get("sourceItemName"));
  const raw = {};
  Object.entries(columnMap).forEach(([key, idx]) => {
    raw[key] = row[idx] ?? "";
  });

  const rowTotalRaw = get("rowTotalCny");
  const sellerFreightRaw = get("sellerFreightCny");

  return {
    rowNumber,
    exportRowNo: normalizeInteger(get("exportRowNo")),
    sourceItemName,
    sellerName: normalizeText(get("sellerName")) || null,
    baestaoOrderId: normalizeText(get("baestaoOrderId")) || null,
    unitPriceCny: normalizeCurrencyCny(get("unitPriceCny")),
    quantity: normalizeInteger(get("quantity")),
    itemWeightGrams: normalizeWeightToGrams(get("itemWeightGrams")),
    sellerFreightCny: normalizeCurrencyCny(sellerFreightRaw),
    rowTotalCny: normalizeCurrencyCny(rowTotalRaw),
    lineItemSubtotalCny:
      normalizeCurrencyCny(get("lineItemSubtotalCny")) ??
      (normalizeCurrencyCny(get("unitPriceCny")) != null &&
      normalizeInteger(get("quantity")) != null
        ? normalizeCurrencyCny(get("unitPriceCny")) *
          normalizeInteger(get("quantity"))
        : null),
    lineTotalCny:
      normalizeCurrencyCny(rowTotalRaw) ??
      normalizeCurrencyCny(get("lineItemSubtotalCny")),
    removePackage: normalizeText(get("removePackage")) || null,
    raw,
    rowIssues: [],
  };
}

export function formatCny(amount) {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return `¥${amount.toFixed(2)}`;
}

export function formatGrams(grams) {
  if (grams == null || !Number.isFinite(grams)) return "—";
  return `${grams.toLocaleString("en-US")} g`;
}

export function formatPcs(qty) {
  if (qty == null || !Number.isFinite(qty)) return "—";
  return `${qty.toLocaleString("en-US")} pcs`;
}

export function truncateText(text, maxLen) {
  const t = normalizeText(text);
  if (!t) return "—";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}
