/**
 * Marketplace Restock Assist UI block (Phase 10Q — admin-confirmed only).
 */

import { esc } from "../utils/formatters.js";
import { formatCents } from "../api/bundleReturnRestockApi.js";
import {
  ASSIST_STATUS_LABELS,
  ASSIST_CHANNEL_LABELS,
} from "../api/marketplaceRestockAssistApi.js";
import { STALE_OBSERVATION_HOURS } from "../api/marketplaceRestockAssistQueueApi.js";
import { confirmPhysicalReturn, updateReturnWorkflow } from "../api/returnWorkflowApi.js";
import { showInventoryToast } from "../events.js";

/** @typedef {import('../api/marketplaceRestockAssistApi.js').MarketplaceRestockAssistRow} MarketplaceRestockAssistRow */
/** @typedef {import('../api/returnWorkflowApi.js').ReturnWorkflowGuidanceRow} ReturnWorkflowGuidanceRow */

const ASSIST_CLS = {
  eligible_line_confirmed: "border-emerald-300 bg-emerald-50 text-emerald-900",
  needs_rma_workflow: "border-violet-300 bg-violet-50 text-violet-900",
  needs_physical_return_confirmation: "border-amber-300 bg-amber-50 text-amber-900",
  sku_inferred_manual_review: "border-orange-300 bg-orange-50 text-orange-900",
  order_level_manual_review: "border-gray-300 bg-gray-50 text-gray-800",
  already_restocked: "border-gray-200 bg-gray-50 text-gray-500",
  afn_external_review: "border-purple-300 bg-purple-50 text-purple-900",
  not_finalized: "border-gray-200 bg-gray-50 text-gray-600",
};

/** @param {ReturnWorkflowGuidanceRow} row @param {MarketplaceRestockAssistRow|null|undefined} assist */
export function renderMarketplaceAssistBlock(row, assist) {
  if (!assist && !row.marketplaceAssistStatus && !row.marketplaceObservationConfidence) {
    const ch = row.orderChannel || row.refundSourceChannel;
    if (ch !== "ebay" && ch !== "amazon") return "";
  }

  const a = assist || {
    assistStatus: row.marketplaceAssistStatus || "order_level_manual_review",
    assistReason: row.marketplaceAssistReason || "",
    suggestedRestockQty: row.marketplaceSuggestedRestockQty ?? null,
    observationConfidence: row.marketplaceObservationConfidence || row.marketplaceLineConfidence,
    sourceChannel: row.orderChannel || row.refundSourceChannel || "ebay",
    maxRestockableQty: row.maxRestockableQty,
    finalizedQty: row.finalizedQty,
    alreadyRestockedQty: row.alreadyRestockedQty,
    physicalReturnConfirmedAt: row.workflowPhysicalReturnConfirmedAt || null,
    workflowId: row.workflowId,
    workflowCondition: row.workflowCondition,
    refundAmountCents: row.refundedAmountCents,
    observationObservedAt: row.latestPersistedObsAt || row.latestMarketplaceObsAt,
    observationSyncSource: row.marketplaceSyncSource,
  };

  const status = a.assistStatus || "order_level_manual_review";
  const statusLabel = ASSIST_STATUS_LABELS[status] || status;
  const channelLabel =
    ASSIST_CHANNEL_LABELS[a.sourceChannel] || ASSIST_CHANNEL_LABELS[row.orderChannel] || a.sourceChannel;
  const cls = ASSIST_CLS[status] || ASSIST_CLS.order_level_manual_review;
  const isStale =
    Boolean(a.isObservationStale) ||
    (a.observationAgeHours != null && a.observationAgeHours > STALE_OBSERVATION_HOURS);
  const canUseSuggested =
    status === "eligible_line_confirmed" &&
    !isStale &&
    a.suggestedRestockQty != null &&
    a.suggestedRestockQty > 0;
  const canPrefillSuggested = a.observationConfidence === "line_confirmed";

  return `
    <div class="border rounded p-1.5 space-y-1 ${cls}" data-marketplace-assist>
      <p class="text-[9px] font-black uppercase">
        Marketplace Restock Assist · ${esc(channelLabel)} · ${esc(statusLabel)}
        ${isStale ? `<span class="ml-1 border border-amber-600 bg-amber-100 text-amber-900 px-1 py-0.5 rounded text-[8px]">STALE &gt;${STALE_OBSERVATION_HOURS}h</span>` : ""}
      </p>
      <p class="text-[9px]">
        Confidence: ${esc(a.observationConfidence || "—")}
        · finalized ${a.finalizedQty ?? row.finalizedQty}
        · restocked ${a.alreadyRestockedQty ?? row.alreadyRestockedQty}
        · max ${a.maxRestockableQty ?? row.maxRestockableQty}
        ${canPrefillSuggested && a.suggestedRestockQty != null ? ` · suggested ${a.suggestedRestockQty}` : ""}
        ${a.refundAmountCents != null ? ` · refund ${formatCents(a.refundAmountCents)}` : ""}
      </p>
      ${a.observationObservedAt ? `<p class="text-[9px] opacity-80">Observed ${esc(new Date(a.observationObservedAt).toLocaleString())}${a.observationSyncSource ? ` · ${esc(a.observationSyncSource)}` : ""}</p>` : ""}
      <p class="text-[9px] bg-white/50 border border-current/10 rounded p-1">${esc(a.assistReason || "Marketplace observation available for review.")}</p>
      ${
        a.physicalReturnConfirmedAt
          ? `<p class="text-[9px] text-emerald-800">Physical return confirmed ${esc(new Date(a.physicalReturnConfirmedAt).toLocaleString())}</p>`
          : ""
      }
      ${
        status === "needs_physical_return_confirmation" && a.workflowId
          ? `<button type="button" data-mp-confirm-physical
              class="border border-amber-700 text-amber-900 px-1.5 py-0.5 text-[8px] font-black uppercase">
              Mark Physical Return Confirmed
            </button>`
          : ""
      }
      ${
        canUseSuggested
          ? `<button type="button" data-mp-use-suggested
              class="border border-emerald-700 text-emerald-900 px-1.5 py-0.5 text-[8px] font-black uppercase">
              Use Suggested Qty (${a.suggestedRestockQty})
            </button>`
          : ""
      }
      ${
        status === "eligible_line_confirmed" && !isStale
          ? `<label class="flex items-start gap-1.5 text-[9px] mt-1">
              <input type="checkbox" data-mp-restock-ack class="mt-0.5" />
              <span>I confirmed the component was physically returned and is resellable.</span>
            </label>`
          : isStale
            ? `<p class="text-[9px] text-amber-800">Refresh marketplace observations before restocking.</p>`
            : ""
      }
    </div>`;
}

