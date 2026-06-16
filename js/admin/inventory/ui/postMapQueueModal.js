/**
 * Post-map queue work screen (Phase 9B–9C).
 */

import { getDom } from "../dom.js";
import { esc } from "../utils/formatters.js";
import {
  fetchPostMapQueueWithResolution,
  fetchPostMapQueueWorkCounts,
  updatePostMapQueueItemsBulk,
  resolutionBannerText,
} from "../api/postMapQueueResolutionApi.js";
import {
  openQueueReservationRetry,
  openQueueManualFinalize,
  openQueueShippedAudit,
  openQueueOrder,
  snoozeQueueItem,
  setQueueItemStatus,
} from "../services/postMapQueueRowActions.js";
import { renderQueueEvidenceHtml } from "./postMapQueueEvidence.js";
import { showInventoryToast } from "../events.js";
import { refreshInventoryAfterIssueStateChange } from "../services/refreshInventoryData.js";

/** @typedef {import('../api/postMapQueueResolutionApi.js').PostMapQueueWithResolution} QueueItem */

const STATUS_FILTERS = [
  { id: "active", label: "Active" },
  { id: "appears_completed", label: "Appears Done" },
  { id: "snoozed", label: "Snoozed" },
  { id: "reviewed", label: "Reviewed" },
  { id: "done", label: "Done" },
  { id: "ignored", label: "Ignored" },
];

const STEP_FILTERS = [
  { id: "", label: "All steps" },
  { id: "reservation_retry", label: "Reservation Retry" },
  { id: "shipped_finalize_audit", label: "Shipped Audit" },
  { id: "manual_finalize_possible", label: "Manual Finalize" },
  { id: "manual_review", label: "Manual Review" },
];

const CHANNEL_FILTERS = [
  { id: "", label: "All channels" },
  { id: "ebay", label: "eBay" },
  { id: "amazon", label: "Amazon" },
  { id: "kk", label: "KK" },
];

const STEP_LABEL = {
  reservation_retry: "Reservation Retry",
  shipped_finalize_audit: "Shipped Audit",
  manual_finalize_possible: "Manual Finalize",
  manual_review: "Manual Review",
};

/** @type {string} */
let activeFilter = "active";
/** @type {string} */
let stepFilter = "";
/** @type {string} */
let channelFilter = "";
/** @type {QueueItem[]} */
let rows = [];
/** @type {Set<string>} */
let selectedIds = new Set();
/** @type {Set<string>} */
let expandedEvidence = new Set();

function closeModal() {
  const mount = getDom().postMapQueueModalMount;
  if (mount) mount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
  selectedIds = new Set();
  expandedEvidence = new Set();
}

function primaryActionHtml(item, idx) {
  if (item.detectedResolutionStatus === "appears_completed") return "";
  if (item.nextStep === "reservation_retry") {
    return `<button type="button" data-pmq-retry="${idx}" class="text-[10px] font-black uppercase text-indigo-800 hover:underline">Reservation Retry →</button>`;
  }
  if (item.nextStep === "manual_finalize_possible") {
    return `<button type="button" data-pmq-finalize="${idx}" class="text-[10px] font-black uppercase text-amber-800 hover:underline">Manual Finalize →</button>`;
  }
  if (item.nextStep === "shipped_finalize_audit") {
    return `<button type="button" data-pmq-audit="${idx}" class="text-[10px] font-black uppercase text-red-800 hover:underline">Shipped Audit →</button>`;
  }
  return `<button type="button" data-pmq-order="${idx}" class="text-[10px] font-black uppercase text-teal-800 hover:underline">Open Order →</button>`;
}

function resolutionBannerHtml(item, idx) {
  const text = resolutionBannerText(item);
  if (!text) return "";
  return `
    <div class="border border-green-300 bg-green-50 rounded p-2 text-[10px] text-green-900 space-y-1">
      <p class="font-black uppercase">${esc(text)}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-pmq-done="${idx}" class="font-black uppercase text-green-800 hover:underline">Mark Done</button>
        <button type="button" data-pmq-evidence="${idx}" class="font-black uppercase text-gray-700 hover:underline">Open Evidence</button>
        <button type="button" data-pmq-keep="${idx}" class="font-black uppercase text-gray-500 hover:underline">Keep Open</button>
      </div>
    </div>`;
}

