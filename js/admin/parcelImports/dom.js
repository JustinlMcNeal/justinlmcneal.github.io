/** DOM references for Parcel Imports page. */

const refs = {};

function indexDataFields(root, target) {
  if (!root) return;
  root.querySelectorAll("[data-field]").forEach((el) => {
    const key = el.getAttribute("data-field");
    if (key) target[key] = el;
  });
}

export function initDom() {
  refs.page = document.getElementById("parcelImportsPage");
  refs.uploadCard = document.getElementById("parcelUploadCard");
  refs.dropZone = document.getElementById("parcelUploadDropZone");
  refs.selectFileBtn = document.getElementById("parcelSelectFileBtn");
  refs.fileInput = document.getElementById("parcelFileInput");
  refs.uploadStatus = document.getElementById("parcelUploadStatus");
  refs.mappingTbody = document.getElementById("parcelMappingTbody");
  refs.mappingTable = document.getElementById("parcelMappingTable");
  refs.summaryRoot = document.getElementById("parcelSummaryFields");
  refs.overridesRoot = document.getElementById("parcelImportChargeOverrides");
  refs.chargedWeightRow = document.getElementById("parcelChargedWeightRow");
  refs.chargedWeightHint = document.getElementById("parcelChargedWeightHint");
  refs.chargedWeightMissingNote = document.getElementById("parcelChargedWeightMissingNote");
  refs.statsRoot = document.getElementById("parcelImportStats");
  refs.statsCurrentParseNote = document.getElementById("parcelStatsCurrentParse");
  refs.mappingChipsRoot = document.getElementById("parcelMappingChips");
  refs.mappingRangeText = document.getElementById("parcelMappingRangeText");
  refs.overrideValidationEl = document.getElementById("parcelOverrideValidation");
  refs.cpiRoot = document.getElementById("parcelImportCpiPreview");
  refs.cpiWarningsEl = document.getElementById("parcelCpiWarnings");
  refs.cpiBadgeEl = document.getElementById("parcelCpiBadge");
  refs.saveDraftBtns = document.querySelectorAll('[data-parcel-action="save-draft"]');
  refs.approveCpiBtns = document.querySelectorAll('[data-parcel-action="approve-cpi"]');
  refs.actionStatusEl = document.getElementById("parcelActionStatus");
  refs.duplicateWarningEl = document.getElementById("parcelDuplicateWarning");
  refs.historyTbody = document.getElementById("parcelHistoryTbody");
  refs.historyFootnote = document.getElementById("parcelHistoryFootnote");
  refs.historySearchInput = document.getElementById("parcelHistorySearch");
  refs.historyStatusFilter = document.getElementById("parcelHistoryStatusFilter");
  refs.historySearchBtn = document.getElementById("parcelHistorySearchBtn");
  refs.historyLoadMoreBtn = document.getElementById("parcelHistoryLoadMoreBtn");
  refs.createExpenseBtns = document.querySelectorAll('[data-parcel-action="create-expense"]');
  refs.linkExpenseBtn = document.getElementById("parcelLinkExpenseBtn");
  refs.linkExpenseInput = document.getElementById("parcelLinkExpenseInput");
  refs.expenseStatusEl = document.getElementById("parcelExpenseStatus");
  refs.newImportBtns = document.querySelectorAll('[data-parcel-action="new-import"]');
  refs.receiveInventoryBtn = document.getElementById("parcelReceiveInventoryBtn");
  refs.inventoryReceiveStatusEl = document.getElementById("parcelInventoryReceiveStatus");

  refs.summaryFields = {};
  refs.overrideFields = {};
  refs.statsFields = {};
  refs.mappingChipFields = {};
  refs.cpiFields = {};

  indexDataFields(refs.summaryRoot, refs.summaryFields);
  indexDataFields(refs.overridesRoot, refs.overrideFields);
  indexDataFields(refs.statsRoot, refs.statsFields);
  indexDataFields(refs.mappingChipsRoot, refs.mappingChipFields);
  indexDataFields(refs.cpiRoot, refs.cpiFields);

  return refs;
}

export function getDom() {
  return refs;
}

export function querySummaryField(key) {
  return refs.summaryFields?.[key] ?? null;
}

export function queryOverrideField(key) {
  return refs.overrideFields?.[key] ?? null;
}
