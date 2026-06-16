/**
 * Marketplace Restock Assist Queue modal (Phase 10R/10S — batch review, admin-confirmed restock only).
 */

import { getDom } from "../dom.js";
import { esc } from "../utils/formatters.js";
import {
  fetchMarketplaceRestockQueue,
  queueRowCanRestock,
  QUEUE_BUCKET_LABELS,
  STALE_OBSERVATION_HOURS,
} from "../api/marketplaceRestockAssistQueueApi.js";
import {
  fetchMarketplaceRestockQueueSummary,
  upsertMarketplaceRestockQueueState,
} from "../api/marketplaceRestockAssistAnalyticsApi.js";
import { buildLineItemsOrdersUrl, channelFromOrderId } from "../constants/orderLinks.js";
import { showInventoryToast } from "../events.js";
import { renderQueueKpiStrip } from "./marketplaceRestockAssistQueueKpi.js";
import { renderAuditPanelHtml, initAuditPanel } from "./marketplaceRestockAssistAuditPanel.js";
import {
  actionReview,
  actionSnooze,
  actionUnsnooze,
  actionRestock,
  actionPhysicalReturn,
  actionCreateRma,
  actionRefreshObs,
  actionSkip,
  batchRefreshObs,
  promptSnoozeHours,
} from "./marketplaceRestockAssistQueueActions.js";

const BUCKET_FILTERS = [
  "ready_to_restock",
  "needs_physical_confirmation",
  "needs_rma",
  "stale_observation",
  "manual_review",
  "blocked",
  "already_done",
  "snoozed",
];

/** @type {string} */
let activeTab = "queue";
/** @type {string} */
let activeBucket = "ready_to_restock";
/** @type {Awaited<ReturnType<typeof fetchMarketplaceRestockQueue>>} */
let rows = [];
/** @type {Awaited<ReturnType<typeof fetchMarketplaceRestockQueueSummary>>|null} */
let summary = null;
/** @type {Set<string>} */
let selected = new Set();
/** @type {string|null} */
let auditReservationFilter = null;

function closeModal() {
  getDom().restockAssistQueueModalMount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
  selected = new Set();
  auditReservationFilter = null;
}

function staleBadge(row) {
  if (!row.isObservationStale) return "";
  return `<span class="text-[8px] font-black uppercase border border-amber-600 bg-amber-100 text-amber-900 px-1 py-0.5 rounded ml-1">Stale &gt;${STALE_OBSERVATION_HOURS}h</span>`;
}

function triageBadge(row) {
  if (row.isActivelySnoozed) {
    return `<span class="text-[8px] font-black uppercase border border-indigo-500 bg-indigo-50 text-indigo-800 px-1 py-0.5 rounded ml-1">Snoozed</span>`;
  }
  if (row.triageStatus === "reviewed") {
    return `<span class="text-[8px] font-black uppercase border border-gray-400 bg-gray-100 px-1 py-0.5 rounded ml-1">Reviewed</span>`;
  }
  return "";
}

