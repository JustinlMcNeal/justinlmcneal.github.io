import { qs } from "./dom.js";
import { fetchAmazonSyncRunErrors, fetchAmazonSyncRuns } from "./api.js";
import {
  buildSyncRunDetailMessage,
  buildSyncRunErrorList,
  renderSyncRunTableRows,
} from "./renderSyncRuns.js";

/** @type {Set<string>} */
const expandedRunIds = new Set();

/** @type {Map<string, string>} */
const detailHtmlCache = new Map();

function applyFilters(runs, filters) {
  return runs.filter((run) => {
    if (filters.syncType && String(run.sync_type) !== filters.syncType) return false;
    if (filters.status && String(run.status) !== filters.status) return false;
    return true;
  });
}

async function loadRunDetail(runId) {
  if (detailHtmlCache.has(runId)) {
    return detailHtmlCache.get(runId);
  }

  try {
    const errors = await fetchAmazonSyncRunErrors(runId);
    const html = buildSyncRunErrorList(errors);
    detailHtmlCache.set(runId, html);
    return html;
  } catch {
    return buildSyncRunDetailMessage("Could not load sync errors.");
  }
}

/**
 * @param {HTMLElement | null} panel
 * @param {Array<Record<string, unknown>>} runs
 */
function renderTable(panel, runs) {
  const tbody = panel?.querySelector("#amazonSyncRunsBody");
  if (!tbody) return;
  tbody.innerHTML = renderSyncRunTableRows(runs, expandedRunIds);
}

export function initAmazonSyncRunHistory() {
  const toggle = qs("#amazonSyncHistoryToggle");
  const panel = qs("#amazonSyncHistoryPanel");
  const typeFilter = qs("#amazonSyncTypeFilter");
  const statusFilter = qs("#amazonSyncStatusFilter");
  /** @type {Array<Record<string, unknown>>} */
  let allRuns = [];
  let panelOpen = false;

  function readFilters() {
    return {
      syncType: typeFilter instanceof HTMLSelectElement ? typeFilter.value : "",
      status: statusFilter instanceof HTMLSelectElement ? statusFilter.value : "",
    };
  }

  function renderFiltered() {
    if (!panelOpen) return;
    renderTable(panel, applyFilters(allRuns, readFilters()));
  }

  async function refresh() {
    allRuns = await fetchAmazonSyncRuns({ limit: 50 });
    detailHtmlCache.clear();
    renderFiltered();
    return allRuns;
  }

  async function openPanel() {
    if (!panel) return;
    panel.classList.remove("hidden");
    panelOpen = true;
    if (toggle) {
      toggle.setAttribute("aria-expanded", "true");
      toggle.textContent = "Hide sync log ▴";
    }
    try {
      await refresh();
    } catch {
      renderTable(panel, []);
      const tbody = panel.querySelector("#amazonSyncRunsBody");
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="11" class="px-3 py-6 text-center text-sm text-red-600">Could not load sync runs.</td></tr>';
      }
    }
  }

  function closePanel() {
    if (!panel) return;
    panel.classList.add("hidden");
    panelOpen = false;
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "View sync log ▾";
    }
  }

  toggle?.addEventListener("click", (event) => {
    event.preventDefault();
    if (panelOpen) closePanel();
    else openPanel().catch(() => {});
  });

  typeFilter?.addEventListener("change", () => renderFiltered());
  statusFilter?.addEventListener("change", () => renderFiltered());

  panel?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const btn = target.closest('[data-action="toggle-sync-run-detail"]');
    if (!(btn instanceof HTMLButtonElement)) return;
    event.preventDefault();

    const runId = btn.dataset.syncRunId || "";
    if (!runId) return;

    const detailRow = panel.querySelector(`[data-sync-run-detail-for="${runId}"]`);
    const detailBody = panel.querySelector(`[data-sync-run-detail-body="${runId}"]`);
    if (!detailRow || !detailBody) return;

    if (expandedRunIds.has(runId)) {
      expandedRunIds.delete(runId);
      detailRow.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
      btn.textContent = "Details";
      return;
    }

    expandedRunIds.add(runId);
    detailRow.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
    btn.textContent = "Hide";
    detailBody.innerHTML = buildSyncRunDetailMessage("Loading errors…");
    detailBody.innerHTML = await loadRunDetail(runId);
  });

  return {
    refresh: async () => {
      const runs = await refresh();
      return runs;
    },
    open: () => openPanel(),
    close: closePanel,
  };
}
