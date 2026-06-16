/**
 * Post-map workflow checklist (Phase 9A + 9B queue creation).
 */

import { getDom } from "../dom.js";
import { esc } from "../utils/formatters.js";
import {
  fetchPostMappingWorkflowCandidates,
  summarizePostMappingSteps,
} from "../api/postMappingWorkflowApi.js";
import { createPostMapQueueFromChecklist } from "../api/postMapQueueApi.js";
import {
  openQueueReservationRetry,
  openQueueShippedAudit,
  openQueueManualFinalize,
  openQueueOrder,
} from "../services/postMapQueueRowActions.js";
import { refreshInventoryAfterIssueStateChange } from "../services/refreshInventoryData.js";

/** @typedef {import('../api/postMappingWorkflowApi.js').PostMappingWorkflowCandidate} Candidate */

const STEP_BADGE = {
  reservation_retry: "bg-indigo-100 text-indigo-900 border-indigo-300",
  shipped_finalize_audit: "bg-red-100 text-red-900 border-red-300",
  manual_finalize_possible: "bg-amber-100 text-amber-900 border-amber-300",
  already_accounted_for: "bg-green-100 text-green-900 border-green-300",
  skipped_afn: "bg-gray-100 text-gray-700 border-gray-300",
  skipped_refunded: "bg-gray-100 text-gray-700 border-gray-300",
  skipped_canceled: "bg-gray-100 text-gray-700 border-gray-300",
  manual_review: "bg-violet-100 text-violet-900 border-violet-300",
};

function closeChecklist() {
  const mount = getDom().postMapChecklistMount;
  if (mount) mount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
}

function stepBadge(step) {
  const cls = STEP_BADGE[step] || STEP_BADGE.manual_review;
  return `<span class="text-[9px] font-black uppercase border px-1.5 py-0.5 rounded ${cls}">${esc(step.replace(/_/g, " "))}</span>`;
}

function actionButtonHtml(row, idx) {
  if (row.nextStep === "reservation_retry") {
    return `<button type="button" data-pm-reservation="${idx}" class="text-[10px] font-black uppercase text-indigo-800 hover:underline">Open Reservation Retry →</button>`;
  }
  if (row.nextStep === "manual_finalize_possible") {
    return `<button type="button" data-pm-finalize="${idx}" class="text-[10px] font-black uppercase text-amber-800 hover:underline">Open Manual Finalize →</button>`;
  }
  if (row.nextStep === "shipped_finalize_audit") {
    return `<button type="button" data-pm-audit="${idx}" class="text-[10px] font-black uppercase text-red-800 hover:underline">Open Shipped Audit →</button>`;
  }
  if (row.nextStep === "already_accounted_for") {
    return `<span class="text-[10px] text-gray-400">No action needed</span>`;
  }
  return `<button type="button" data-pm-order="${idx}" class="text-[10px] font-black uppercase text-teal-800 hover:underline">Open Order →</button>`;
}

/**
 * @param {HTMLElement} panel
 * @param {Candidate[]} rows
 * @param {{ applySummary?: Record<string, number>, queueUpsert?: Record<string, number>, onDone?: () => void }} opts
 */
