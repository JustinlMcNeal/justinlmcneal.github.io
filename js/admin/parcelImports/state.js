/** In-memory page state (no localStorage / Supabase). */

import { UPLOAD_STATUS } from "./constants.js";
import {
  applyMappingFieldChange,
  applyProductMappingPatch,
  computeMappingCounts,
  findRowMapping,
  initMappingFromItems,
} from "./mapping/mappingState.js";
import { isOverrideDirty as fieldDiffers } from "./validation/overrideValidators.js";

export function createInitialState() {
  return {
    currentFile: null,
    uploadStatus: UPLOAD_STATUS.IDLE,
    uploadMessage: "",
    parseResult: null,
    parcel: null,
    items: [],
    errors: [],
    warnings: [],
    derived: null,
    xlsBaseline: null,
    overrides: null,
    overrideValidation: null,
    rowMappings: [],
    currentImportId: null,
    saveStatus: "idle",
    saveMessage: "",
    sessionReady: false,
    adminOk: false,
    historyRows: [],
    duplicateWarning: null,
    mappingSuggestions: [],
    importStatus: null,
    approvalStatus: "idle",
    approvalMessage: "",
    expenseId: null,
    expenseLinkStatus: "idle",
    expenseLinkMessage: "",
    linkedExpenseSummary: null,
    inventoryReceivedAt: null,
    inventoryReceiveStatus: "idle",
    inventoryReceiveMessage: "",
  };
}

let state = createInitialState();

export function getState() {
  return state;
}

/** Reset working import UI state; keeps session and history list. */
export function resetWorkingImport() {
  setCurrentFile(null);
  resetParseState();
  state.mappingSuggestions = [];
  state.importStatus = null;
  state.approvalStatus = "idle";
  state.approvalMessage = "";
  state.expenseId = null;
  state.expenseLinkStatus = "idle";
  state.expenseLinkMessage = "";
  state.linkedExpenseSummary = null;
  state.inventoryReceivedAt = null;
  state.inventoryReceiveStatus = "idle";
  state.inventoryReceiveMessage = "";
}

export function resetParseState() {
  state.parseResult = null;
  state.parcel = null;
  state.items = [];
  state.errors = [];
  state.warnings = [];
  state.derived = null;
  state.xlsBaseline = null;
  state.overrides = null;
  state.overrideValidation = null;
  state.rowMappings = [];
  state.currentImportId = null;
  state.saveStatus = "idle";
  state.saveMessage = "";
  state.duplicateWarning = null;
  state.importStatus = null;
  state.approvalStatus = "idle";
  state.approvalMessage = "";
  state.expenseId = null;
  state.expenseLinkStatus = "idle";
  state.expenseLinkMessage = "";
  state.linkedExpenseSummary = null;
  state.inventoryReceivedAt = null;
  state.inventoryReceiveStatus = "idle";
  state.inventoryReceiveMessage = "";
}

export function setCurrentFile(file) {
  state.currentFile = file || null;
}

export function setUploadStatus(status, message = "") {
  state.uploadStatus = status;
  state.uploadMessage = message;
}

/**
 * @param {object} result
 */
export function setParseResult(result) {
  state.parseResult = result;
  state.parcel = result?.parcel ?? null;
  state.items = result?.items ?? [];
  state.errors = result?.errors ?? [];
  state.warnings = result?.warnings ?? [];
  state.derived = computeDerivedCounts(
    state.items,
    state.errors,
    state.warnings,
  );
  if (state.parcel) {
    initOverridesFromParcel(state.parcel);
  } else {
    state.xlsBaseline = null;
    state.overrides = null;
    state.overrideValidation = null;
  }

  state.rowMappings = initMappingFromItems(
    state.items,
    state.errors,
    state.warnings,
  );
  recomputeDerivedFromMapping();
}

/**
 * @param {object | null} parcel
 */
export function buildXlsBaseline(parcel) {
  if (!parcel) return null;
  return {
    parcelWeightGrams: parcel.parcelWeightGrams ?? null,
    chargedWeightGrams: parcel.chargedWeightGrams ?? null,
    shipmentFeeCny: parcel.shipmentFeeCny ?? null,
    serviceFeeCny: parcel.serviceFeeCny ?? null,
    insuranceYes:
      parcel.insuranceYes === true
        ? true
        : parcel.insuranceYes === false
          ? false
          : null,
    insuranceCny: parcel.insuranceCny ?? null,
    totalParcelChargeCny: resolveInitialTotalCharge(parcel),
    effectiveFxRate: parcel.effectiveFxRate ?? null,
    usdEquivalent: parcel.usdEquivalent ?? null,
  };
}