function rowHtml(item, idx) {
  const checked = selectedIds.has(item.id);
  const showEvidence = expandedEvidence.has(item.id);
  return `
    <div class="p-3 text-[11px] space-y-1 border-b border-gray-100" data-pmq-row="${idx}">
      <div class="flex gap-2 items-start">
        <input type="checkbox" data-pmq-select="${idx}" class="mt-1" ${checked ? "checked" : ""} ${item.status === "done" || item.status === "ignored" ? "disabled" : ""} />
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap justify-between gap-2">
            <div>
              <span class="font-bold">${esc(item.productLabel || "Line")}</span>
              <span class="text-gray-500 font-mono block">${esc(item.sourceChannel)} · ${esc(item.internalSku || "—")} · qty ${item.quantity}</span>
            </div>
            <span class="text-[9px] font-black uppercase text-gray-400">${esc(item.status)}</span>
          </div>
          <p class="text-[10px] text-gray-600">${esc(STEP_LABEL[item.nextStep] || item.nextStep)} — ${esc(item.reason || item.detectedReason)}</p>
          ${resolutionBannerHtml(item, idx)}
          <div class="flex flex-wrap gap-2 items-center mt-1">
            ${primaryActionHtml(item, idx)}
            <button type="button" data-pmq-order="${idx}" class="text-[10px] font-black uppercase text-gray-600 hover:underline">Order</button>
            <button type="button" data-pmq-evidence="${idx}" class="text-[10px] font-black uppercase text-gray-700 hover:underline">${showEvidence ? "Hide" : "Open"} Evidence</button>
            <button type="button" data-pmq-reviewed="${idx}" class="text-[10px] font-black uppercase text-blue-800 hover:underline">Reviewed</button>
            <button type="button" data-pmq-snooze="${idx}" class="text-[10px] font-black uppercase text-violet-800 hover:underline">Snooze</button>
            <button type="button" data-pmq-done="${idx}" class="text-[10px] font-black uppercase text-green-800 hover:underline">Done</button>
            <button type="button" data-pmq-ignore="${idx}" class="text-[10px] font-black uppercase text-gray-500 hover:underline">Ignore</button>
          </div>
          ${showEvidence ? renderQueueEvidenceHtml(item) : ""}
        </div>
      </div>
    </div>`;
}

function selectableRows() {
  return rows.filter((r) => r.status !== "done" && r.status !== "ignored");
}

/** @param {Element} panel */
function updateSelectionUi(panel) {
  const countEl = panel.querySelector("#pmqSelectedCount");
  if (countEl) countEl.textContent = `${selectedIds.size} selected`;
  panel.querySelectorAll("[data-pmq-select]").forEach((input) => {
    const idx = Number(input.getAttribute("data-pmq-select"));
    const item = rows[idx];
    if (!item || input.disabled) return;
    input.checked = selectedIds.has(item.id);
  });
}

/** @param {Element} panel */
function selectAllVisible(panel) {
  const selectable = selectableRows();
  for (const item of selectable) selectedIds.add(item.id);
  updateSelectionUi(panel);
  if (selectable.length) {
    showInventoryToast(`Selected ${selectable.length} item(s) on this page.`, { variant: "info" });
  }
}

/** @param {Element} panel */
function clearSelection(panel) {
  selectedIds = new Set();
  updateSelectionUi(panel);
}

async function bulkUpdateStatus(panel, status) {
  const ids = [...selectedIds];
  if (!ids.length) {
    showInventoryToast("Select at least one queue item.", { variant: "info" });
    return;
  }

  if (status === "done") {
    const ok = window.confirm(
      `Mark ${ids.length} queue item(s) as done?\n\nThis only marks queue items done. It does not change inventory.`,
    );
    if (!ok) return;
  }

  if (status === "snoozed") {
    const daysStr = window.prompt(`Snooze ${ids.length} item(s) for how many days?`, "3");
    if (daysStr === null) return;
    const days = Number(daysStr);
    if (!Number.isFinite(days) || days <= 0) {
      showInventoryToast("Enter a positive number of days.", { variant: "error" });
      return;
    }
    const until = new Date();
    until.setDate(until.getDate() + Math.round(days));
    await updatePostMapQueueItemsBulk(ids, "snoozed", { snoozedUntil: until.toISOString() });
  } else {
    await updatePostMapQueueItemsBulk(ids, status);
  }

  selectedIds = new Set();
  showInventoryToast(`Updated ${ids.length} item(s).`, { variant: "success" });
  await refreshInventoryAfterIssueStateChange();
  await loadAndRender(panel);
}

