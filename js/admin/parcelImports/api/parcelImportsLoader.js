/** Load draft from Supabase and rehydrate local state (Phase 6B/7). */

import {
  createRowMapping,
  deriveMappingStatus,
} from "../mapping/mappingState.js";
import {
  dbItemToLocalItem,
  dbMappingToLocalMapping,
  headerToOverrides,
  headerToParcel,
  headerToXlsBaseline,
} from "./parcelImportsRehydrate.js";
import {
  fetchParcelImportHeader,
  fetchParcelImportItems,
  fetchParcelImportMappings,
} from "./parcelImportsApi.js";

/** @param {string} importId */
export async function loadParcelImport(importId) {
  const [header, dbItems, dbMappings] = await Promise.all([
    fetchParcelImportHeader(importId),
    fetchParcelImportItems(importId),
    fetchParcelImportMappings(importId),
  ]);

  return buildDraftBundle(header, dbItems, dbMappings);
}

/** @param {object} header @param {object[]} dbItems @param {object[]} dbMappings */
export function buildDraftBundle(header, dbItems, dbMappings) {
  const itemById = new Map(dbItems.map((row) => [row.id, row]));
  const parcel = headerToParcel(header);
  const xlsBaseline = headerToXlsBaseline(header);
  const overrides = headerToOverrides(header);
  const items = dbItems.map(dbItemToLocalItem);

  const mappingByRow = new Map();
  for (const mapping of dbMappings) {
    const item = itemById.get(mapping.parcel_import_item_id);
    if (!item) continue;
    mappingByRow.set(
      item.row_number,
      dbMappingToLocalMapping({
        ...mapping,
        row_number: item.row_number,
        export_row_no: item.export_row_no,
      }),
    );
  }

  const rowMappings = items.map((item) => {
    const existing = mappingByRow.get(item.rowNumber);
    if (existing) return existing;

    const hasParserIssue =
      (item.rowIssues && item.rowIssues.length > 0) || mappingByRow.size === 0;
    const row = createRowMapping(item, hasParserIssue);
    row.mappingStatus = deriveMappingStatus(row);
    return row;
  });

  const rawFooter = header.raw_footer ?? {};
  const warningsBlock = rawFooter.warnings ?? {};

  return {
    importId: header.id,
    header,
    parcel,
    items,
    xlsBaseline,
    overrides,
    rowMappings,
    errors: warningsBlock.parseErrors ?? [],
    warnings: warningsBlock.parseWarnings ?? [],
  };
}
