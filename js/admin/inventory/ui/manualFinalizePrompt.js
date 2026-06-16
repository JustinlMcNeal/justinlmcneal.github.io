/**
 * Manual finalize assist prompt (Phase 8F).
 */

import { esc } from "../utils/formatters.js";
import {
  manualFinalizeShippedOrderLine,
  manualFinalizeImpactCopy,
} from "../api/manualFinalizeAssistApi.js";
import { refreshInventoryAfterIssueStateChange } from "../services/refreshInventoryData.js";
import { showInventoryToast } from "../events.js";

/**
 * @param {import('../api/manualFinalizeAssistApi.js').ManualFinalizeCandidate} candidate
 * @param {{ onComplete?: () => void }} [opts]
 */
export async function promptManualFinalize(candidate, opts = {}) {
  if (!candidate.isFinalizeEligible) {
    showInventoryToast(candidate.reason || "Not eligible for manual finalize.", { variant: "info" });
    return;
  }

  const note = window.prompt(
    "Admin note (required):\n\nDescribe why you confirmed this shipped order was never deducted.",
  );
  if (note === null) return;
  if (!note.trim()) {
    showInventoryToast("A note is required before manual finalize.", { variant: "error" });
    return;
  }

  const impact = manualFinalizeImpactCopy(candidate);
  const ok = window.confirm(
    `Manual finalize ${candidate.quantity} unit(s)?\n\n` +
      "This will decrement on-hand stock and write an order_finalized ledger row.\n" +
      "Only continue if you confirmed this shipped order was never deducted.\n\n" +
      `On-hand: ${impact.onHandDelta}\n` +
      `Reserved: ${impact.reservedDelta}\n` +
      `Available: ${impact.availableDelta}`,
  );
  if (!ok) return;

  try {
    const result = await manualFinalizeShippedOrderLine({
      sourceChannel: candidate.sourceChannel,
      sourceOrderId: candidate.sourceOrderId,
      sourceOrderItemId: candidate.sourceOrderItemId,
      expectedVariantId: candidate.variantId,
      note: note.trim(),
    });

    await refreshInventoryAfterIssueStateChange();

    const ledgerRef = result.ledger_id ? String(result.ledger_id).slice(0, 8) : "—";
    showInventoryToast(
      result.idempotent
        ? `Already finalized (ledger ${ledgerRef}).`
        : `Finalized — on-hand ${result.stock_before} → ${result.stock_after}. Ledger ${ledgerRef}.`,
      { variant: "success" },
    );
    opts.onComplete?.();
  } catch (err) {
    showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
  }
}

/**
 * @param {import('../api/manualFinalizeAssistApi.js').ManualFinalizeCandidate} candidate
 * @param {number} rowIndex
 */
export function manualFinalizeButtonHtml(candidate, rowIndex) {
  if (candidate.isFinalizeEligible) {
    return `<button type="button" data-manual-finalize="${rowIndex}" class="block text-[10px] font-black uppercase text-red-800 hover:underline mt-1">Manual Finalize →</button>`;
  }
  return `<span class="block text-[9px] text-gray-400 mt-1">${esc(candidate.reason || "Not eligible")}</span>`;
}
