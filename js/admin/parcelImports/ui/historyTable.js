/** Previous Imports list + Open Draft (Phase 6B/12). */

import { loadParcelImport } from "../api/parcelImportsLoader.js";
import { listParcelImports } from "../api/parcelImportsApi.js";
import { getDom } from "../dom.js";
import {
  applyLoadedDraft,
  getState,
  setHistoryRows,
  setSaveStatus,
} from "../state.js";
import { renderCpiPreviewFromState } from "./cpiPreviewPanel.js";
import { renderChargeOverrides } from "./overrides.js";
import { renderItemMappingTable } from "./itemMappingTable.js";
import { refreshMappingSuggestions } from "./mappingMemory.js";
import { hydrateProductPickers } from "./productVariantPicker.js";
import { renderParcelSummary } from "./parcelSummary.js";
import { refreshGlobalKpis, renderStatsFromParse } from "./stats.js";
import { renderUploadStatus } from "./upload.js";
import { updateApprovalButtonState } from "./approvalActions.js";
import {
  hydrateExpenseLinkFromHeader,
  updateExpenseLinkUi,
} from "./expenseLinkActions.js";
import {
  hydrateInventoryReceiveFromHeader,
  updateInventoryReceiveUi,
} from "./inventoryReceiveActions.js";
import {
  refreshDuplicateWarning,
  renderActionStatus,
  updateSaveDraftButtonState,
} from "./saveDraft.js";

const PAGE_SIZE = 25;

/** @type {{ search: string, status: string, limit: number, hasMore: boolean, loading: boolean }} */
const historyQuery = {
  search: "",
  status: "",
  limit: PAGE_SIZE,
  hasMore: false,
  loading: false,
};

export function initHistoryTable() {
  const {
    historyTbody,
    historySearchInput,
    historyStatusFilter,
    historySearchBtn,
    historyLoadMoreBtn,
  } = getDom();
  if (!historyTbody) return;

  historyTbody.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-open-draft]");
    if (!btn) return;
    const importId = btn.getAttribute("data-open-draft");
    if (importId) void openDraft(importId);
  });

  historySearchBtn?.addEventListener("click", () => {
    void applyHistoryFilters();
  });

  historySearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void applyHistoryFilters();
    }
  });

  historyStatusFilter?.addEventListener("change", () => {
    void applyHistoryFilters();
  });

  historyLoadMoreBtn?.addEventListener("click", () => {
    historyQuery.limit += PAGE_SIZE;
    void loadAndRenderHistory({ append: true });
  });
}

/** @param {{ append?: boolean, search?: string, status?: string, importId?: string }} [opts] */
export async function loadAndRenderHistory(opts = {}) {
  const state = getState();
  if (!state.sessionReady || !state.adminOk) {
    renderHistoryTable([]);
    updateHistoryControls();
    return;
  }

  if (opts.search !== undefined) historyQuery.search = opts.search;
  if (opts.status !== undefined) historyQuery.status = opts.status;
  if (!opts.append) historyQuery.limit = PAGE_SIZE;

  if (opts.importId) {
    try {
      const rows = await listParcelImports({ importId: opts.importId });
      setHistoryRows(rows);
      renderHistoryTable(rows, { filtered: true, importIdLookup: true });
      updateHistoryControls({ hasMore: false });
      await refreshGlobalKpis();
    } catch (err) {
      console.error("[parcelImports] history import lookup failed", err);
      setSaveStatus("error", `History lookup failed: ${err?.message || "Unknown error"}`);
      renderActionStatus();
      renderHistoryTable([]);
      updateHistoryControls();
    }
    return;
  }

  historyQuery.loading = true;
  updateHistoryControls();

  try {
    const fetchLimit = historyQuery.limit + 1;
    const rows = await listParcelImports({
      limit: fetchLimit,
      status: historyQuery.status || undefined,
      search: historyQuery.search || undefined,
    });
    historyQuery.hasMore = rows.length > historyQuery.limit;
    const visible = rows.slice(0, historyQuery.limit);
    setHistoryRows(visible);
    renderHistoryTable(visible, {
      filtered: !!(historyQuery.search || historyQuery.status),
    });
    updateHistoryControls();
    await refreshGlobalKpis();
  } catch (err) {
    console.error("[parcelImports] history load failed", err);
    setSaveStatus("error", `History load failed: ${err?.message || "Unknown error"}`);
    renderActionStatus();
    renderHistoryTable([]);
    updateHistoryControls();
  } finally {
    historyQuery.loading = false;
    updateHistoryControls();
  }
}

