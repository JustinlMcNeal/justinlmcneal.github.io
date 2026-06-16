/**
 * Client-side events for inventory admin — tabs, filters, alert pills.
 */

import { getDom } from "./dom.js";
import { FILTER_OPTIONS } from "./mockData.js";
import { state, setLedgerFilter, findIssueByType } from "./state.js";
import { ALERT_FILTER_MAP } from "./services/buildAlerts.js";
import { filterInventoryRows, computeTabCounts } from "./services/filterInventory.js";
import { renderInventoryTable, renderTableSummary } from "./renderers/renderInventoryTable.js";
import { renderLedger } from "./renderers/renderLedger.js";
import { renderIssues } from "./renderers/renderIssues.js";
import { esc } from "./utils/formatters.js";
import { RECEIVE_STOCK_URL, RECEIVE_STOCK_TOOLTIP } from "./constants/parcelLinks.js";

/** @typedef {'all'|'lowStock'|'unmapped'|'issues'} InventoryTab */

/** @type {InventoryTab} */
let activeTab = "all";

/** @type {Record<string, string>} */
let filters = {
  search: "",
  status: "",
  channel: "",
  inventoryState: "",
  category: "",
  syncState: "",
  issueType: "",
  sortBy: "updated_desc",
};

const ALERT_TONES = {
  violet: "bg-violet-100 border-violet-300 text-violet-900",
  orange: "bg-orange-100 border-orange-300 text-orange-900",
  purple: "bg-purple-100 border-purple-300 text-purple-900",
  yellow: "bg-yellow-100 border-yellow-300 text-yellow-900",
  blue: "bg-blue-100 border-blue-300 text-blue-900",
  amber: "bg-amber-100 border-amber-300 text-amber-900",
};

function showToast(message, opts = {}) {
  showInventoryToast(message, opts);
}

/** @param {string} message @param {{ variant?: 'success'|'error'|'info' }} [opts] */
export function showInventoryToast(message, opts = {}) {
  const { statusToast } = getDom();
  if (!statusToast) return;

  const variant = opts.variant || "info";
  statusToast.textContent = message;
  statusToast.classList.remove("hidden");

  statusToast.classList.remove(
    "border-gray-800",
    "bg-gray-900",
    "text-white",
    "border-red-700",
    "bg-red-50",
    "text-red-900",
    "border-green-700",
    "bg-green-50",
    "text-green-900",
  );

  if (variant === "error") {
    statusToast.classList.add("border-red-700", "bg-red-50", "text-red-900");
  } else if (variant === "success") {
    statusToast.classList.add("border-green-700", "bg-green-50", "text-green-900");
  } else {
    statusToast.classList.add("border-gray-800", "bg-gray-900", "text-white");
  }

  window.clearTimeout(showInventoryToast._timer);
  showInventoryToast._timer = window.setTimeout(() => {
    statusToast.classList.add("hidden");
  }, variant === "error" ? 5000 : 3200);
}

function getSourceRows() {
  return state.inventoryRows;
}

function getFilteredRows() {
  return filterInventoryRows(getSourceRows(), activeTab, filters);
}

export function refreshInventoryLedger() {
  const { ledgerMount } = getDom();
  renderLedger(ledgerMount, state.ledgerEntries, {
    loading: state.ledgerLoading,
    error: state.ledgerError,
    isLive: state.ledgerLive,
    filter: state.ledgerFilter,
  });
}

export function refreshInventoryTable() {
  const rows = getFilteredRows();
  const { tableMount, tableSummaryMount, emptyState } = getDom();

  renderInventoryTable(tableMount, rows, {
    loading: state.workspaceLoading,
    error: state.workspaceError,
    isLive: state.workspaceLive,
  });

  renderTableSummary(tableSummaryMount, {
    tracked: rows.length,
    lowStock: rows.filter((r) => r.status === "low").length,
    unmapped: rows.filter((r) => r.unmapped).length,
    issues: rows.filter((r) => r.hasIssue).length,
  });

  if (emptyState) {
    emptyState.classList.toggle("hidden", rows.length > 0 || state.workspaceLoading);
  }
}

