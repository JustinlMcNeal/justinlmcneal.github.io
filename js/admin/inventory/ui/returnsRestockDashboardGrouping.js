/**
 * Group dashboard worklist rows by reservation/order (Phase 10V).
 */

import { esc } from "../utils/formatters.js";
import { ROW_TYPE_LABELS } from "../api/returnsRestockDashboardApi.js";

/** @typedef {ReturnType<import('../api/returnsRestockDashboardApi.js').mapWorklistRow>} WorklistRow */

/** @typedef {{
 *   groupKey: string;
 *   reservationId: string|null;
 *   sourceOrderId: string|null;
 *   sourceOrderItemId: string|null;
 *   componentSku: string|null;
 *   componentTitle: string|null;
 *   parentBundleTitle: string|null;
 *   sourceChannel: string|null;
 *   rows: WorklistRow[];
 *   rowTypes: string[];
 *   minPriority: number;
 *   hasStale: boolean;
 * }} WorklistGroup */

const TYPE_CHIP_CLS = {
  return_workflow: "border-violet-500 bg-violet-50 text-violet-900",
  restock_assist: "border-emerald-600 bg-emerald-50 text-emerald-900",
  channel_followup: "border-indigo-500 bg-indigo-50 text-indigo-900",
  audit: "border-slate-500 bg-slate-50 text-slate-900",
  manual_review: "border-amber-600 bg-amber-50 text-amber-900",
};

/** @param {WorklistRow} row */
function groupKeyForRow(row) {
  if (row.reservationId) return `res:${row.reservationId}`;
  if (row.sourceOrderId) return `ord:${row.sourceOrderId}:${row.sourceOrderItemId || ""}`;
  return `row:${row.rowId}`;
}

/** @param {WorklistRow[]} rows */
export function groupWorklistRows(rows) {
  /** @type {Map<string, WorklistGroup>} */
  const map = new Map();

  for (const row of rows) {
    const key = groupKeyForRow(row);
    let g = map.get(key);
    if (!g) {
      g = {
        groupKey: key,
        reservationId: row.reservationId,
        sourceOrderId: row.sourceOrderId,
        sourceOrderItemId: row.sourceOrderItemId,
        componentSku: row.componentSku,
        componentTitle: row.componentTitle,
        parentBundleTitle: row.parentBundleTitle,
        sourceChannel: row.sourceChannel,
        rows: [],
        rowTypes: [],
        minPriority: row.priority,
        hasStale: false,
      };
      map.set(key, g);
    }
    g.rows.push(row);
    if (!g.rowTypes.includes(row.rowType)) g.rowTypes.push(row.rowType);
    g.minPriority = Math.min(g.minPriority, row.priority);
    if (row.isObservationStale) g.hasStale = true;
  }

  return [...map.values()].sort((a, b) => a.minPriority - b.minPriority || a.groupKey.localeCompare(b.groupKey));
}

/** @param {string} rowType */
function typeChip(rowType) {
  const cls = TYPE_CHIP_CLS[rowType] || "border-gray-400 bg-gray-50 text-gray-800";
  const label = ROW_TYPE_LABELS[rowType] || rowType;
  return `<span class="text-[8px] font-black uppercase border px-1 py-0.5 rounded ${cls}">${esc(label)}</span>`;
}

/**
 * @param {WorklistRow} row
 * @param {number} idx flat index for action wiring
 * @param {string|null} highlightRowId
 */
export function renderFlatRowHtml(row, idx, highlightRowId) {
  const typeLabel = ROW_TYPE_LABELS[row.rowType] || row.rowType;
  const stale = row.isObservationStale
    ? `<span class="text-[8px] font-black uppercase border border-amber-600 bg-amber-100 text-amber-900 px-1 py-0.5 rounded ml-1">Stale</span>`
    : "";
  const hi =
    highlightRowId && row.rowId === highlightRowId
      ? " ring-2 ring-amber-400 bg-amber-50"
      : "";

  return `
    <div class="border-b border-gray-100 p-3 text-[11px] space-y-1${hi}" data-rrd-row-id="${esc(row.rowId)}" data-rrd-flat-idx="${idx}">
      ${renderRowInner(row, typeLabel, stale)}
      ${renderRowActions(row, idx)}
    </div>`;
}

/**
 * @param {WorklistGroup} group
 * @param {number[]} flatIndices maps group row index -> flat filtered index
 * @param {string|null} highlightRowId
 */