function renderChecklist(panel, rows, opts = {}) {
  const counts = summarizePostMappingSteps(rows);
  const summary = opts.applySummary;
  const qu = opts.queueUpsert;

  panel.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div>
        <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">Mapping Applied</p>
        <h2 class="text-lg font-black">Mapped Lines — Next Steps</h2>
        <p class="text-xs text-gray-600">Guidance only — each action opens an existing confirmed workflow.</p>
      </div>
      <button type="button" data-pm-close class="border-2 border-black px-2 py-1 text-xs font-black uppercase">Close</button>
    </div>

    ${
      summary
        ? `<p class="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-2">
      Mapped ${summary.success_count ?? 0}/${summary.selected_count ?? 0}
      · Failed ${summary.failed_count ?? 0}
      · Skipped ${summary.skipped_count ?? 0}
    </p>`
        : ""
    }

    ${
      qu
        ? `<p class="text-[11px] text-violet-900 bg-violet-50 border border-violet-200 rounded-lg p-2">
      Queue updated — ${qu.updated ?? 0} row(s) tracked for follow-up.
    </p>`
        : ""
    }

    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
      <div class="border border-indigo-200 rounded p-2 bg-indigo-50/50"><strong>${counts.reservation_retry}</strong> Reservation Retry</div>
      <div class="border border-red-200 rounded p-2 bg-red-50/50"><strong>${counts.shipped_finalize_audit}</strong> Shipped Audit</div>
      <div class="border border-amber-200 rounded p-2 bg-amber-50/50"><strong>${counts.manual_finalize_possible}</strong> Manual Finalize</div>
      <div class="border border-green-200 rounded p-2 bg-green-50/50"><strong>${counts.already_accounted_for}</strong> Accounted For</div>
      <div class="border border-gray-200 rounded p-2 bg-gray-50"><strong>${counts.skipped_manual}</strong> Skipped / Review</div>
    </div>

    <p class="text-[10px] text-gray-500">Nothing runs automatically. Reservation retry and manual finalize still require separate confirmation.</p>

    <div class="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
      <table class="w-full text-[11px]">
        <thead class="sticky top-0 bg-white text-[9px] uppercase text-gray-400">
          <tr>
            <th class="text-left p-2">Line</th>
            <th class="text-left p-2">Next step</th>
            <th class="text-right p-2">Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row, idx) => `
          <tr class="align-top">
            <td class="p-2">
              <span class="font-bold block">${esc(row.productLabel)}</span>
              <span class="text-gray-500 font-mono">${esc(row.sourceChannel)} · qty ${row.quantity}</span>
              <span class="text-gray-400 font-mono block">${esc(row.sourceOrderId.slice(0, 22))}…</span>
            </td>
            <td class="p-2">
              ${stepBadge(row.nextStep)}
              <p class="text-gray-600 mt-1">${esc(row.nextStepReason)}</p>
            </td>
            <td class="p-2 text-right whitespace-nowrap">${actionButtonHtml(row, idx)}</td>
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <button type="button" data-pm-open-queue class="w-full border-2 border-violet-700 text-violet-900 px-4 py-2 text-xs font-black uppercase min-h-[44px]">Open Post-Map Queue</button>
    <button type="button" data-pm-done class="w-full border-2 border-black px-4 py-2 text-xs font-black uppercase min-h-[44px]">Done</button>`;

  panel.querySelectorAll("[data-pm-close], [data-pm-done]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeChecklist();
      opts.onDone?.();
    });
  });

  panel.querySelector("[data-pm-open-queue]")?.addEventListener("click", () => {
    closeChecklist();
    opts.onDone?.();
    import("./postMapQueueModal.js").then((mod) => mod.openPostMapQueueModal());
  });

  panel.querySelectorAll("[data-pm-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rows[Number(btn.getAttribute("data-pm-order"))];
      if (row) openQueueOrder(row);
    });
  });

  panel.querySelectorAll("[data-pm-reservation]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rows[Number(btn.getAttribute("data-pm-reservation"))];
      if (row) void openQueueReservationRetry(row);
    });
  });

  panel.querySelectorAll("[data-pm-audit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rows[Number(btn.getAttribute("data-pm-audit"))];
      if (!row) return;
      closeChecklist();
      void openQueueShippedAudit(row);
    });
  });

  panel.querySelectorAll("[data-pm-finalize]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rows[Number(btn.getAttribute("data-pm-finalize"))];
      if (row) void openQueueManualFinalize(row);
    });
  });
}

/**
 * @param {Object} opts
 * @param {string[]} [opts.mappingActionIds]
 * @param {string} [opts.batchId]
 * @param {Array<{ sourceOrderId: string, sourceOrderItemId: string }>} [opts.orderRefs]
 * @param {Record<string, number>} [opts.applySummary]
 * @param {() => void} [opts.onDone]
 * @param {HTMLElement} [opts.inlineMount]
 */
export async function showPostMappingChecklist(opts = {}) {
  const useInline = Boolean(opts.inlineMount);
  const mount = useInline ? opts.inlineMount : getDom().postMapChecklistMount;
  if (!mount) return;

  if (!useInline) {
    document.body.classList.add("overflow-hidden");
    mount.innerHTML = `
      <div class="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
        <button type="button" class="absolute inset-0 bg-black/50" data-pm-close aria-label="Close"></button>
        <div class="relative bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border-4 border-black shadow-xl p-4 space-y-3">
          <p class="text-xs text-gray-500">Loading next steps…</p>
        </div>
      </div>`;
    mount.querySelector("[data-pm-close]")?.addEventListener("click", () => {
      closeChecklist();
      opts.onDone?.();
    });
  } else {
    mount.innerHTML = `<p class="text-xs text-gray-500">Loading next steps…</p>`;
  }

  const panel = useInline ? mount : mount.querySelector(".relative");
  if (!panel) return;

  try {
    const rows = await fetchPostMappingWorkflowCandidates({
      mappingActionIds: opts.mappingActionIds,
      batchId: opts.batchId,
      orderRefs: opts.orderRefs,
    });

    if (!rows.length) {
      panel.innerHTML = `
        <div class="space-y-3">
          <p class="text-xs text-gray-600">Mapping saved. No post-map workflow candidates found for these lines.</p>
          <button type="button" data-pm-done class="w-full border-2 border-black px-4 py-2 text-xs font-black uppercase">Done</button>
        </div>`;
      panel.querySelector("[data-pm-done]")?.addEventListener("click", () => {
        if (!useInline) closeChecklist();
        opts.onDone?.();
      });
      return;
    }

    let queueUpsert = null;
    try {
      queueUpsert = await createPostMapQueueFromChecklist(rows);
      await refreshInventoryAfterIssueStateChange();
    } catch {
      // Queue creation is best-effort; checklist still shows
    }

    renderChecklist(panel, rows, {
      applySummary: opts.applySummary,
      queueUpsert: queueUpsert,
      onDone: opts.onDone,
    });
  } catch (err) {
    panel.innerHTML = `<p class="text-red-700 text-sm">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}