function updateTabUi() {
  const { tabList } = getDom();
  if (!tabList) return;
  tabList.querySelectorAll("[data-inventory-tab]").forEach((btn) => {
    const tab = btn.getAttribute("data-inventory-tab");
    const selected = tab === activeTab;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
    btn.tabIndex = selected ? 0 : -1;
    btn.className = selected
      ? "flex flex-col items-start px-3 py-2.5 rounded-xl border-4 border-black bg-black text-white text-left min-h-[44px]"
      : "flex flex-col items-start px-3 py-2.5 rounded-xl border-2 border-black bg-white text-black text-left min-h-[44px] hover:bg-gray-50";
  });
}

export function renderInventoryAlerts() {
  const { alertsMount } = getDom();
  if (!alertsMount) return;

  if (state.issuesLoading) {
    alertsMount.innerHTML = `<p class="text-xs text-gray-400" role="status">Loading alerts…</p>`;
    return;
  }

  const alerts = state.alerts ?? [];
  if (!alerts.length) {
    alertsMount.innerHTML = `<p class="text-xs text-gray-400">No open inventory alerts.</p>`;
    return;
  }

  if (state.issuesError && !state.issuesLive) {
    alertsMount.innerHTML = `<p class="text-xs text-amber-700" role="alert">Alerts unavailable (${esc(state.issuesError)}).</p>`;
    return;
  }

  alertsMount.innerHTML = alerts
    .map((alert) => {
      const tone = ALERT_TONES[alert.tone] || ALERT_TONES.violet;
      return `<button type="button" data-inventory-alert="${esc(alert.id)}" class="inline-flex items-center rounded-full border px-3 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-[.08em] ${tone} hover:opacity-90 min-h-[36px]">${esc(alert.label)}</button>`;
    })
    .join("");
}

export function refreshIssuesPanel() {
  const { issuesMount } = getDom();
  renderIssues(issuesMount, state.issueRows, {
    loading: state.issuesLoading,
    error: state.issuesError,
    isLive: state.issuesLive,
    workflowFilter: state.issuesWorkflowFilter,
    postMapQueueCount: state.postMapQueueActiveCount,
  });
  renderInventoryAlerts();
}

/** @param {string} alertId */
export function applyAlertFilter(alertId) {
  const mapping = ALERT_FILTER_MAP[alertId];
  if (!mapping) return;

  const alert = state.alerts?.find((a) => a.id === alertId);
  if (alertId === "channel-sync-failed" || alertId === "ebay-cache-missing") {
    import("./ui/syncDryRunModal.js").then((mod) => mod.openSyncDryRunModal());
    return;
  }
  if (alert?.navigateUrl) {
    location.assign(alert.navigateUrl);
    return;
  }

  applyIssueTableFilter(mapping);
}

/**
 * @param {{ tab?: string, issueType?: string, inventoryState?: string }} filter
 */
