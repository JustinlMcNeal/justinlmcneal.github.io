/** KPI row — current file stats when open; blank when idle (Phase 12). */

import { getDom } from "../dom.js";
import { getState } from "../state.js";

const KPI_KEYS = [
  "kpiTotalImports",
  "kpiDraftImports",
  "kpiAwaitingApproval",
  "kpiApproved",
  "kpiUnmappedRows",
];

/** Reset top KPI cards to empty idle state. */
export function clearStatsDisplay() {
  const { statsFields, statsCurrentParseNote } = getDom();
  if (!statsFields) return;

  KPI_KEYS.forEach((key) => setKpiValue(key, "—"));
  if (statsFields.kpiUnmappedHint) {
    statsFields.kpiUnmappedHint.textContent = "";
  }
  if (statsCurrentParseNote) {
    statsCurrentParseNote.hidden = true;
    statsCurrentParseNote.textContent = "";
  }
}

/**
 * @param {object | null} derived
 */
export function renderStatsFromParse(derived) {
  const { statsFields, statsCurrentParseNote } = getDom();
  if (!derived || !statsFields) return;

  setKpiValue("kpiTotalImports", derived.rowCount);
  setKpiValue("kpiDraftImports", derived.needsMappingCount);
  setKpiValue("kpiAwaitingApproval", derived.variantUncertainCount);
  setKpiValue("kpiApproved", derived.matchedCount);
  setKpiValue("kpiUnmappedRows", derived.unmappedRowsKpi);

  if (statsFields.kpiUnmappedHint) {
    statsFields.kpiUnmappedHint.textContent = "Current file";
  }

  if (statsCurrentParseNote) {
    statsCurrentParseNote.hidden = false;
    statsCurrentParseNote.textContent =
      "Counts reflect the open file or draft. Upload a new file to start fresh.";
  }
}

export async function refreshGlobalKpis() {
  const state = getState();
  if (!state.items?.length) {
    clearStatsDisplay();
    return;
  }

  if (state.derived) {
    renderStatsFromParse(state.derived);
  }
}

/**
 * @param {string} key
 * @param {number} value
 */
function setKpiValue(key, value) {
  const { statsFields } = getDom();
  const el = statsFields?.[key];
  if (!el) return;
  el.textContent = String(value);
}