export function renderGroupHtml(group, flatIndices, highlightRowId) {
  const multi = group.rows.length > 1;
  const headerHi = group.rows.some((r) => r.rowId === highlightRowId)
    ? " ring-2 ring-amber-400 bg-amber-50"
    : "";

  const chips = group.rowTypes.map(typeChip).join(" ");
  const stale = group.hasStale
    ? `<span class="text-[8px] font-black uppercase border border-amber-600 bg-amber-100 text-amber-900 px-1 py-0.5 rounded">Stale</span>`
    : "";

  const body = group.rows
    .map((row, i) => {
      const idx = flatIndices[i];
      const typeLabel = ROW_TYPE_LABELS[row.rowType] || row.rowType;
      const hi =
        highlightRowId && row.rowId === highlightRowId
          ? " ring-2 ring-amber-300 bg-amber-50/60"
          : "";
      return `
        <div class="border-t border-gray-100 pt-2 mt-2 text-[11px] space-y-1${hi}" data-rrd-row-id="${esc(row.rowId)}">
          <div class="flex flex-wrap justify-between gap-1">
            <span class="text-[9px] font-black uppercase text-indigo-800">${esc(typeLabel)} · P${row.priority}</span>
            <span class="text-[9px] text-gray-500">${esc(row.status || "—")}</span>
          </div>
          <p class="text-[10px] text-gray-600">${esc(row.reason || "—")}</p>
          <p class="text-[10px] text-teal-900">${esc(row.recommendedAction || "—")}</p>
          ${renderRowActions(row, idx)}
        </div>`;
    })
    .join("");

  return `
    <div class="border-b border-gray-200 p-3${headerHi}" data-rrd-group="${esc(group.groupKey)}">
      <div class="flex flex-wrap justify-between gap-1">
        <span class="font-bold text-[11px]">${esc(group.parentBundleTitle || "—")} → ${esc(group.componentTitle || group.componentSku || "—")}</span>
        <span class="text-[9px] font-black uppercase text-gray-600">${group.rows.length} related</span>
      </div>
      <p class="text-gray-500 font-mono text-[10px]">${esc(group.componentSku || "—")} · ${esc(group.sourceChannel || "—")}${stale}</p>
      <div class="flex flex-wrap gap-1 py-1">${chips}</div>
      ${multi ? `<div class="mt-1 space-y-0">${body}</div>` : body}
    </div>`;
}

/** @param {WorklistRow} row @param {string} typeLabel @param {string} stale */
function renderRowInner(row, typeLabel, stale) {
  return `
      <div class="flex flex-wrap justify-between gap-1">
        <span class="font-bold">${esc(row.parentBundleTitle || "—")} → ${esc(row.componentTitle || row.componentSku || "—")}</span>
        <span class="text-[9px] font-black uppercase text-indigo-800">${esc(typeLabel)} · P${row.priority}</span>
      </div>
      <p class="text-gray-500 font-mono text-[10px]">${esc(row.componentSku || "—")} · ${esc(row.sourceChannel || "—")}${stale}</p>
      <p class="text-[10px] text-gray-600">${esc(row.status || "—")} — ${esc(row.reason || "—")}</p>
      <p class="text-[10px] text-teal-900">${esc(row.recommendedAction || "—")}</p>`;
}

/** @param {WorklistRow} row @param {number} idx */
function renderRowActions(row, idx) {
  return `
      <div class="flex flex-wrap gap-2 pt-1">
        ${row.sourceOrderId ? `<button type="button" data-rrd-order="${idx}" class="text-[9px] font-black uppercase text-teal-800 hover:underline">Order Line</button>` : ""}
        ${row.parentBundleVariantId ? `<button type="button" data-rrd-bundle="${idx}" class="text-[9px] font-black uppercase text-violet-800 hover:underline">Bundle Return/Restock</button>` : ""}
        ${row.rowType === "restock_assist" || row.rowType === "manual_review" ? `<button type="button" data-rrd-queue="${idx}" class="text-[9px] font-black uppercase text-emerald-800 hover:underline">Restock Assist Queue</button>` : ""}
        ${row.rowType === "channel_followup" || row.restockActionId ? `<button type="button" data-rrd-followup="${idx}" class="text-[9px] font-black uppercase text-indigo-800 hover:underline">Follow-Up Checklist</button>` : ""}
        ${row.componentVariantId ? `<button type="button" data-rrd-sync="${idx}" class="text-[9px] font-black uppercase text-sky-800 hover:underline">Sync Preview</button>` : ""}
        ${row.rowType === "restock_assist" ? `<button type="button" data-rrd-reviewed="${idx}" class="text-[9px] font-black uppercase text-gray-700 hover:underline">Mark Reviewed</button>` : ""}
        ${row.rowType === "restock_assist" ? `<button type="button" data-rrd-snooze="${idx}" class="text-[9px] font-black uppercase text-indigo-700 hover:underline">Snooze</button>` : ""}
      </div>`;
}

/**
 * @param {WorklistRow[]} filtered
 * @param {boolean} grouped
 * @param {string|null} highlightRowId
 */
export function renderWorklistHtml(filtered, grouped, highlightRowId) {
  if (!filtered.length) {
    return `<p class="p-4 text-sm text-gray-500">No rows match filters.</p>`;
  }
  if (!grouped) {
    return filtered.map((row, idx) => renderFlatRowHtml(row, idx, highlightRowId)).join("");
  }

  const groups = groupWorklistRows(filtered);
  return groups
    .map((group) => {
      const flatIndices = group.rows.map((row) => filtered.indexOf(row));
      return renderGroupHtml(group, flatIndices, highlightRowId);
    })
    .join("");
}