async function applyHistoryFilters() {
  const { historySearchInput, historyStatusFilter } = getDom();
  historyQuery.search = historySearchInput?.value?.trim() ?? "";
  historyQuery.status = historyStatusFilter?.value ?? "";
  historyQuery.limit = PAGE_SIZE;
  await loadAndRenderHistory();
}

/**
 * @param {object[]} rows
 * @param {{ filtered?: boolean, importIdLookup?: boolean }} [opts]
 */
export function renderHistoryTable(rows, opts = {}) {
  const { historyTbody, historyFootnote } = getDom();
  if (!historyTbody) return;

  historyTbody
    .querySelectorAll("[data-parcel-history-placeholder]")
    .forEach((row) => row.remove());

  if (!rows.length) {
    const message = opts.importIdLookup
      ? "No import found for that ID."
      : opts.filtered
        ? "No imports match your search or filter."
        : "No saved imports yet. Upload a Baestao file and click Save Draft.";
    historyTbody.innerHTML = `
      <tr>
        <td colspan="11" class="px-3 py-8 text-center text-sm text-gray-500">
          ${escapeHtml(message)}
        </td>
      </tr>`;
    if (historyFootnote) {
      historyFootnote.textContent = opts.filtered
        ? "Try a different parcel ID, filename, or status."
        : "No saved imports found.";
    }
    return;
  }

  historyTbody.innerHTML = rows.map(renderHistoryRow).join("");
  if (historyFootnote) {
    const filterNote = historyQuery.search
      ? ` matching “${historyQuery.search}”`
      : historyQuery.status
        ? ` with status ${historyQuery.status.replace(/_/g, " ")}`
        : "";
    historyFootnote.textContent = `Showing ${rows.length} import(s)${filterNote}.`;
  }
}

function updateHistoryControls(overrides = {}) {
  const { historyLoadMoreBtn } = getDom();
  const hasMore = overrides.hasMore ?? historyQuery.hasMore;
  if (historyLoadMoreBtn) {
    historyLoadMoreBtn.classList.toggle("hidden", !hasMore);
    historyLoadMoreBtn.disabled = historyQuery.loading;
    historyLoadMoreBtn.textContent = historyQuery.loading ? "Loading…" : "Load more";
  }
}

function renderHistoryRow(row) {
  const importedAt = formatDate(row.imported_at);
  const items = row.xls_total_items ?? "—";
  const charge = formatCny(row.actual_total_charge_cny);
  const usd = formatUsd(row.usd_equivalent);
  const weight = formatGrams(row.xls_charged_weight_grams);
  const products =
    row.products_affected_count > 0
      ? `${row.products_affected_count} affected`
      : "—";
  const issues =
    row.rows_needing_mapping_count > 0
      ? `${row.rows_needing_mapping_count} need mapping`
      : "—";
  const expense = row.inventory_received_at
    ? "Received"
    : row.expense_id
      ? "Expense linked"
      : row.status === "approved"
        ? "No expense"
        : "—";
  const openLabel = row.status === "approved" ? "Open" : "Open Draft";
  const expenseCls = row.inventory_received_at || row.expense_id
    ? "text-green-800 font-medium"
    : "text-gray-600";

  return `
    <tr class="hover:bg-gray-50/80">
      <td class="px-3 py-2.5 font-mono text-xs font-bold text-gray-900">${escapeHtml(row.parcel_id || "—")}</td>
      <td class="px-3 py-2.5 tabular-nums text-gray-800">${escapeHtml(importedAt)}</td>
      <td class="px-3 py-2.5 text-center">${statusBadge(row.status)}</td>
      <td class="px-3 py-2.5 text-right tabular-nums">${escapeHtml(String(items))}</td>
      <td class="px-3 py-2.5 text-right tabular-nums">${escapeHtml(weight)}</td>
      <td class="px-3 py-2.5 text-right tabular-nums font-medium">${escapeHtml(charge)}</td>
      <td class="px-3 py-2.5 text-right tabular-nums">${escapeHtml(usd)}</td>
      <td class="px-3 py-2.5 text-xs text-gray-800">${escapeHtml(products)}</td>
      <td class="px-3 py-2.5 text-xs text-gray-700">${escapeHtml(issues)}</td>
      <td class="px-3 py-2.5 text-xs ${expenseCls}">${escapeHtml(expense)}</td>
      <td class="px-3 py-2.5 text-center">
        <button
          type="button"
          data-open-draft="${escapeAttr(row.id)}"
          title="${escapeAttr(openLabel)}"
          class="border border-gray-300 bg-white text-gray-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wide hover:bg-gray-50"
        >
          ${escapeHtml(openLabel)}
        </button>
      </td>
    </tr>`;
}