export function applyIssueTableFilter(filter) {
  if (filter.tab) activeTab = /** @type {InventoryTab} */ (filter.tab);
  if ("issueType" in filter) filters.issueType = filter.issueType || "";
  if ("inventoryState" in filter) filters.inventoryState = filter.inventoryState || "";

  renderInventoryTabs();
  renderFilters();
  updateTabUi();
  refreshInventoryTable();

  const { issuesMount } = getDom();
  if (issuesMount) {
    issuesMount.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function selectOptions(key) {
  return FILTER_OPTIONS[key]
    .map((opt) => `<option value="${opt.value}">${opt.label}</option>`)
    .join("");
}

function renderFilters() {
  const { filtersMount } = getDom();
  if (!filtersMount) return;

  filtersMount.innerHTML = `
    <div class="flex flex-col gap-3">
      <div class="flex-1">
        <label for="inventorySearchInput" class="block text-[9px] sm:text-[10px] font-black uppercase tracking-[.18em] mb-1 sm:mb-2 text-gray-500">Search Inventory</label>
        <div class="relative">
          <input id="inventorySearchInput" type="search" value="${filters.search.replace(/"/g, "&quot;")}" placeholder="Search by product title, internal SKU, or ASIN / eBay ID..." class="w-full border-4 border-black px-3 sm:px-4 py-2.5 sm:py-3 text-base sm:text-sm outline-none pr-10 bg-white" />
          <svg class="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>
      </div>
      <div class="flex flex-wrap items-end gap-2 sm:gap-3">
        ${filterSelect("inventoryStatusFilter", "Status", "status")}
        ${filterSelect("inventoryChannelFilter", "Channel", "channel")}
        ${filterSelect("inventoryStateFilter", "Inventory State", "inventoryState")}
        ${filterSelect("inventoryCategoryFilter", "Category", "category")}
        ${filterSelect("inventorySyncFilter", "Sync State", "syncState")}
        ${filterSelect("inventoryIssueFilter", "Issue Type", "issueType")}
        ${filterSelect("inventorySortFilter", "Sort By", "sortBy")}
        <button type="button" id="inventoryFilterSettingsBtn" title="Filter settings (placeholder)" class="inline-flex items-center justify-center border-2 border-black bg-white text-black w-11 h-11 min-h-[44px] hover:bg-gray-50 shrink-0" aria-label="Filter settings">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        </button>
      </div>
    </div>
  `;

  wireFilterInputs();
}

function filterSelect(id, label, key) {
  return `
    <div class="flex flex-col gap-1 min-w-[120px] flex-1 sm:flex-none">
      <label for="${id}" class="text-[9px] font-black uppercase tracking-[.14em] text-gray-500">${label}</label>
      <select id="${id}" data-filter-key="${key}" class="border-2 border-black px-2 py-2 text-xs font-bold bg-white w-full min-h-[44px]">${selectOptions(key)}</select>
    </div>
  `;
}

function wireFilterInputs() {
  const search = document.getElementById("inventorySearchInput");
  search?.addEventListener("input", () => {
    filters.search = search.value;
    refreshInventoryTable();
  });

  document.querySelectorAll("[data-filter-key]").forEach((el) => {
    const key = el.getAttribute("data-filter-key");
    if (key && key in filters) el.value = filters[key];
    el.addEventListener("change", () => {
      if (key && key in filters) {
        filters[key] = el.value;
        refreshInventoryTable();
      }
    });
  });

  document.getElementById("inventoryFilterSettingsBtn")?.addEventListener("click", () => {
    showToast("Filter settings are not wired yet.");
  });
}

export function renderInventoryTabs() {
  const { tabList } = getDom();
  if (!tabList) return;

  const counts = computeTabCounts(getSourceRows());
  const tabs = [
    { id: "all", label: "All Inventory", count: counts.all },
    { id: "lowStock", label: "Low Stock", count: counts.lowStock },
    { id: "unmapped", label: "Unmapped", count: counts.unmapped },
    { id: "issues", label: "Issues", count: counts.issues },
  ];

  tabList.innerHTML = tabs
    .map((tab) => {
      const selected = tab.id === activeTab;
      const cls = selected
        ? "flex flex-col items-start px-3 py-2.5 rounded-xl border-4 border-black bg-black text-white text-left min-h-[44px]"
        : "flex flex-col items-start px-3 py-2.5 rounded-xl border-2 border-black bg-white text-black text-left min-h-[44px] hover:bg-gray-50";
      return `
      <button type="button" role="tab" id="inventoryTab${tab.id}" data-inventory-tab="${tab.id}" aria-selected="${selected ? "true" : "false"}" tabindex="${selected ? "0" : "-1"}" class="${cls}">
        <span class="text-[10px] font-black uppercase tracking-[.12em]">${tab.label}</span>
        <span class="text-lg font-black mt-0.5">${tab.count}</span>
      </button>
    `;
    })
    .join("");

  tabList.querySelectorAll("[data-inventory-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = /** @type {InventoryTab} */ (btn.getAttribute("data-inventory-tab"));
      updateTabUi();
      refreshInventoryTable();
    });
  });
}

const PLACEHOLDER_ACTIONS = {
  export: "Export will download CSV when wired.",
  settings: "Inventory settings are planned for a future phase.",
  "view-issue": "Issue detail view is planned for a future phase.",
};