/**
 * @param {object} parcel
 */
function resolveInitialTotalCharge(parcel) {
  if (parcel.totalParcelChargeCny != null) return parcel.totalParcelChargeCny;
  if (parcel.shipmentFeeCny != null) return parcel.shipmentFeeCny;
  return null;
}

/**
 * @param {object} parcel
 */
export function initOverridesFromParcel(parcel) {
  const baseline = buildXlsBaseline(parcel);
  state.xlsBaseline = baseline;
  state.overrides = {
    parcelWeightGrams: baseline?.parcelWeightGrams ?? null,
    chargedWeightGrams: baseline?.chargedWeightGrams ?? null,
    shipmentFeeCny: baseline?.shipmentFeeCny ?? null,
    serviceFeeCny: baseline?.serviceFeeCny ?? null,
    insuranceYes: baseline?.insuranceYes ?? null,
    insuranceCny: baseline?.insuranceCny ?? null,
    totalParcelChargeCny: baseline?.totalParcelChargeCny ?? null,
    effectiveFxRate: baseline?.effectiveFxRate ?? null,
    usdEquivalent: baseline?.usdEquivalent ?? null,
    dirtyFields: {},
  };
  state.overrideValidation = null;
}

/**
 * @param {string} key
 * @param {unknown} value
 */
export function updateOverrideField(key, value) {
  if (!state.overrides) return;
  state.overrides[key] = value;
  recomputeDirtyFields();
}

function recomputeDirtyFields() {
  if (!state.overrides || !state.xlsBaseline) return;
  const dirty = {};
  const o = state.overrides;
  const b = state.xlsBaseline;
  const keys = [
    "parcelWeightGrams",
    "chargedWeightGrams",
    "shipmentFeeCny",
    "serviceFeeCny",
    "insuranceYes",
    "insuranceCny",
    "totalParcelChargeCny",
    "effectiveFxRate",
    "usdEquivalent",
  ];
  keys.forEach((key) => {
    if (fieldDiffers(key, o[key], b[key])) dirty[key] = true;
  });
  state.overrides.dirtyFields = dirty;
}

/**
 * @param {object} validation
 */
export function setOverrideValidation(validation) {
  state.overrideValidation = validation;
}

/**
 * @param {string | null} importId
 */
export function setCurrentImportId(importId) {
  state.currentImportId = importId || null;
}

/**
 * @param {string} status — idle | saving | saved | error
 * @param {string} [message]
 */
export function setSaveStatus(status, message = "") {
  state.saveStatus = status;
  state.saveMessage = message;
}

export function setSessionReady(sessionReady, adminOk = false) {
  state.sessionReady = !!sessionReady;
  state.adminOk = !!adminOk;
}

export function setHistoryRows(rows) {
  state.historyRows = rows ?? [];
}

export function setDuplicateWarning(warning) {
  state.duplicateWarning = warning ?? null;
}

export function setMappingSuggestions(suggestions) {
  state.mappingSuggestions = suggestions ?? [];
}

/** @param {string | null} status */
export function setImportStatus(status) {
  state.importStatus = status || null;
}

/**
 * @param {string} status — idle | approving | approved | error
 * @param {string} [message]
 */
export function setApprovalStatus(status, message = "") {
  state.approvalStatus = status;
  state.approvalMessage = message;
}

/** @param {object} [s] */
export function isImportApproved(s = state) {
  return s.importStatus === "approved";
}

/** @param {object} [s] */
export function isImportEditable(s = state) {
  if (!s.importStatus) return true;
  return !["approved", "voided", "error"].includes(s.importStatus);
}

/** @param {object} [s] */
export function isImportReceived(s = state) {
  return !!s.inventoryReceivedAt;
}

/** @param {string | null} value */
export function setInventoryReceivedAt(value) {
  state.inventoryReceivedAt = value || null;
}

/**
 * @param {string} status — idle | receiving | received | error
 * @param {string} [message]
 */
export function setInventoryReceiveStatus(status, message = "") {
  state.inventoryReceiveStatus = status;
  state.inventoryReceiveMessage = message;
}

/** @param {string | null} expenseId */
export function setExpenseId(expenseId) {
  state.expenseId = expenseId || null;
}

/**
 * @param {string} status — idle | linking | linked | error
 * @param {string} [message]
 */