function wireRowActions(panel) {
  const refresh = () => void loadAndRender(panel);

  panel.querySelectorAll("[data-pmq-select]").forEach((input) => {
    input.addEventListener("change", () => {
      const idx = Number(input.getAttribute("data-pmq-select"));
      const item = rows[idx];
      if (!item) return;
      if (input.checked) selectedIds.add(item.id);
      else selectedIds.delete(item.id);
      updateSelectionUi(panel);
    });
  });

  panel.querySelectorAll("[data-pmq-evidence]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-pmq-evidence"));
      const item = rows[idx];
      if (!item) return;
      if (expandedEvidence.has(item.id)) expandedEvidence.delete(item.id);
      else expandedEvidence.add(item.id);
      void loadAndRender(panel);
    });
  });

  panel.querySelectorAll("[data-pmq-keep]").forEach((btn) => {
    btn.addEventListener("click", () => showInventoryToast("Kept open.", { variant: "info" }));
  });

  panel.querySelectorAll("[data-pmq-retry]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = rows[Number(btn.getAttribute("data-pmq-retry"))];
      if (item) void openQueueReservationRetry(item, { suggestMarkDone: true, onComplete: refresh });
    });
  });
  panel.querySelectorAll("[data-pmq-audit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = rows[Number(btn.getAttribute("data-pmq-audit"))];
      if (item) void openQueueShippedAudit(item);
    });
  });
  panel.querySelectorAll("[data-pmq-finalize]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = rows[Number(btn.getAttribute("data-pmq-finalize"))];
      if (item) void openQueueManualFinalize(item, { suggestMarkDone: true, onComplete: refresh });
    });
  });
  panel.querySelectorAll("[data-pmq-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = rows[Number(btn.getAttribute("data-pmq-order"))];
      if (item) openQueueOrder(item);
    });
  });
  panel.querySelectorAll("[data-pmq-reviewed]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = rows[Number(btn.getAttribute("data-pmq-reviewed"))];
      if (item) void setQueueItemStatus(item, "reviewed", refresh);
    });
  });
  panel.querySelectorAll("[data-pmq-snooze]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = rows[Number(btn.getAttribute("data-pmq-snooze"))];
      if (item) void snoozeQueueItem(item, refresh);
    });
  });
  panel.querySelectorAll("[data-pmq-done]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = rows[Number(btn.getAttribute("data-pmq-done"))];
      if (!item) return;
      const ok = window.confirm(
        "Mark this queue item done?\n\nThis only marks the todo done. It does not change inventory.",
      );
      if (!ok) return;
      void setQueueItemStatus(item, "done", refresh);
    });
  });
  panel.querySelectorAll("[data-pmq-ignore]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = rows[Number(btn.getAttribute("data-pmq-ignore"))];
      if (item) void setQueueItemStatus(item, "ignored", refresh);
    });
  });

  panel.querySelector("#pmqSelectAll")?.addEventListener("click", () => selectAllVisible(panel));
  panel.querySelector("#pmqClearSelection")?.addEventListener("click", () => clearSelection(panel));
  panel.querySelector("#pmqBulkReviewed")?.addEventListener("click", () => void bulkUpdateStatus(panel, "reviewed"));
  panel.querySelector("#pmqBulkSnooze")?.addEventListener("click", () => void bulkUpdateStatus(panel, "snoozed"));
  panel.querySelector("#pmqBulkDone")?.addEventListener("click", () => void bulkUpdateStatus(panel, "done"));
  panel.querySelector("#pmqBulkIgnore")?.addEventListener("click", () => void bulkUpdateStatus(panel, "ignored"));
}

