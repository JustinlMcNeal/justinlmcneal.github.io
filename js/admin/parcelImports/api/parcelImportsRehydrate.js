/** DB → local state decode helpers (Phase 6B/7). */

import { PLACEHOLDER_PRODUCT, PLACEHOLDER_VARIANT, SOURCE_FORMAT } from "../constants.js";
import { decodeMappingStatus, decodeRowType } from "../mapping/enumCodec.js";

/** @param {*} value */
export function fromDbNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** @param {object} header */
export function headerToParcel(header) {
  const insuranceText = header.xls_insurance_text ?? null;
  let insuranceYes = header.actual_insurance_yes;
  if (insuranceYes == null && insuranceText) {
    insuranceYes = /^yes$/i.test(insuranceText) || insuranceText === "是";
  }

  return {
    parcelId: header.parcel_id ?? null,
    sourceFileName: header.source_file_name ?? null,
    sourceFormat: header.source_format || SOURCE_FORMAT.BAESTAO_HTML_XLS,
    importedAt: header.imported_at
      ? String(header.imported_at).slice(0, 10)
      : null,
    totalItems: header.xls_total_items ?? null,
    parcelWeightGrams: fromDbNumber(header.xls_parcel_weight_grams),
    chargedWeightGrams: fromDbNumber(header.xls_charged_weight_grams),
    totalItemFeeCny: fromDbNumber(header.xls_total_item_fee_cny),
    shipmentFeeCny: fromDbNumber(header.xls_shipment_fee_cny),
    insuranceCny: fromDbNumber(header.xls_insurance_cny),
    insuranceLabel: insuranceText,
    insuranceYes:
      insuranceYes === true ? true : insuranceYes === false ? false : null,
    serviceFeeCny: fromDbNumber(header.xls_service_fee_cny),
    totalParcelChargeCny: fromDbNumber(header.xls_total_parcel_charge_cny),
    effectiveFxRate: fromDbNumber(header.effective_fx_rate),
    usdEquivalent: fromDbNumber(header.usd_equivalent),
    status: header.status ?? null,
    expenseId: header.expense_id ?? null,
    inventoryReceivedAt: header.inventory_received_at ?? null,
    raw: header.raw_footer?.parcelRaw ?? {},
  };
}

/** @param {object} header */
export function headerToXlsBaseline(header) {
  const insuranceText = header.xls_insurance_text ?? null;
  let insuranceYes = null;
  if (insuranceText) {
    insuranceYes = /^yes$/i.test(insuranceText) || insuranceText === "是";
  }

  return {
    parcelWeightGrams: fromDbNumber(header.xls_parcel_weight_grams),
    chargedWeightGrams: fromDbNumber(header.xls_charged_weight_grams),
    shipmentFeeCny: fromDbNumber(header.xls_shipment_fee_cny),
    serviceFeeCny: fromDbNumber(header.xls_service_fee_cny),
    insuranceYes,
    insuranceCny: fromDbNumber(header.xls_insurance_cny),
    totalParcelChargeCny: fromDbNumber(header.xls_total_parcel_charge_cny),
    effectiveFxRate: null,
    usdEquivalent: null,
  };
}

/** @param {object} header */
export function headerToOverrides(header) {
  const insuranceYes = header.actual_insurance_yes;
  return {
    parcelWeightGrams: fromDbNumber(header.actual_parcel_weight_grams),
    chargedWeightGrams: fromDbNumber(header.actual_charged_weight_grams),
    shipmentFeeCny: fromDbNumber(header.actual_shipment_fee_cny),
    serviceFeeCny: fromDbNumber(header.actual_service_fee_cny),
    insuranceYes:
      insuranceYes === true ? true : insuranceYes === false ? false : null,
    insuranceCny: fromDbNumber(header.actual_insurance_cny),
    totalParcelChargeCny: fromDbNumber(header.actual_total_charge_cny),
    effectiveFxRate: fromDbNumber(header.effective_fx_rate),
    usdEquivalent: fromDbNumber(header.usd_equivalent),
    dirtyFields: {},
  };
}

/** @param {object} row */
export function dbItemToLocalItem(row) {
  return {
    rowNumber: row.row_number,
    exportRowNo: row.export_row_no ?? row.row_number,
    sourceItemName: row.source_item_name ?? "",
    sellerName: row.seller_name ?? null,
    baestaoOrderId: row.baestao_order_id ?? null,
    unitPriceCny: fromDbNumber(row.unit_price_cny),
    quantity: row.quantity ?? null,
    itemWeightGrams: fromDbNumber(row.item_weight_grams),
    sellerFreightCny: fromDbNumber(row.seller_freight_cny),
    rowTotalCny: fromDbNumber(row.row_total_cny),
    lineItemSubtotalCny: fromDbNumber(row.line_item_subtotal_cny),
    removePackage: row.remove_package ?? null,
    raw: row.raw ?? {},
    rowIssues: Array.isArray(row.parser_warnings) ? row.parser_warnings : [],
  };
}

/** @param {object} row */
export function dbMappingToLocalMapping(row) {
  const hasProduct =
    row.product_id ||
    (row.mapped_product_label && row.mapped_product_label !== PLACEHOLDER_PRODUCT);

  return {
    rowNumber: row.row_number,
    exportRowNo: row.export_row_no ?? row.row_number,
    rowType: decodeRowType(row.row_type),
    mappingStatus: decodeMappingStatus(row.mapping_status),
    mappedProductLabel: row.mapped_product_label || PLACEHOLDER_PRODUCT,
    mappedVariantLabel: row.mapped_variant_label || PLACEHOLDER_VARIANT,
    productId: row.product_id ?? null,
    productVariantId: row.product_variant_id ?? null,
    mappingSource: row.mapping_source ?? (hasProduct ? "manual" : "imported_placeholder"),
    notes: row.notes ?? "",
    hasParserIssue: row.mapping_status === "parser_warning",
  };
}