/** Whether marketplace assist allows prefilled suggested restock qty. */
export function marketplaceAssistCanPrefillSuggested(assist) {
  if (!assist) return false;
  return assist.observationConfidence === "line_confirmed" && assist.assistStatus === "eligible_line_confirmed";
}

/** Whether restock UI should be hidden (render) or blocked (action with wrap). */
export function marketplaceAssistBlocksRestock(assist, row, wrap) {
  const status = assist?.assistStatus || row?.marketplaceAssistStatus;
  if (!status) return false;
  if (status === "afn_external_review" || status === "not_finalized" || status === "already_restocked") {
    return true;
  }
  if (row?.workflowCondition === "damaged" || row?.workflowCondition === "missing") return true;
  if (status === "needs_physical_return_confirmation" || status === "needs_rma_workflow") return true;
  if (status === "eligible_line_confirmed" && wrap) {
    const ack = wrap.querySelector("[data-mp-restock-ack]");
    if (ack instanceof HTMLInputElement && !ack.checked) return true;
  }
  return false;
}

/** @param {HTMLElement} wrap @param {MarketplaceRestockAssistRow|null|undefined} assist @param {() => Promise<void>} reload */
export function wireMarketplaceAssistActions(wrap, assist, reload) {
  if (!assist && !wrap.querySelector("[data-marketplace-assist]")) return;

  wrap.querySelector("[data-mp-use-suggested]")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const qtyEl = wrap.querySelector("[data-restock-qty]");
    const suggested = wrap.getAttribute("data-suggested-qty") || assist?.suggestedRestockQty;
    if (qtyEl instanceof HTMLInputElement && suggested) {
      qtyEl.value = String(suggested);
      showInventoryToast(`Suggested qty ${suggested} applied — confirm restock when ready.`, { variant: "info" });
    }
  });

  wrap.querySelector("[data-mp-confirm-physical]")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const workflowId = assist?.workflowId || wrap.getAttribute("data-workflow-id");
    if (!workflowId) {
      showInventoryToast("Create a return workflow first.", { variant: "error" });
      return;
    }
    const note = window.prompt("Optional note for physical return confirmation:");
    if (note === null) return;
    try {
      await confirmPhysicalReturn({ workflowId, note: note.trim() || null });
      showInventoryToast("Physical return confirmed — no stock changed.", { variant: "success" });
      await reload();
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });
}