export function setExpenseLinkStatus(status, message = "") {
  state.expenseLinkStatus = status;
  state.expenseLinkMessage = message;
}

/** @param {object | null} summary */
export function setLinkedExpenseSummary(summary) {
  state.linkedExpenseSummary = summary ?? null;
}

/**
 * @param {number} rowNumber
 * @param {object} patch
 */
export function updateRowProductMapping(rowNumber, patch) {
  const row = findRowMapping(state.rowMappings, rowNumber);
  if (!row) return;
  applyProductMappingPatch(row, patch);
  recomputeDerivedFromMapping();
}

/**
 * Rehydrate working state from a loaded DB draft (Phase 6B).
 * @param {object} bundle
 */
export function applyLoadedDraft(bundle) {
  const {
    importId,
    header,
    parcel,
    items,
    xlsBaseline,
    overrides,
    rowMappings,
    errors = [],
    warnings = [],
  } = bundle;

  state.currentFile = null;
  state.currentImportId = importId;
  state.parseResult = { parcel, items, errors, warnings };
  state.parcel = parcel;
  state.items = items;
  state.errors = errors;
  state.warnings = warnings;
  state.xlsBaseline = xlsBaseline;
  state.overrides = {
    ...overrides,
    dirtyFields: {},
  };
  recomputeDirtyFields();
  state.rowMappings = rowMappings;
  state.overrideValidation = null;
  state.uploadStatus = UPLOAD_STATUS.SUCCESS;
  state.uploadMessage = `Loaded draft ${parcel?.parcelId || importId}`;
  state.importStatus = parcel?.status ?? null;
  state.approvalStatus = state.importStatus === "approved" ? "approved" : "idle";
  state.approvalMessage =
    state.importStatus === "approved" ? "This import is approved — edits disabled." : "";
  state.expenseId = header?.expense_id ?? parcel?.expenseId ?? null;
  state.expenseLinkStatus = state.expenseId ? "linked" : "idle";
  state.expenseLinkMessage = state.expenseId ? "Expense linked." : "";
  state.linkedExpenseSummary = null;
  state.inventoryReceivedAt = header?.inventory_received_at ?? null;
  state.inventoryReceiveStatus = state.inventoryReceivedAt ? "received" : "idle";
  state.inventoryReceiveMessage = state.inventoryReceivedAt
    ? "Inventory received."
    : "";
  recomputeDerivedFromMapping();
}

/**
 * @param {number} rowNumber
 * @param {string} field
 * @param {string} value
 */
export function updateRowMappingField(rowNumber, field, value) {
  const row = findRowMapping(state.rowMappings, rowNumber);
  if (!row) return;
  applyMappingFieldChange(row, field, value);
  recomputeDerivedFromMapping();
}

/**
 * @param {number} rowNumber
 * @param {string} field
 * @param {unknown} value
 */
export function updateItemField(rowNumber, field, value) {
  const item = state.items.find((i) => i.rowNumber === rowNumber);
  if (!item) return;
  item[field] = value;
}

export function recomputeDerivedFromMapping() {
  if (!state.rowMappings.length) {
    state.derived = computeDerivedCounts(
      state.items,
      state.errors,
      state.warnings,
    );
    return;
  }

  const counts = computeMappingCounts(state.rowMappings);
  state.derived = {
    ...counts,
    totalQuantity: state.items.reduce((s, i) => s + (i.quantity || 0), 0),
  };
}

export function computeDerivedCounts(items, errors, warnings) {
  const rowIssueNumbers = new Set();
  [...errors, ...warnings].forEach((i) => {
    if (i.rowNumber != null) rowIssueNumbers.add(i.rowNumber);
  });

  let needsMappingCount = 0;
  let parserWarningCount = 0;

  items.forEach((item) => {
    const hasRowIssue =
      rowIssueNumbers.has(item.rowNumber) ||
      (item.rowIssues && item.rowIssues.length > 0);
    if (hasRowIssue) parserWarningCount++;
    else needsMappingCount++;
  });

  return {
    rowCount: items.length,
    totalQuantity: items.reduce((s, i) => s + (i.quantity || 0), 0),
    needsMappingCount,
    parserWarningCount,
    matchedCount: 0,
    variantUncertainCount: 0,
    personalExcludedCount: 0,
    unmappedRowsKpi: needsMappingCount + parserWarningCount,
  };
}

export function resetState() {
  state = createInitialState();
}

export function initState() {
  state = createInitialState();
}
