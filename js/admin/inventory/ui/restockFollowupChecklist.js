/**
 * Post-restock channel follow-up checklist UI (Phase 10T — reminders + links only).
 */

import { esc } from "../utils/formatters.js";
import { buildInventoryPageUrl } from "../constants/orderLinks.js";
import { openSyncDryRunModal } from "./syncDryRunModal.js";
import { openBundlePreviewModal } from "./bundlePreviewModal.js";
import {
  fetchRestockFollowupCandidate,
  fetchRestockFollowupByLedgerId,
  upsertRestockFollowupState,
  FOLLOWUP_STATUS_LABELS,
  WORKFLOW_STATUS_LABELS,
} from "../api/restockFollowupApi.js";
import { showInventoryToast } from "../events.js";

/** @typedef {ReturnType<import('../api/restockFollowupApi.js').mapFollowupCandidate>} FollowupCandidate */

/** @param {FollowupCandidate} c */
function checklistItems(c) {
  const items = [
    `Component stock updated (+${c.restockedQty} units${c.stockAfter != null ? `, on-hand ${c.stockAfter}` : ""})`,
    c.virtualBundleAvailableAfter != null
      ? `Live virtual bundle availability may now be ${c.virtualBundleAvailableAfter} — review if bundle is live`
      : "Review live virtual bundle availability if parent bundle uses virtual BOM",
    c.amazonMappingStatus === "mapped_fbm"
      ? "Amazon FBM mapping exists — review quantity candidate in Sync Channels"
      : c.amazonMappingStatus === "mapped_afn"
        ? "Amazon AFN/FBA mapped — marketplace qty sync not applicable locally"
        : "No Amazon FBM mapping for component/bundle",
    c.ebayMappingStatus === "not_mapped"
      ? "No mapped eBay listing quantity to sync"
      : `eBay mapping (${c.ebayMappingStatus.replace("_", " ")}) — review quantity or relist if needed`,
    c.kkAvailableAfter != null ? `KK component available qty is now ${c.kkAvailableAfter}` : null,
  ];
  return items.filter(Boolean);
}

