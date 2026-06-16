/** History + allocation CSV export (Phase 13). */

import { buildCpiPreview } from "../cpi/cpiPreview.js";
import {
  fetchParcelImportAllocationsForExport,
  listParcelImports,
} from "../api/parcelImportsApi.js";
import { getDom } from "../dom.js";
import { getState } from "../state.js";
import { buildCsv, csvDateStamp, downloadCsv } from "../utils/csvExport.js";
import { getHistoryQuery } from "./historyTable.js";
import { getActiveTabId } from "./tabs.js";

const HISTORY_HEADERS = [
  "import_id",
  "parcel_id",
  "status",
  "imported_at",
  "source_file_name",
  "xls_total_items",
  "actual_total_charge_cny",
  "effective_fx_rate",
  "usd_equivalent",
  "products_affected_count",
  "rows_needing_mapping_count",
  "expense_linked",
  "inventory_received",
  "approved_at",
  "inventory_received_at",
];

const HISTORY_KEYS = [...HISTORY_HEADERS];

const ALLOCATION_HEADERS = [
  "parcel_id",
  "row_number",
  "item_name",
  "seller",
  "qty",
  "row_type",
  "mapping_status",
  "product_label",
  "variant_label",
  "product_id",
  "product_variant_id",
  "landed_total_cny",
  "landed_cpi_cny",
  "landed_cpi_usd",
  "included_in_final_cpi",
];

const ALLOCATION_KEYS = [...ALLOCATION_HEADERS];

/** @param {{ refreshHistory?: () => Promise<void> }} [_opts] */
export function initExportActions(_opts = {}) {
  const { historyExportBtn, exportAllocationsBtns } = getDom();

  historyExportBtn?.addEventListener("click", () => {
    void handleExportHistory().catch((err) => {
      console.error("[parcelImports] export history failed", err);
      alert(err?.message || "Export failed");
    });
  });

  exportAllocationsBtns?.forEach((btn) => {
    btn.addEventListener("click", () => {
      void handleExportAllocations().catch((err) => {
        console.error("[parcelImports] export allocations failed", err);
        alert(err?.message || "Export failed");
      });
    });
  });

  updateWorkflowChrome();
}

export function updateWorkflowChrome() {
  updateExportButtons();
  updateActionBarVisibility();
}

export function updateExportButtons() {
  const state = getState();
  const { exportAllocationsBtns, importDetailsBtn } = getDom();
  const hasImport = !!state.currentImportId && !!state.items?.length;

  exportAllocationsBtns?.forEach((btn) => {
    btn.disabled = !hasImport;
    btn.title = hasImport
      ? "Export current import allocation rows to CSV"
      : "Open or create an import first";
  });

  if (importDetailsBtn) {
    importDetailsBtn.disabled = !state.currentImportId;
    importDetailsBtn.title = state.currentImportId
      ? "View details and timeline for the opened import"
      : "Open an import to view details";
  }
}

export function updateActionBarVisibility() {
  const state = getState();
  const { actionBar } = getDom();
  if (!actionBar) return;

  const hasWork = !!state.items?.length;
  const onHistory = getActiveTabId() === "parcelTabHistory";
  const show = hasWork && !onHistory;
  actionBar.classList.toggle("hidden", !show);
  actionBar.hidden = !show;
}

export async function handleExportHistory() {
  const state = getState();
  if (!state.sessionReady || !state.adminOk) {
    throw new Error("Admin session required to export history.");
  }

  const query = getHistoryQuery();
  let rows = await listParcelImports({
    limit: 500,
    status: query.status || undefined,
    search: query.search || undefined,
    received: query.received || undefined,
    expense: query.expense || undefined,
  });

  if (!rows.length) {
    rows = state.historyRows ?? [];
  }

  const csvRows = rows.map(historyRowToCsv);
  const csv = buildCsv(HISTORY_HEADERS, csvRows, HISTORY_KEYS);
  downloadCsv(`parcel-imports-history-${csvDateStamp()}.csv`, csv);
  return { rowCount: csvRows.length };
}

export async function handleExportAllocations() {
  const state = getState();
  if (!state.currentImportId) {
    throw new Error("Open an import before exporting allocations.");
  }
  if (!state.items?.length) {
    throw new Error("No items loaded for export.");
  }

  const rows = await buildAllocationExportRows(state);
  const csv = buildCsv(ALLOCATION_HEADERS, rows, ALLOCATION_KEYS);
  const parcelId = state.parcel?.parcelId || state.currentImportId;
  downloadCsv(`parcel-import-${parcelId}-allocations-${csvDateStamp()}.csv`, csv);
  return { rowCount: rows.length, parcelId };
}

/** @param {object} row */
function historyRowToCsv(row) {
  return {
    import_id: row.id,
    parcel_id: row.parcel_id ?? "",
    status: row.status ?? "",
    imported_at: formatIsoDate(row.imported_at),
    source_file_name: row.source_file_name ?? "",
    xls_total_items: row.xls_total_items ?? "",
    actual_total_charge_cny: row.actual_total_charge_cny ?? "",
    effective_fx_rate: row.effective_fx_rate ?? "",
    usd_equivalent: row.usd_equivalent ?? "",
    products_affected_count: row.products_affected_count ?? "",
    rows_needing_mapping_count: row.rows_needing_mapping_count ?? "",
    expense_linked: row.expense_id ? "yes" : "no",
    inventory_received: row.inventory_received_at ? "yes" : "no",
    approved_at: formatIsoDate(row.approved_at),
    inventory_received_at: formatIsoDate(row.inventory_received_at),
  };
}

/** @param {object} state */
async function buildAllocationExportRows(state) {
  if (state.importStatus === "approved") {
    try {
      const dbRows = await fetchParcelImportAllocationsForExport(
        state.currentImportId,
      );
      if (dbRows.length) return dbRows;
    } catch (err) {
      console.warn("[parcelImports] allocation DB export fallback", err);
    }
  }

  const mappingByRow = new Map(state.rowMappings.map((m) => [m.rowNumber, m]));
  const preview = buildCpiPreview({
    parcel: state.parcel,
    items: state.items,
    overrides: state.overrides,
    rowMappings: state.rowMappings,
  });
  const previewByRow = new Map(preview.rows.map((r) => [r.rowNumber, r]));

  return state.items.map((item) => {
    const mapping = mappingByRow.get(item.rowNumber) ?? {};
    const alloc = previewByRow.get(item.rowNumber) ?? {};
    return {
      parcel_id: state.parcel?.parcelId ?? "",
      row_number: item.rowNumber,
      item_name: item.sourceItemName ?? "",
      seller: item.sellerName ?? "",
      qty: item.quantity ?? "",
      row_type: mapping.rowType ?? "",
      mapping_status: mapping.mappingStatus ?? "",
      product_label: mapping.mappedProductLabel ?? "",
      variant_label: mapping.mappedVariantLabel ?? "",
      product_id: mapping.productId ?? "",
      product_variant_id: mapping.productVariantId ?? "",
      landed_total_cny: alloc.landedTotalCny ?? "",
      landed_cpi_cny: alloc.landedCpiCny ?? "",
      landed_cpi_usd: alloc.landedCpiUsd ?? "",
      included_in_final_cpi: alloc.includedInProductCpiPreview ? "yes" : "no",
    };
  });
}

/** @param {string | null | undefined} value */
function formatIsoDate(value) {
  if (!value) return "";
  return String(value).replace("T", " ").slice(0, 19);
}