export async function openDraft(importId) {
  const state = getState();
  if (!state.sessionReady || !state.adminOk) {
    setSaveStatus("error", "Admin session required to open drafts.");
    renderActionStatus();
    return;
  }

  setSaveStatus("saving", "Loading draft…");
  renderActionStatus();

  try {
    const bundle = await loadParcelImport(importId);
    applyLoadedDraft(bundle);
    renderLoadedDraftUi(bundle);
    const statusLabel = String(bundle.header?.status || bundle.parcel?.status || "draft").replace(
      /_/g,
      " ",
    );
    setSaveStatus(
      "saved",
      `Opened parcel ${bundle.parcel?.parcelId || importId} (${statusLabel}).`,
    );
    await hydrateExpenseLinkFromHeader(importId);
    await hydrateInventoryReceiveFromHeader(importId);
    await refreshDuplicateWarning({
      parcelId: bundle.parcel?.parcelId,
      fileHash: bundle.header?.file_hash ?? null,
    });
  } catch (err) {
    console.error("[parcelImports] open draft failed", err);
    setSaveStatus("error", `Load failed: ${err?.message || "Unknown error"}`);
  } finally {
    renderActionStatus();
    updateSaveDraftButtonState();
    updateApprovalButtonState();
    updateExpenseLinkUi();
    updateInventoryReceiveUi();
  }
}

/**
 * @param {object} bundle
 */
export function renderLoadedDraftUi(bundle) {
  const state = getState();

  renderUploadStatus(
    state.uploadStatus,
    state.uploadMessage,
    state.errors,
    state.warnings,
  );
  renderParcelSummary(bundle.parcel, {
    name: bundle.parcel?.sourceFileName,
  });
  renderChargeOverrides(bundle.parcel);

  if (state.derived) {
    renderStatsFromParse(state.derived);
  }
  void refreshGlobalKpis();

  if (bundle.items?.length) {
    renderItemMappingTable(bundle.items);
  }

  void hydrateProductPickers(bundle.rowMappings);
  void refreshMappingSuggestions();
  renderCpiPreviewFromState();
}

function statusBadge(status) {
  const map = {
    draft: "text-gray-700 bg-gray-100 border-gray-300",
    needs_review: "text-amber-800 bg-amber-50 border-amber-200",
    ready_to_approve: "text-blue-800 bg-blue-50 border-blue-200",
    approved: "text-green-800 bg-green-50 border-green-200",
    voided: "text-gray-600 bg-gray-100 border-gray-300",
    error: "text-red-800 bg-red-50 border-red-200",
  };
  const cls = map[status] || map.draft;
  const label = String(status || "draft").replace(/_/g, " ");
  return `<span class="text-[10px] font-black uppercase tracking-wide ${cls} border rounded-full px-2 py-0.5 whitespace-nowrap">${escapeHtml(label)}</span>`;
}

function formatDate(value) {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function formatCny(value) {
  if (value == null) return "—";
  return `¥${Number(value).toFixed(2)}`;
}

function formatUsd(value) {
  if (value == null) return "—";
  return `$${Number(value).toFixed(2)}`;
}

function formatGrams(value) {
  if (value == null) return "—";
  return `${Math.round(Number(value)).toLocaleString()} g`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, "&#39;");
}