/** @param {HTMLElement} wrap @param {FollowupCandidate} c */
function wireChecklist(wrap, c) {
  wrap.querySelector("[data-followup-dismiss]")?.addEventListener("click", async () => {
    try {
      await upsertRestockFollowupState({ restockActionId: c.restockActionId, status: "dismissed" });
      wrap.remove();
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });

  wrap.querySelector("[data-followup-reviewed]")?.addEventListener("click", async () => {
    const note = window.prompt("Optional follow-up note:") || null;
    try {
      await upsertRestockFollowupState({ restockActionId: c.restockActionId, status: "reviewed", note });
      showInventoryToast("Follow-up marked reviewed.", { variant: "success" });
      wrap.remove();
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });

  wrap.querySelector("[data-followup-sync-not-needed]")?.addEventListener("click", async () => {
    try {
      await upsertRestockFollowupState({ restockActionId: c.restockActionId, status: "sync_not_needed" });
      showInventoryToast("Marked sync not needed.", { variant: "success" });
      wrap.remove();
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });

  wrap.querySelector("[data-followup-sync-completed]")?.addEventListener("click", async () => {
    try {
      await upsertRestockFollowupState({ restockActionId: c.restockActionId, status: "sync_completed" });
      showInventoryToast("Follow-up marked sync completed.", { variant: "success" });
      wrap.remove();
    } catch (err) {
      showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
    }
  });

  wrap.querySelector("[data-followup-sync]")?.addEventListener("click", () => {
    void openSyncDryRunModal({
      highlightVariantId: c.componentVariantId,
      highlightSku: c.componentSku,
      contextNote: `Post-restock follow-up for ${c.componentSku} — review channel quantities manually. Sync is not run automatically.`,
    });
  });

  wrap.querySelector("[data-followup-bundle]")?.addEventListener("click", () => {
    openBundlePreviewModal({ focusBundleVariantId: c.parentBundleVariantId ?? null });
  });
}

/** @param {FollowupCandidate} c */
function renderChecklistHtml(c) {
  const statusLabel = FOLLOWUP_STATUS_LABELS[c.followupStatus] || c.followupStatus;
  const wfLabel = WORKFLOW_STATUS_LABELS[c.workflowStatus] || c.workflowStatus;
  const list = checklistItems(c)
    .map((item) => `<li>${esc(item)}</li>`)
    .join("");

  return `
    <div class="mt-3 border border-green-300 bg-green-50 rounded p-3 text-[10px] space-y-2" data-post-restock-checklist data-restock-action-id="${esc(c.restockActionId)}">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p class="font-black uppercase text-green-900">Restock complete — channel follow-up</p>
          <p class="text-[9px] text-green-800">${esc(statusLabel)} · ${esc(wfLabel)}</p>
        </div>
        <button type="button" data-followup-dismiss class="text-[9px] font-black uppercase text-green-800 hover:underline">Dismiss</button>
      </div>
      <p class="text-[9px] text-green-900">${esc(c.followupReason)}</p>
      <ul class="list-disc pl-4 text-green-900 space-y-1">${list}</ul>
      <div class="flex flex-wrap gap-2 pt-1">
        <button type="button" data-followup-sync class="border-2 border-indigo-700 text-indigo-900 px-2 py-1 text-[9px] font-black uppercase">Open Sync Channels</button>
        <button type="button" data-followup-bundle class="border-2 border-violet-700 text-violet-900 px-2 py-1 text-[9px] font-black uppercase">Open Bundle Preview</button>
        <a href="${esc(buildInventoryPageUrl({ q: c.componentSku }))}" class="border-2 border-gray-600 text-gray-800 px-2 py-1 text-[9px] font-black uppercase inline-block">Open Inventory</a>
        <button type="button" data-followup-reviewed class="border border-gray-600 px-2 py-1 text-[9px] font-black uppercase">Mark Reviewed</button>
        <button type="button" data-followup-sync-not-needed class="border border-gray-500 px-2 py-1 text-[9px] font-black uppercase">Sync Not Needed</button>
        <button type="button" data-followup-sync-completed class="border border-emerald-700 text-emerald-900 px-2 py-1 text-[9px] font-black uppercase">Sync Completed</button>
      </div>
      <p class="text-[9px] text-green-800">Channel sync is not run automatically after restock.</p>
    </div>`;
}

/**
 * @param {HTMLElement} container
 * @param {Object} ctx
 * @param {string} [ctx.restockActionId]
 * @param {string} [ctx.ledgerId]
 * @param {string} [ctx.componentSku]
 * @param {string|null} [ctx.parentBundleVariantId]
 * @param {number} [ctx.restockQty]
 */
export async function showPostRestockFollowupChecklist(container, ctx = {}) {
  container.querySelector("[data-post-restock-checklist]")?.remove();

  let candidate = null;
  try {
    if (ctx.restockActionId) candidate = await fetchRestockFollowupCandidate(ctx.restockActionId);
    else if (ctx.ledgerId) candidate = await fetchRestockFollowupByLedgerId(ctx.ledgerId);
  } catch (err) {
    console.warn("[followup] load failed:", err);
  }

  if (!candidate) {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-post-restock-checklist", "1");
    wrap.className = "mt-3 border border-green-300 bg-green-50 rounded p-3 text-[10px] space-y-2";
    wrap.innerHTML = `
      <p class="font-black uppercase text-green-900">Restock complete — next steps</p>
      <ul class="list-disc pl-4 text-green-900 space-y-1">
        <li>Inventory updated (+${ctx.restockQty ?? "?"} component units)</li>
        <li>Review channel quantities manually if component or bundle is marketplace-mapped</li>
      </ul>
      <button type="button" data-followup-sync-fallback class="border-2 border-indigo-700 text-indigo-900 px-2 py-1 text-[9px] font-black uppercase">Open Sync Channels</button>
      <p class="text-[9px] text-green-800">Follow-up details unavailable until migration applied.</p>`;
    wrap.querySelector("[data-followup-sync-fallback]")?.addEventListener("click", () => {
      void openSyncDryRunModal({ highlightSku: ctx.componentSku || undefined });
    });
    container.appendChild(wrap);
    return;
  }

  const wrap = document.createElement("div");
  wrap.innerHTML = renderChecklistHtml(candidate);
  const el = wrap.firstElementChild;
  if (!el) return;
  wireChecklist(el, candidate);
  container.appendChild(el);
}

/** @param {string} restockActionId */
export async function openRestockFollowupChecklistModal(restockActionId) {
  const candidate = await fetchRestockFollowupCandidate(restockActionId);
  if (!candidate) {
    showInventoryToast("Follow-up candidate not found.", { variant: "error" });
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40";
  overlay.innerHTML = `
    <div class="bg-white border-4 border-black max-w-lg w-full p-4 shadow-xl">
      <div class="flex justify-between items-center mb-2">
        <h3 class="text-sm font-black uppercase">Restock Follow-Up</h3>
        <button type="button" data-followup-modal-close class="text-xl font-black">×</button>
      </div>
      <div id="followupModalBody"></div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add("overflow-hidden");
  const body = overlay.querySelector("#followupModalBody");
  if (body) {
    body.innerHTML = renderChecklistHtml(candidate);
    const checklist = body.querySelector("[data-post-restock-checklist]");
    if (checklist) wireChecklist(checklist, candidate);
  }
  overlay.querySelector("[data-followup-modal-close]")?.addEventListener("click", () => {
    overlay.remove();
    document.body.classList.remove("overflow-hidden");
  });
}
