/**
 * Read-only evidence panel for post-map queue items (Phase 9C).
 */

import { esc } from "../utils/formatters.js";

/** @typedef {import('../api/postMapQueueResolutionApi.js').PostMapQueueWithResolution} Item */

/** @param {Item} item @returns {string} */
export function renderQueueEvidenceHtml(item) {
  const lines = [
    `<p class="text-[9px] font-black uppercase text-gray-400">Evidence (read-only)</p>`,
    `<p class="text-[10px]"><span class="text-gray-500">Order:</span> <span class="font-mono">${esc(item.sourceOrderId)}</span></p>`,
    `<p class="text-[10px]"><span class="text-gray-500">Line item:</span> <span class="font-mono">${esc(item.sourceOrderItemId)}</span></p>`,
    `<p class="text-[10px]"><span class="text-gray-500">Resolution:</span> ${esc(item.detectedResolutionStatus)} — ${esc(item.detectedReason)}</p>`,
    `<p class="text-[10px]"><span class="text-gray-500">Signal:</span> ${esc(item.underlyingSignal)}</p>`,
  ];

  if (item.mappingActionId) {
    lines.push(`<p class="text-[10px]"><span class="text-gray-500">Mapping action:</span> <span class="font-mono">${esc(item.mappingActionId.slice(0, 8))}…</span></p>`);
  }
  if (item.mappingBatchId) {
    lines.push(`<p class="text-[10px]"><span class="text-gray-500">Mapping batch:</span> <span class="font-mono">${esc(item.mappingBatchId.slice(0, 8))}…</span></p>`);
  }

  if (item.retryReservationId || item.auditReservationId) {
    lines.push(
      `<p class="text-[10px]"><span class="text-gray-500">Reservation:</span> ${esc(item.retryReservationId || item.auditReservationId || "—")}${item.auditReservationStatus ? ` · ${esc(item.auditReservationStatus)}` : ""}</p>`,
    );
  }
  if (item.retrySuggestedAction) {
    lines.push(`<p class="text-[10px]"><span class="text-gray-500">Retry candidate:</span> ${esc(item.retrySuggestedAction)}</p>`);
  }
  if (item.suggestedAuditStatus) {
    lines.push(`<p class="text-[10px]"><span class="text-gray-500">Shipped audit:</span> ${esc(item.suggestedAuditStatus)}</p>`);
  }
  if (item.matchingLedgerId) {
    lines.push(
      `<p class="text-[10px]"><span class="text-gray-500">Ledger:</span> ${esc(item.matchingLedgerId.slice(0, 8))}…${item.matchingLedgerReason ? ` · ${esc(item.matchingLedgerReason)}` : ""}</p>`,
    );
  }
  if (item.manualFinalizeActionId) {
    lines.push(
      `<p class="text-[10px]"><span class="text-gray-500">Manual finalize audit:</span> ${esc(item.manualFinalizeActionId.slice(0, 8))}…${item.manualFinalizeLedgerId ? ` · ledger ${esc(item.manualFinalizeLedgerId.slice(0, 8))}…` : ""}</p>`,
    );
  }

  return `<div class="mt-2 border border-gray-200 rounded p-2 bg-gray-50 space-y-0.5">${lines.join("")}</div>`;
}
