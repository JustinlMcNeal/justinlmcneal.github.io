/**
 * RMA / return workflow UI block for Bundle Return/Restock panel (Phase 10J).
 */

import { esc } from "../utils/formatters.js";
import { WORKFLOW_NEXT_LABELS, WORKFLOW_STATUS_LABELS } from "../api/returnWorkflowApi.js";

/** @typedef {import('../api/returnWorkflowApi.js').ReturnWorkflowGuidanceRow} ReturnWorkflowGuidanceRow */

/** @param {ReturnWorkflowGuidanceRow} row @param {Record<string, unknown>|null} lastRestock */
export function renderWorkflowBlock(row, lastRestock) {
  const wfStatus = row.workflowStatus;
  const wfLabel = wfStatus ? WORKFLOW_STATUS_LABELS[wfStatus] || wfStatus : "No workflow";
  const nextLabel = WORKFLOW_NEXT_LABELS[row.workflowNextAction] || row.workflowNextAction;

  const restockResult =
    lastRestock && String(lastRestock.reservation_id || lastRestock.reservationId) === row.reservationId
      ? lastRestock
      : null;

  return `
    <div class="border border-violet-200 bg-violet-50/60 rounded p-1.5 space-y-1">
      <p class="text-[9px] font-black uppercase text-violet-900">
        RMA / Return: ${esc(wfLabel)} · Next: ${esc(nextLabel)}
      </p>
      ${
        row.workflowId
          ? `<p class="text-[9px] text-violet-800">
              Expected ${row.workflowQuantityExpected ?? "?"} · received ${row.workflowQuantityReceived ?? 0}
              · restocked (workflow) ${row.workflowQuantityRestocked ?? 0}
              · ${esc(row.workflowCondition || "unknown")}
              ${row.workflowRmaNumber ? ` · RMA ${esc(row.workflowRmaNumber)}` : ""}
              ${row.workflowTrackingNumber ? ` · track ${esc(row.workflowTrackingNumber)}` : ""}
            </p>`
          : `<p class="text-[9px] text-violet-800">No return workflow — create one to track physical return separately from refund.</p>`
      }
      ${
        restockResult
          ? `<p class="text-[9px] text-green-800">Last confirmed restock: +${restockResult.restock_qty ?? "?"} units
              ${restockResult.stock_after != null ? ` · stock now ${restockResult.stock_after}` : ""}</p>`
          : ""
      }
      ${
        row.workflowPhysicalReturnConfirmedAt
          ? `<p class="text-[9px] text-emerald-800">Physical return confirmed ${esc(new Date(row.workflowPhysicalReturnConfirmedAt).toLocaleString())}</p>`
          : ""
      }
      <p class="text-[9px] text-violet-950 italic">Return workflow status does not change stock. Stock changes only after confirmed restock.</p>
      <div class="flex flex-wrap gap-1 pt-0.5">
        ${
          !row.workflowId
            ? `<button type="button" data-wf-create class="border border-violet-700 text-violet-900 px-1.5 py-0.5 text-[8px] font-black uppercase">Create Return Workflow</button>`
            : ""
        }
        ${
          row.workflowId && ["open", "return_expected"].includes(wfStatus || "")
            ? `<button type="button" data-wf-received class="border border-violet-700 text-violet-900 px-1.5 py-0.5 text-[8px] font-black uppercase">Mark Received</button>`
            : ""
        }
        ${
          row.workflowId && ["received", "partially_received"].includes(wfStatus || "")
            ? `<button type="button" data-wf-inspect-resellable class="border border-violet-700 text-violet-900 px-1.5 py-0.5 text-[8px] font-black uppercase">Mark Inspected (resellable)</button>
               <button type="button" data-wf-inspect-damaged class="border border-amber-700 text-amber-900 px-1.5 py-0.5 text-[8px] font-black uppercase">Mark damaged</button>`
            : ""
        }
        ${
          row.workflowId && !["closed", "canceled"].includes(wfStatus || "")
            ? `<button type="button" data-wf-note class="border border-gray-500 text-gray-800 px-1.5 py-0.5 text-[8px] font-black uppercase">Add Note</button>
               <button type="button" data-wf-close class="border border-gray-600 text-gray-700 px-1.5 py-0.5 text-[8px] font-black uppercase">Close Return</button>`
            : ""
        }
      </div>
    </div>`;
}
