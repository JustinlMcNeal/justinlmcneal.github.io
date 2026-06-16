/**
 * Returns & Restock Dashboard modal (Phase 10U–10X — paginated workbench; no stock mutations).
 */

import { getDom } from "../dom.js";
import { esc } from "../utils/formatters.js";
import {
  fetchReturnsRestockDashboardSummary,
  fetchReturnsRestockDashboardMetrics,
} from "../api/returnsRestockDashboardApi.js";
import { renderDashboardKpiStrip } from "./returnsRestockDashboardKpi.js";
import {
  openOrderLine,
  openBundleReturns,
  openRestockQueueForRow,
  openFollowUpForRow,
  openSyncPreviewForRow,
  markRowReviewed,
  snoozeRow,
} from "./returnsRestockDashboardActions.js";
import { buildDashboardUrl, replaceDashboardUrl } from "./returnsRestockDashboardDeepLink.js";
import { loadAllPresets, promptSaveCurrentPreset, renderPresetButtonsHtml } from "./returnsRestockDashboardPresets.js";
import { renderWorklistHtml } from "./returnsRestockDashboardGrouping.js";
import {
  exportWorklist,
  exportFilteredWorklist,
  exportAuditHistory,
  exportOpenFollowups,
  exportDashboardMetrics,
} from "./returnsRestockDashboardExport.js";
import {
  loadWorklistPage,
  hasTargetKeys,
  resolveTargetHighlight,
  channelOptionsFromBuckets,
  statusOptionsFromBuckets,
} from "./returnsRestockDashboardPage.js";
import { renderPaginationBar, tabCountLabel } from "./returnsRestockDashboardPagination.js";
import { showInventoryToast } from "../events.js";

const TABS = [
  { id: "worklist", label: "Worklist" },
  { id: "ready", label: "Ready to Restock" },
  { id: "returns", label: "Returns / RMA" },
  { id: "followup", label: "Channel Follow-Ups" },
  { id: "audit", label: "Audit" },
];

/** @type {import('./returnsRestockDashboardPresets.js').DashboardFilterState & { groupedView?: boolean; pageSize?: number; offset?: number }} */
let state = defaultState();
/** @type {Awaited<ReturnType<typeof fetchReturnsRestockDashboardSummary>>|null} */
let summary = null;
/** @type {Awaited<ReturnType<typeof fetchReturnsRestockDashboardMetrics>>|null} */
let metrics = null;
/** @type {Awaited<ReturnType<typeof loadWorklistPage>>|null} */
let pageMeta = null;
/** @type {Awaited<ReturnType<typeof loadWorklistPage>>["rows"]} */
let rows = [];
/** @type {string|null} */
let highlightRowId = null;
/** @type {string|null} */
let notFoundMessage = null;
/** @type {boolean} */
let showLoadTarget = false;
/** @type {number|null} */
let targetOffset = null;
/** @type {boolean} */
let seekApplied = false;

function defaultState() {
  return {
    tab: "worklist",
    channel: "",
    status: "",
    search: "",
    staleOnly: false,
    priorityMax: "",
    rowType: "",
    reservationId: "",
    orderId: "",
    observationId: "",
    restockActionId: "",
    groupedView: true,
    pageSize: 50,
    offset: 0,
  };
}

function closeModal() {
  getDom().returnsRestockDashboardModalMount.innerHTML = "";
  document.body.classList.remove("overflow-hidden");
}

function readFiltersFromMount(mount) {
  return {
    ...state,
    channel: mount.querySelector("[data-rrd-filter-channel]")?.value || "",
    status: mount.querySelector("[data-rrd-filter-status]")?.value || "",
    search: mount.querySelector("[data-rrd-filter-search]")?.value?.trim() || "",
    staleOnly: Boolean(mount.querySelector("[data-rrd-filter-stale]")?.checked),
    priorityMax: mount.querySelector("[data-rrd-filter-priority]")?.value || "",
    groupedView: Boolean(mount.querySelector("[data-rrd-grouped]")?.checked),
    pageSize: Number(mount.querySelector("[data-rrd-page-size]")?.value) || state.pageSize || 50,
  };
}