export function initInventoryEvents() {
  renderInventoryTabs();
  renderInventoryAlerts();
  renderFilters();
  refreshInventoryTable();

  getDom().page?.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const issuePrimaryBtn = target.closest("[data-inventory-issue-primary]");
    if (issuePrimaryBtn) {
      const issueType = issuePrimaryBtn.getAttribute("data-inventory-issue-primary");
      const issue = issueType ? findIssueByType(issueType) : undefined;
      if (issue) {
        import("./services/issueActionHandlers.js").then((mod) => mod.executePrimaryIssueAction(issue));
      }
      return;
    }

    const issueDetailBtn = target.closest("[data-inventory-issue-detail]");
    if (issueDetailBtn) {
      const issueType = issueDetailBtn.getAttribute("data-inventory-issue-detail");
      const issue = issueType ? findIssueByType(issueType) : undefined;
      if (issue) {
        import("./ui/issueDetailModal.js").then((mod) => mod.openIssueDetailModal(issue));
      }
      return;
    }

    const mappingAssistBtn = target.closest("[data-inventory-mapping-assist]");
    if (mappingAssistBtn) {
      const issueType = mappingAssistBtn.getAttribute("data-inventory-mapping-assist");
      const issue = issueType ? findIssueByType(issueType) : undefined;
      if (issue) {
        import("./api/issuesApi.js").then(async ({ fetchIssueSamples }) => {
          const samples = await fetchIssueSamples(issue.type, 1);
          const sample = samples[0];
          if (!sample) {
            showInventoryToast("No mapping assist sample available.");
            return;
          }
          const { openMappingAssistModal } = await import("./ui/mappingAssistModal.js");
          await openMappingAssistModal(issue, {
            issueType: issue.type,
            sourceOrderId: sample.sourceOrderId ?? sample.ref ?? null,
            sourceOrderItemId: sample.sourceOrderItemId ?? null,
          });
        });
      }
      return;
    }

    const ebayWorklistBtn = target.closest("[data-inventory-ebay-worklist]");
    if (ebayWorklistBtn) {
      import("./ui/ebayMappingWorklistModal.js").then((mod) => mod.openEbayMappingWorklistModal());
      return;
    }

    const postMapQueueBtn = target.closest("[data-inventory-post-map-queue]");
    if (postMapQueueBtn) {
      import("./ui/postMapQueueModal.js").then((mod) => mod.openPostMapQueueModal());
      return;
    }

    const actionBtn = target.closest("[data-inventory-action]");
    if (actionBtn) {
      const action = actionBtn.getAttribute("data-inventory-action");
      if (action === "adjust-stock") {
        const rowId = actionBtn.getAttribute("data-row-id");
        if (rowId) {
          import("./ui/adjustModal.js").then((mod) => mod.openAdjustModal(rowId));
        }
        return;
      }
      if (action === "open-sync-channels") {
        import("./ui/syncDryRunModal.js").then((mod) => mod.openSyncDryRunModal());
        return;
      }
      if (action) showToast(PLACEHOLDER_ACTIONS[action] || "Not wired yet.");
      return;
    }

    const alertBtn = target.closest("[data-inventory-alert]");
    if (alertBtn) {
      const alertId = alertBtn.getAttribute("data-inventory-alert");
      if (alertId) applyAlertFilter(alertId);
      return;
    }

    const ledgerFilterBtn = target.closest("[data-inventory-ledger-filter]");
    if (ledgerFilterBtn) {
      const filter = ledgerFilterBtn.getAttribute("data-inventory-ledger-filter");
      if (filter === "all" || filter === "parcel") {
        setLedgerFilter(filter);
        refreshInventoryLedger();
      }
    }
  });
}

export function initHeaderActions() {
  document.querySelectorAll("[data-inventory-header-action]").forEach((btn) => {
    const action = btn.getAttribute("data-inventory-header-action");

    if (action === "receive-stock") {
      btn.setAttribute("title", RECEIVE_STOCK_TOOLTIP);
      btn.addEventListener("click", () => {
        location.assign(RECEIVE_STOCK_URL);
      });
      return;
    }

    if (action === "sync-channels") {
      btn.setAttribute("title", "Channel sync preview and Amazon FBM push");
      btn.addEventListener("click", () => {
        import("./ui/syncDryRunModal.js").then((mod) => mod.openSyncDryRunModal());
      });
      return;
    }

    btn.addEventListener("click", () => {
      showToast(PLACEHOLDER_ACTIONS[action] || "Not wired yet.");
    });
  });
}