/** @param {typeof rows[0]} row @param {number} idx */
function rowHtml(row, idx) {
  const canRestock = queueRowCanRestock(row);
  const orderUrl = buildLineItemsOrdersUrl({
    sessionId: row.sourceOrderId,
    lineId: row.sourceOrderItemId || undefined,
    channel: channelFromOrderId(row.sourceOrderId) || row.sourceChannel,
    tab: "overview",
  });
  const qty = row.suggestedRestockQty ?? row.maxRestockableQty;

  return `
    <div class="border-b border-gray-100 p-3 text-[11px] space-y-1">
      <div class="flex gap-2 items-start">
        <input type="checkbox" data-rsq-select="${idx}" class="mt-1" ${selected.has(row.reservationId) ? "checked" : ""} />
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap justify-between gap-1">
            <span class="font-bold">${esc(row.parentBundleTitle)} → ${esc(row.componentTitle)}</span>
            <span class="text-[9px] font-black uppercase text-indigo-800">${esc(QUEUE_BUCKET_LABELS[row.queueBucket] || row.queueBucket)}</span>
          </div>
          <p class="text-gray-500 font-mono text-[10px]">${esc(row.componentSku)} · ${esc(row.sourceChannel)}${staleBadge(row)}${triageBadge(row)}</p>
          <p class="text-[10px] text-gray-600">
            conf: ${esc(row.observationConfidence || "—")} · age: ${row.observationAgeHours != null ? `${row.observationAgeHours}h` : "—"}
            · max ${row.maxRestockableQty}${row.suggestedRestockQty != null ? ` · suggested ${row.suggestedRestockQty}` : ""}
          </p>
          ${row.triageNote ? `<p class="text-[9px] text-indigo-700 italic">${esc(row.triageNote)}</p>` : ""}
          <div class="flex flex-wrap gap-2 pt-1">
            <a href="${esc(orderUrl)}" target="_blank" rel="noopener" class="text-[9px] font-black uppercase text-teal-800 hover:underline">Order line</a>
            <button type="button" data-rsq-review="${idx}" class="text-[9px] font-black uppercase text-gray-700 hover:underline">Mark Reviewed</button>
            ${row.isActivelySnoozed ? `<button type="button" data-rsq-unsnooze="${idx}" class="text-[9px] font-black uppercase text-indigo-800 hover:underline">Unsnooze</button>` : `<button type="button" data-rsq-snooze="${idx}" class="text-[9px] font-black uppercase text-indigo-700 hover:underline">Snooze</button>`}
            <button type="button" data-rsq-note="${idx}" class="text-[9px] font-black uppercase text-gray-600 hover:underline">Add Note</button>
            <button type="button" data-rsq-view-audit="${idx}" class="text-[9px] font-black uppercase text-slate-800 hover:underline">View Audit</button>
            ${row.returnWorkflowId && row.queueBucket === "needs_physical_confirmation" ? `<button type="button" data-rsq-physical="${idx}" class="text-[9px] font-black uppercase text-amber-800 hover:underline">Mark Physical Return</button>` : ""}
            ${!row.returnWorkflowId && row.queueBucket === "needs_rma" ? `<button type="button" data-rsq-rma="${idx}" class="text-[9px] font-black uppercase text-violet-800 hover:underline">Create RMA</button>` : ""}
            <button type="button" data-rsq-refresh="${idx}" class="text-[9px] font-black uppercase text-sky-800 hover:underline">Refresh Obs</button>
            ${canRestock ? `<button type="button" data-rsq-restock="${idx}" class="text-[9px] font-black uppercase text-green-800 hover:underline">Restock (${qty})</button>` : row.isObservationStale ? `<span class="text-[9px] text-amber-700">Restock blocked — refresh first</span>` : ""}
            <button type="button" data-rsq-skip="${idx}" class="text-[9px] font-black uppercase text-gray-500 hover:underline">Skip</button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderPanel() {
  const mount = getDom().restockAssistQueueModalMount;
  if (!mount) return;

  const filterBtns = BUCKET_FILTERS.map(
    (b) => `<button type="button" data-rsq-filter="${b}" class="px-2 py-1 text-[9px] font-black uppercase border rounded ${activeBucket === b ? "bg-indigo-700 text-white border-indigo-800" : "bg-white text-gray-700 border-gray-300"}">${esc(QUEUE_BUCKET_LABELS[b] || b)}</button>`,
  ).join("");
  const tabCls = (t) => (activeTab === t ? "border-b-2 border-indigo-700 text-indigo-900" : "text-gray-500");
  const body =
    activeTab === "audit"
      ? `<div class="flex flex-col flex-1 min-h-0 overflow-hidden" id="rsqAuditMount">${renderAuditPanelHtml()}</div>`
      : `<div class="px-4 py-2 border-b border-gray-200 flex flex-wrap gap-1">${filterBtns}</div>
         <div class="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-2 text-[10px]">
           <button type="button" data-rsq-batch-review class="border border-gray-600 px-2 py-1 font-black uppercase">Mark selected reviewed</button>
           <button type="button" data-rsq-batch-snooze class="border border-indigo-600 px-2 py-1 font-black uppercase">Snooze selected</button>
           <button type="button" data-rsq-batch-unsnooze class="border border-indigo-400 px-2 py-1 font-black uppercase">Unsnooze selected</button>
           <button type="button" data-rsq-batch-refresh class="border border-sky-700 text-sky-900 px-2 py-1 font-black uppercase">Refresh selected</button>
           <span class="text-gray-500 self-center">${rows.length} row(s) · no batch restock</span>
         </div>
         <div class="overflow-y-auto flex-1 min-h-0">${rows.length ? rows.map(rowHtml).join("") : `<p class="p-4 text-sm text-gray-500">No rows in this bucket.</p>`}</div>`;

  mount.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4 bg-black/40" role="dialog" aria-modal="true">
      <div class="bg-white border-4 border-black w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl">
        <div class="flex items-center justify-between border-b-4 border-black px-4 py-3">
          <h2 class="text-sm font-black uppercase tracking-[.12em]">Marketplace Restock Assist Queue</h2>
          <button type="button" data-rsq-close class="text-xl font-black px-2">×</button>
        </div>
        ${summary ? renderQueueKpiStrip(summary) : ""}
        <div class="flex border-b border-gray-200 px-4 gap-4 text-[10px] font-black uppercase">
          <button type="button" data-rsq-tab="queue" class="py-2 ${tabCls("queue")}">Queue</button>
          <button type="button" data-rsq-tab="audit" class="py-2 ${tabCls("audit")}">Audit History</button>
        </div>
        ${body}
      </div>
    </div>`;

  wirePanel(mount);
  if (activeTab === "audit") initAuditPanel(mount.querySelector("#rsqAuditMount"), auditReservationFilter || undefined);
}

async function reload() {
  [rows, summary] = await Promise.all([
    fetchMarketplaceRestockQueue({ queueBucket: activeBucket, limit: 100 }),
    fetchMarketplaceRestockQueueSummary(),
  ]);
  renderPanel();
}