function syncUrl() {
  replaceDashboardUrl(state);
}

function wireRowActions(mount, list) {
  const on = (attr, fn) => {
    mount.querySelectorAll(`[${attr}]`).forEach((el) => {
      el.addEventListener("click", async () => {
        const row = list[Number(el.getAttribute(attr))];
        if (!row) return;
        try {
          await fn(row);
        } catch (err) {
          showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
        }
      });
    });
  };
  on("data-rrd-order", openOrderLine);
  on("data-rrd-bundle", openBundleReturns);
  on("data-rrd-queue", openRestockQueueForRow);
  on("data-rrd-followup", openFollowUpForRow);
  on("data-rrd-sync", openSyncPreviewForRow);
  on("data-rrd-reviewed", async (row) => {
    await markRowReviewed(row);
    await reload(false);
  });
  on("data-rrd-snooze", async (row) => {
    await snoozeRow(row);
    await reload(false);
  });
}

function scrollToHighlight(mount) {
  if (!highlightRowId) return;
  mount.querySelector(`[data-rrd-row-id="${CSS.escape(highlightRowId)}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function wirePagination(mount) {
  mount.querySelector("[data-rrd-prev]")?.addEventListener("click", async () => {
    if (pageMeta?.prevOffset == null) return;
    state = { ...state, offset: pageMeta.prevOffset };
    syncUrl();
    await reload(false);
  });
  mount.querySelector("[data-rrd-next]")?.addEventListener("click", async () => {
    if (pageMeta?.nextOffset == null) return;
    state = { ...state, offset: pageMeta.nextOffset };
    syncUrl();
    await reload(false);
  });
  mount.querySelector("[data-rrd-page-size]")?.addEventListener("change", async (e) => {
    state = { ...state, pageSize: Number(e.target.value) || 50, offset: 0 };
    syncUrl();
    await reload(false);
  });
  mount.querySelector("[data-rrd-load-target]")?.addEventListener("click", async () => {
    if (targetOffset == null) return;
    state = { ...state, offset: targetOffset };
    syncUrl();
    await reload(true);
  });
}

function renderBody() {
  const mount = getDom().returnsRestockDashboardModalMount;
  if (!mount?.firstElementChild || !pageMeta) return;

  const kpiHost = mount.querySelector("[data-rrd-kpi]");
  if (kpiHost && summary) kpiHost.innerHTML = renderDashboardKpiStrip(summary, metrics);

  const buckets = pageMeta.bucketCounts;
  const tabsEl = mount.querySelector("[data-rrd-tabs]");
  if (tabsEl) {
    tabsEl.innerHTML = TABS.map(
      (t) =>
        `<button type="button" data-rrd-tab="${t.id}" class="px-3 py-1.5 text-[10px] font-black uppercase border-b-2 ${
          state.tab === t.id ? "border-indigo-700 text-indigo-900" : "border-transparent text-gray-500"
        }">${esc(t.label)}${esc(tabCountLabel(t.id, buckets))}</button>`,
    ).join("");
    tabsEl.querySelectorAll("[data-rrd-tab]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state = { ...state, tab: btn.getAttribute("data-rrd-tab") || "worklist", offset: 0 };
        syncUrl();
        await reload(false);
      });
    });
  }

  const bannerEl = mount.querySelector("[data-rrd-banner]");
  if (bannerEl) {
    let html = "";
    if (notFoundMessage) {
      html += `<div class="mx-4 mt-2 flex items-start gap-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-300 rounded px-3 py-2">
        <p class="flex-1">${esc(notFoundMessage)}</p>
        <button type="button" data-rrd-dismiss-banner class="text-amber-700 hover:text-amber-950 font-black leading-none" aria-label="Dismiss">×</button>
      </div>`;
    }
    bannerEl.innerHTML = html;
    bannerEl.querySelector("[data-rrd-dismiss-banner]")?.addEventListener("click", () => {
      notFoundMessage = null;
      bannerEl.innerHTML = "";
    });
  }

  const listEl = mount.querySelector("[data-rrd-list]");
  if (listEl) {
    listEl.innerHTML = rows.length
      ? renderWorklistHtml(rows, state.groupedView !== false, highlightRowId)
      : `<p class="p-4 text-sm text-gray-500">No rows match filters.</p>`;
  }

  const countEl = mount.querySelector("[data-rrd-count]");
  if (countEl) countEl.textContent = `${pageMeta.totalCount} total`;

  const pagEl = mount.querySelector("[data-rrd-pagination]");
  if (pagEl) pagEl.outerHTML = renderPaginationBar(pageMeta, state.pageSize ?? 50);

  const loadBtn = mount.querySelector("[data-rrd-load-target]");
  if (loadBtn) {
    if (showLoadTarget) {
      loadBtn.classList.remove("hidden");
    } else {
      loadBtn.classList.add("hidden");
    }
  }

  wireRowActions(mount, rows);
  wirePagination(mount);
  scrollToHighlight(mount);
}