async function loadAndRender(panel) {
  panel.innerHTML = `<p class="text-xs text-gray-500">Loading work queue…</p>`;
  try {
    const [queueRows, counts] = await Promise.all([
      fetchPostMapQueueWithResolution({
        filter: /** @type {'active'} */ (activeFilter),
        nextStep: stepFilter || undefined,
        sourceChannel: channelFilter || undefined,
        limit: 100,
      }),
      fetchPostMapQueueWorkCounts(),
    ]);
    rows = queueRows;

    panel.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div>
          <p class="text-[10px] font-black uppercase tracking-[.14em] text-gray-500">Post-Map Queue</p>
          <h2 class="text-lg font-black">Work Queue</h2>
          <p class="text-xs text-gray-600">Workflow only — bulk actions never run inventory mutations</p>
        </div>
        <button type="button" data-pmq-close class="border-2 border-black px-2 py-1 text-xs font-black uppercase">Close</button>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
        <div class="border rounded p-2"><strong>${counts.open}</strong> Open</div>
        <div class="border rounded p-2"><strong>${counts.snoozed}</strong> Snoozed</div>
        <div class="border border-green-200 bg-green-50 rounded p-2"><strong>${counts.appearsCompleted}</strong> Appears Done</div>
        <div class="border rounded p-2"><strong>${counts.manualReview}</strong> Manual Review</div>
        <div class="border rounded p-2"><strong>${counts.doneIgnored}</strong> Done/Ignored</div>
      </div>

      <div class="flex flex-wrap gap-1">${STATUS_FILTERS.map((f) => {
        const sel = f.id === activeFilter;
        return `<button type="button" data-pmq-filter="${f.id}" class="px-2 py-1 text-[9px] font-black uppercase rounded-lg border ${sel ? "border-black bg-black text-white" : "border-gray-300"}">${f.label}</button>`;
      }).join("")}</div>

      <div class="flex flex-wrap gap-2">
        <select id="pmqStepFilter" class="text-[10px] border border-gray-300 rounded px-2 py-1">${STEP_FILTERS.map((f) => `<option value="${f.id}" ${f.id === stepFilter ? "selected" : ""}>${f.label}</option>`).join("")}</select>
        <select id="pmqChannelFilter" class="text-[10px] border border-gray-300 rounded px-2 py-1">${CHANNEL_FILTERS.map((f) => `<option value="${f.id}" ${f.id === channelFilter ? "selected" : ""}>${f.label}</option>`).join("")}</select>
      </div>

      <div class="flex flex-wrap gap-2 items-center border border-gray-200 rounded p-2 bg-gray-50">
        <span id="pmqSelectedCount" class="text-[10px] text-gray-600">${selectedIds.size} selected</span>
        <button type="button" id="pmqSelectAll" class="text-[10px] font-black uppercase text-gray-800 border border-gray-400 px-2 py-0.5 rounded">Select All</button>
        <button type="button" id="pmqClearSelection" class="text-[10px] font-black uppercase text-gray-500">Clear</button>
        <span class="text-gray-300">|</span>
        <button type="button" id="pmqBulkReviewed" class="text-[10px] font-black uppercase text-blue-800">Mark Reviewed</button>
        <button type="button" id="pmqBulkSnooze" class="text-[10px] font-black uppercase text-violet-800">Snooze Selected</button>
        <button type="button" id="pmqBulkDone" class="text-[10px] font-black uppercase text-green-800">Mark Done Selected</button>
        <button type="button" id="pmqBulkIgnore" class="text-[10px] font-black uppercase text-gray-600">Ignore Selected</button>
      </div>

      <div class="max-h-[48vh] overflow-y-auto border border-gray-200 rounded-lg">
        ${rows.length ? rows.map(rowHtml).join("") : `<p class="p-6 text-center text-gray-400 text-xs">No queue items for this filter.</p>`}
      </div>`;

    panel.querySelector("[data-pmq-close]")?.addEventListener("click", closeModal);
    panel.querySelectorAll("[data-pmq-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeFilter = btn.getAttribute("data-pmq-filter") || "active";
        void loadAndRender(panel);
      });
    });
    panel.querySelector("#pmqStepFilter")?.addEventListener("change", (e) => {
      stepFilter = /** @type {HTMLSelectElement} */ (e.target).value;
      void loadAndRender(panel);
    });
    panel.querySelector("#pmqChannelFilter")?.addEventListener("change", (e) => {
      channelFilter = /** @type {HTMLSelectElement} */ (e.target).value;
      void loadAndRender(panel);
    });
    wireRowActions(panel);
  } catch (err) {
    panel.innerHTML = `<p class="text-red-700 text-sm">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

/** Open post-map work queue modal. */
export async function openPostMapQueueModal() {
  const mount = getDom().postMapQueueModalMount;
  if (!mount) return;

  activeFilter = "active";
  stepFilter = "";
  channelFilter = "";
  selectedIds = new Set();
  expandedEvidence = new Set();

  document.body.classList.add("overflow-hidden");
  mount.innerHTML = `
    <div class="fixed inset-0 z-[72] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <button type="button" class="absolute inset-0 bg-black/50" data-pmq-close aria-label="Close"></button>
      <div class="relative bg-white w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border-4 border-black shadow-xl p-4 space-y-3">
        <p class="text-xs text-gray-500">Loading…</p>
      </div>
    </div>`;

  mount.querySelector("[data-pmq-close]")?.addEventListener("click", closeModal);
  const panel = mount.querySelector(".relative");
  if (panel) await loadAndRender(panel);
}

/** @returns {Promise<number>} Active queue count for issues banner. */
export async function fetchActivePostMapQueueCount() {
  try {
    const counts = await fetchPostMapQueueWorkCounts();
    return counts.open;
  } catch {
    return 0;
  }
}