/** @param {HTMLElement} mount */
function wirePanel(mount) {
  mount.querySelector("[data-rsq-close]")?.addEventListener("click", closeModal);

  mount.querySelectorAll("[data-rsq-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.getAttribute("data-rsq-tab") || "queue";
      if (activeTab === "queue") auditReservationFilter = null;
      renderPanel();
    });
  });

  mount.querySelectorAll("[data-rsq-filter]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      activeBucket = btn.getAttribute("data-rsq-filter") || "ready_to_restock";
      selected = new Set();
      await reload();
    });
  });

  mount.querySelectorAll("[data-rsq-select]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const row = rows[Number(cb.getAttribute("data-rsq-select"))];
      if (!row) return;
      if (cb.checked) selected.add(row.reservationId);
      else selected.delete(row.reservationId);
    });
  });

  const targets = () => rows.filter((r) => selected.has(r.reservationId));
  const bind = (sel, fn) => {
    mount.querySelector(`[${sel}]`)?.addEventListener("click", async () => {
      try {
        await fn();
      } catch (err) {
        showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
      }
    });
  };
  const bindRow = (attr, fn) => {
    mount.querySelectorAll(`[${attr}]`).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = rows[Number(btn.getAttribute(attr))];
        if (!row) return;
        try {
          await fn(row);
          await reload();
        } catch (err) {
          showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
        }
      });
    });
  };

  bind("data-rsq-batch-review", async () => {
    const t = targets();
    if (!t.length) return showInventoryToast("Select rows first.", { variant: "error" });
    for (const row of t) await actionReview(row);
    showInventoryToast(`Reviewed ${t.length} row(s).`, { variant: "success" });
    await reload();
  });
  bind("data-rsq-batch-snooze", async () => {
    const t = targets();
    if (!t.length) return showInventoryToast("Select rows first.", { variant: "error" });
    const hours = promptSnoozeHours();
    if (hours == null) return;
    for (const row of t) await actionSnooze(row, hours);
    showInventoryToast(`Snoozed ${t.length} row(s).`, { variant: "success" });
    await reload();
  });
  bind("data-rsq-batch-unsnooze", async () => {
    const t = targets();
    if (!t.length) return showInventoryToast("Select rows first.", { variant: "error" });
    for (const row of t) await actionUnsnooze(row);
    showInventoryToast(`Unsnoozed ${t.length} row(s).`, { variant: "success" });
    await reload();
  });
  bind("data-rsq-batch-refresh", async () => {
    const t = targets();
    if (!t.length) return showInventoryToast("Select rows first.", { variant: "error" });
    await batchRefreshObs(t);
    await reload();
  });

  bindRow("data-rsq-review", async (row) => {
    await actionReview(row);
    showInventoryToast("Marked reviewed.", { variant: "success" });
  });
  bindRow("data-rsq-snooze", async (row) => {
    const hours = promptSnoozeHours();
    if (hours == null) return;
    await actionSnooze(row, hours);
    showInventoryToast(`Snoozed ${hours}h.`, { variant: "success" });
  });
  bindRow("data-rsq-unsnooze", async (row) => {
    await actionUnsnooze(row);
    showInventoryToast("Unsnoozed.", { variant: "success" });
  });
  bindRow("data-rsq-note", async (row) => {
    const note = window.prompt("Triage note:");
    if (note === null) return;
    await upsertMarketplaceRestockQueueState({
      reservationId: row.reservationId,
      observationId: row.observationId,
      status: row.isActivelySnoozed ? "snoozed" : row.triageStatus || "open",
      snoozedUntil: row.triageSnoozedUntil,
      note: note.trim() || null,
    });
    showInventoryToast("Note saved.", { variant: "success" });
  });
  bindRow("data-rsq-view-audit", async (row) => {
    auditReservationFilter = row.reservationId;
    activeTab = "audit";
    renderPanel();
  });
  bindRow("data-rsq-physical", actionPhysicalReturn);
  bindRow("data-rsq-rma", actionCreateRma);
  bindRow("data-rsq-refresh", actionRefreshObs);
  bindRow("data-rsq-restock", async (row) => {
    if (await actionRestock(row, row.suggestedRestockQty ?? row.maxRestockableQty)) await reload();
  });
  bindRow("data-rsq-skip", actionSkip);
}

/** @param {Object} [opts] @param {string} [opts.initialBucket] @param {string} [opts.initialTab] */
export async function openMarketplaceRestockAssistQueueModal(opts = {}) {
  activeBucket = opts.initialBucket || "ready_to_restock";
  activeTab = opts.initialTab || "queue";
  selected = new Set();
  auditReservationFilter = null;
  document.body.classList.add("overflow-hidden");
  const mount = getDom().restockAssistQueueModalMount;
  if (!mount) return;
  mount.innerHTML = `<p class="p-4 text-sm text-gray-500">Loading queue…</p>`;
  try {
    await reload();
  } catch (err) {
    mount.innerHTML = `<p class="p-4 text-sm text-red-700">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}