async function reload(seekTarget) {
  const doSeek = seekTarget || (hasTargetKeys(state) && !seekApplied);
  [summary, metrics, pageMeta] = await Promise.all([
    fetchReturnsRestockDashboardSummary(),
    fetchReturnsRestockDashboardMetrics().catch(() => null),
    loadWorklistPage(state, { seekTarget: doSeek }),
  ]);
  rows = pageMeta.rows;
  state = { ...state, offset: pageMeta.offset };
  if (doSeek) seekApplied = true;

  const resolved = resolveTargetHighlight(pageMeta, state, doSeek);
  highlightRowId = resolved.highlightRowId;
  notFoundMessage = resolved.notFoundMessage;
  showLoadTarget = resolved.showLoadTarget;
  targetOffset = resolved.targetOffset ?? pageMeta.targetOffset;
  if (resolved.offset != null) state.offset = resolved.offset;

  renderBody();
}

function presetsHtml() {
  return renderPresetButtonsHtml(esc);
}

async function runExport(fn) {
  try {
    await fn();
  } catch (err) {
    showInventoryToast(err instanceof Error ? err.message : String(err), { variant: "error" });
  }
}

function shellHtml() {
  const channels = channelOptionsFromBuckets(pageMeta?.bucketCounts);
  const statuses = statusOptionsFromBuckets(pageMeta?.bucketCounts);
  return `
    <div class="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 p-4 overflow-y-auto" data-rrd-modal>
      <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl my-4 flex flex-col max-h-[92vh]" role="dialog" aria-label="Returns and Restock Dashboard">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h2 class="text-sm font-black uppercase tracking-wide text-gray-900">Returns &amp; Restock Dashboard</h2>
            <p class="text-[10px] text-gray-500">Server-paginated workbench — restock via Restock Assist Queue or Bundle panel.</p>
          </div>
          <button type="button" data-rrd-close class="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close dashboard">×</button>
        </div>
        <div data-rrd-kpi></div>
        <div data-rrd-presets class="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-1">${presetsHtml()}</div>
        <div class="px-4 py-2 border-b border-gray-200 flex flex-wrap gap-2 items-end">
          <label class="text-[9px] font-black uppercase text-gray-500">Channel
            <select data-rrd-filter-channel class="block border rounded text-[11px] mt-0.5 min-w-[90px]">
              <option value="">All</option>
              ${channels.map((c) => `<option value="${esc(c)}" ${state.channel === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
            </select>
          </label>
          <label class="text-[9px] font-black uppercase text-gray-500">Status
            <select data-rrd-filter-status class="block border rounded text-[11px] mt-0.5 min-w-[120px]">
              <option value="">All</option>
              ${statuses.map((s) => `<option value="${esc(s)}" ${state.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
            </select>
          </label>
          <label class="text-[9px] font-black uppercase text-gray-500">SKU / title
            <input data-rrd-filter-search type="search" value="${esc(state.search)}" class="block border rounded text-[11px] mt-0.5 min-w-[120px]" placeholder="Search…" />
          </label>
          <label class="text-[9px] font-black uppercase text-gray-500">Priority ≤
            <input data-rrd-filter-priority type="number" min="1" max="999" value="${esc(state.priorityMax)}" class="block border rounded text-[11px] mt-0.5 w-16" />
          </label>
          <label class="text-[9px] font-black uppercase text-gray-500 flex items-center gap-1 pb-1">
            <input data-rrd-filter-stale type="checkbox" ${state.staleOnly ? "checked" : ""} /> Stale
          </label>
          <label class="text-[9px] font-black uppercase text-gray-500 flex items-center gap-1 pb-1">
            <input data-rrd-grouped type="checkbox" ${state.groupedView !== false ? "checked" : ""} /> Grouped
          </label>
          <button type="button" data-rrd-apply-filters class="text-[9px] font-black uppercase border px-2 py-1 rounded bg-indigo-50 text-indigo-900">Apply</button>
          <button type="button" data-rrd-clear-filters class="text-[9px] font-black uppercase text-gray-600 hover:underline">Clear</button>
          <button type="button" data-rrd-copy-link class="text-[9px] font-black uppercase text-sky-800 hover:underline">Copy Link</button>
          <button type="button" data-rrd-save-preset class="text-[9px] font-black uppercase text-violet-800 hover:underline">Save Preset</button>
        </div>
        <div class="px-4 py-1 border-b border-gray-100 flex flex-wrap gap-2">
          <button type="button" data-rrd-export-worklist class="text-[8px] font-black uppercase border px-2 py-0.5 rounded" title="Current page only">Copy Page</button>
          <button type="button" data-rrd-download-worklist class="text-[8px] font-black uppercase border px-2 py-0.5 rounded" title="Current page only">CSV Page</button>
          <button type="button" data-rrd-export-filtered class="text-[8px] font-black uppercase border px-2 py-0.5 rounded" title="All filtered rows up to 2,000">CSV Filtered</button>
          <button type="button" data-rrd-export-audit class="text-[8px] font-black uppercase border px-2 py-0.5 rounded">Copy Audit</button>
          <button type="button" data-rrd-export-followups class="text-[8px] font-black uppercase border px-2 py-0.5 rounded">Copy Follow-Ups</button>
          <button type="button" data-rrd-export-metrics class="text-[8px] font-black uppercase border px-2 py-0.5 rounded">Copy Metrics</button>
          <button type="button" data-rrd-preview-digest class="text-[8px] font-black uppercase border-2 border-violet-600 text-violet-900 px-2 py-0.5 rounded bg-violet-50">Preview Digest</button>
          <span data-rrd-count class="text-[9px] text-gray-500 ml-auto self-center"></span>
        </div>
        <div data-rrd-tabs class="px-4 flex gap-1 border-b border-gray-200"></div>
        <div data-rrd-banner></div>
        <div data-rrd-list class="flex-1 overflow-y-auto min-h-[200px]"></div>
        ${pageMeta ? renderPaginationBar(pageMeta, state.pageSize ?? 50) : ""}
      </div>
    </div>`;
}

function wireShellEvents(mount) {
  mount.querySelector("[data-rrd-close]")?.addEventListener("click", closeModal);
  mount.querySelector("[data-rrd-modal]")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  mount.querySelector("[data-rrd-apply-filters]")?.addEventListener("click", async () => {
    state = { ...readFiltersFromMount(mount), offset: 0 };
    seekApplied = false;
    syncUrl();
    await reload(hasTargetKeys(state));
  });

  mount.querySelector("[data-rrd-clear-filters]")?.addEventListener("click", async () => {
    state = { ...defaultState(), tab: state.tab, groupedView: state.groupedView, pageSize: state.pageSize };
    highlightRowId = null;
    notFoundMessage = null;
    seekApplied = false;
    const ch = mount.querySelector("[data-rrd-filter-channel]");
    const st = mount.querySelector("[data-rrd-filter-status]");
    const sr = mount.querySelector("[data-rrd-filter-search]");
    const pr = mount.querySelector("[data-rrd-filter-priority]");
    const sl = mount.querySelector("[data-rrd-filter-stale]");
    if (ch) ch.value = "";
    if (st) st.value = "";
    if (sr) sr.value = "";
    if (pr) pr.value = "";
    if (sl) sl.checked = false;
    syncUrl();
    await reload(false);
  });

  mount.querySelector("[data-rrd-copy-link]")?.addEventListener("click", async () => {
    state = readFiltersFromMount(mount);
    try {
      await navigator.clipboard.writeText(buildDashboardUrl(state, { absolute: true }));
      showInventoryToast("Dashboard link copied.", { variant: "success" });
    } catch {
      showInventoryToast("Could not copy link.", { variant: "error" });
    }
  });

  mount.querySelector("[data-rrd-save-preset]")?.addEventListener("click", () => {
    state = readFiltersFromMount(mount);
    const saved = promptSaveCurrentPreset(state);
    if (saved) {
      showInventoryToast(`Saved preset “${saved.label}”.`, { variant: "success" });
      const bar = mount.querySelector("[data-rrd-presets]");
      if (bar) {
        bar.innerHTML = presetsHtml();
        bar.querySelectorAll("[data-rrd-preset]").forEach((btn) => wirePresetButton(btn));
      }
    }
  });

  mount.querySelectorAll("[data-rrd-preset]").forEach((btn) => wirePresetButton(btn));

  const exportActions = [
    ["[data-rrd-export-worklist]", () => exportWorklist(rows, "copy", "current page")],
    ["[data-rrd-download-worklist]", () => exportWorklist(rows, "download", "current page")],
    ["[data-rrd-export-filtered]", () => exportFilteredWorklist(state, "download")],
    ["[data-rrd-export-audit]", () => exportAuditHistory("copy")],
    ["[data-rrd-export-followups]", () => exportOpenFollowups("copy")],
    ["[data-rrd-export-metrics]", () => {
      if (!metrics) throw new Error("Metrics not loaded");
      return exportDashboardMetrics(metrics, "copy");
    }],
  ];
  for (const [sel, fn] of exportActions) {
    mount.querySelector(sel)?.addEventListener("click", () => runExport(fn));
  }

  mount.querySelector("[data-rrd-preview-digest]")?.addEventListener("click", () => {
    import("./returnsRestockDigestPreview.js").then((mod) => mod.openReturnsRestockDigestPreview("daily"));
  });
}

function wirePresetButton(btn) {
  btn.addEventListener("click", async () => {
    const preset = loadAllPresets().find((p) => p.id === btn.getAttribute("data-rrd-preset"));
    if (!preset) return;
    state = {
      ...state,
      tab: preset.tab,
      channel: preset.channel,
      status: preset.status,
      search: preset.search,
      staleOnly: preset.staleOnly,
      priorityMax: preset.priorityMax,
      rowType: preset.rowType,
      offset: 0,
    };
    seekApplied = false;
    syncUrl();
    await reload(false);
  });
}

/** @param {Partial<import('./returnsRestockDashboardPresets.js').DashboardFilterState> & { groupedView?: boolean; pageSize?: number; offset?: number }} [opts] */
export async function openReturnsRestockDashboardModal(opts = {}) {
  const mount = getDom().returnsRestockDashboardModalMount;
  if (!mount) {
    showInventoryToast("Dashboard mount missing.", { variant: "error" });
    return;
  }

  state = {
    ...defaultState(),
    tab: opts.tab || "worklist",
    channel: opts.channel ?? "",
    status: opts.status ?? "",
    search: opts.search ?? "",
    staleOnly: opts.staleOnly ?? false,
    priorityMax: opts.priorityMax ?? "",
    rowType: opts.rowType ?? "",
    reservationId: opts.reservationId ?? "",
    orderId: opts.orderId ?? "",
    observationId: opts.observationId ?? "",
    restockActionId: opts.restockActionId ?? "",
    groupedView: opts.groupedView !== false,
    pageSize: opts.pageSize ?? 50,
    offset: opts.offset ?? 0,
  };
  highlightRowId = null;
  notFoundMessage = null;
  showLoadTarget = false;
  targetOffset = null;
  seekApplied = false;
  pageMeta = null;
  rows = [];

  mount.innerHTML = `<p class="p-4 text-sm text-gray-500">Loading dashboard…</p>`;
  document.body.classList.add("overflow-hidden");

  try {
    await reload(hasTargetKeys(state));
    mount.innerHTML = shellHtml();
    wireShellEvents(mount);
    syncUrl();
    renderBody();
  } catch (err) {
    mount.innerHTML = `<p class="p-4 text-red-700">${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}
