/** Parse validation — structured errors and warnings (Phase 1B). */

import { REQUIRED_ITEM_COLUMNS } from "../constants.js";
import { normalizeCurrencyCny } from "./normalizers.js";

/**
 * @param {string} code
 * @param {string} level
 * @param {string} message
 * @param {object} [extra]
 */
export function issue(code, level, message, extra = {}) {
  return { code, level, message, ...extra };
}

/**
 * @param {object | null} parcel
 * @param {object[]} items
 * @param {object} [opts]
 */
export function validateParseResult(parcel, items, opts = {}) {
  const errors = [];
  let warnings = [...(opts.preErrors || [])];

  if (opts.unsupportedFormat) {
    errors.push(
      issue(
        "UNSUPPORTED_FORMAT",
        "error",
        opts.unsupportedMessage ||
          "This file does not look like a Baestao HTML-table export. Binary Excel parsing is not supported yet.",
      ),
    );
    return { errors, warnings: aggregateWarnings(warnings) };
  }

  if (opts.emptyFile) {
    errors.push(issue("EMPTY_FILE", "error", "The selected file is empty."));
    return { errors, warnings: aggregateWarnings(warnings) };
  }

  if (opts.noTables) {
    errors.push(issue("NO_TABLES", "error", "No HTML tables were found in this file."));
    return { errors, warnings: aggregateWarnings(warnings) };
  }

  if (opts.missingItemTable) {
    errors.push(
      issue(
        "MISSING_REQUIRED_COLUMN",
        "error",
        "Could not find an item table with required columns (Item Name and Qty).",
      ),
    );
  }

  if (!items.length && !opts.missingItemTable) {
    warnings.push(issue("NO_TABLES", "warning", "No item rows were parsed from the file."));
  }

  if (parcel && !parcel.parcelId) {
    warnings.push(
      issue("MISSING_PARCEL_ID", "warning", "Parcel ID was not found in the export."),
    );
  }

  const seen = new Map();
  let lineSubtotalSum = 0;
  let partialNumeric = 0;
  let missingSellerFreight = 0;
  let emptySeller = 0;

  items.forEach((item) => {
    if (!item.sourceItemName) {
      partialNumeric++;
    }

    if (item.quantity == null) {
      item.rowIssues?.push("INVALID_QUANTITY");
      partialNumeric++;
    } else if (item.quantity <= 0) {
      errors.push(
        issue("INVALID_QUANTITY", "error", "Quantity must be a positive integer.", {
          rowNumber: item.rowNumber,
        }),
      );
    }

    if (item.itemWeightGrams == null) partialNumeric++;
    if (item.unitPriceCny == null) partialNumeric++;
    if (!item.sellerName) emptySeller++;

    const freightKnown =
      item.sellerFreightCny != null ||
      (item.raw?.sellerFreightCny != null &&
        normalizeCurrencyCny(item.raw.sellerFreightCny) != null);
    const totalBlank =
      !item.rowTotalCny &&
      (!item.raw?.rowTotalCny || !String(item.raw.rowTotalCny).trim());
    if (!freightKnown && totalBlank) missingSellerFreight++;

    const dupKey = `${item.baestaoOrderId || ""}|${item.sourceItemName}|${item.quantity}`;
    if (item.sourceItemName && seen.has(dupKey)) {
      warnings.push(
        issue("DUPLICATE_ROW", "warning", "Possible duplicate row.", {
          rowNumber: item.rowNumber,
        }),
      );
    } else if (item.sourceItemName) {
      seen.set(dupKey, item.rowNumber);
    }

    if (item.unitPriceCny != null && item.quantity != null) {
      lineSubtotalSum += item.unitPriceCny * item.quantity;
    } else if (item.lineTotalCny != null) {
      lineSubtotalSum += item.lineTotalCny;
    }
  });

  if (partialNumeric > 0) {
    warnings.push(
      issue(
        "PARTIAL_NUMERIC",
        "warning",
        `${partialNumeric} row(s) have incomplete numeric fields.`,
      ),
    );
  }

  if (emptySeller > 0) {
    warnings.push(
      issue(
        "EMPTY_SELLER",
        "warning",
        `Seller name missing on ${emptySeller} row(s).`,
      ),
    );
  }

  if (missingSellerFreight > 0) {
    warnings.push(
      issue(
        "SELLER_FREIGHT_UNKNOWN",
        "warning",
        `Seller freight missing on ${missingSellerFreight} row(s); treated as ¥0.00 for parser preview.`,
      ),
    );
  }

  if (
    parcel?.totalItemFeeCny != null &&
    lineSubtotalSum > 0 &&
    Math.abs(parcel.totalItemFeeCny - lineSubtotalSum) > Math.max(1, parcel.totalItemFeeCny * 0.02)
  ) {
    warnings.push(
      issue(
        "PARCEL_TOTAL_MISMATCH",
        "warning",
        `Line subtotal sum (≈¥${lineSubtotalSum.toFixed(2)}) differs from Total item fee (¥${parcel.totalItemFeeCny.toFixed(2)}); seller freight or extra charges may be included.`,
      ),
    );
  }

  if (
    parcel?.parcelWeightGrams != null &&
    parcel?.chargedWeightGrams != null &&
    parcel.chargedWeightGrams < parcel.parcelWeightGrams
  ) {
    warnings.push(
      issue(
        "CHARGED_WEIGHT_LOW",
        "warning",
        "Charged weight is lower than parcel weight — verify volume weight.",
      ),
    );
  }

  if (parcel?.totalItems != null && items.length) {
    const qtySum = items.reduce((s, i) => s + (i.quantity || 0), 0);
    if (qtySum > 0 && parcel.totalItems !== qtySum) {
      warnings.push(
        issue(
          "ITEM_COUNT_MISMATCH",
          "warning",
          `Footer Item Qty (${parcel.totalItems} pcs) does not match sum of row quantities (${qtySum} pcs).`,
        ),
      );
    }
  }

  if (opts.columnMap) {
    for (const key of REQUIRED_ITEM_COLUMNS) {
      if (opts.columnMap[key] == null) {
        errors.push(
          issue(
            "MISSING_REQUIRED_COLUMN",
            "error",
            `Required column not mapped: ${key}`,
          ),
        );
      }
    }
  }

  return { errors, warnings: aggregateWarnings(warnings) };
}

/**
 * Dedupe and collapse repetitive warnings for upload UI.
 * @param {object[]} warnings
 */
export function aggregateWarnings(warnings) {
  const byCode = new Map();
  const order = [];

  for (const w of warnings) {
    const code = w.code || "UNKNOWN";
    if (!byCode.has(code)) {
      byCode.set(code, w);
      order.push(code);
      continue;
    }
    const existing = byCode.get(code);
    if (code === "DUPLICATE_ROW" || code === "INVALID_WEIGHT") {
      continue;
    }
    byCode.set(code, existing);
  }

  return order.map((c) => byCode.get(c));
}
