import { escapeHtml } from "./renderListings.js";

const MARKETPLACE_LABELS = {
  ATVPDKIKX0DER: "US",
  A2EUQ1WTGCTBG2: "CA",
  A1AM78C64UM0Y8: "MX",
};

const SYNC_TYPE_LABELS = {
  manual: "Manual",
  incremental: "Scheduled",
  single_sku: "Single SKU",
  full: "Full",
};

const STATUS_BADGES = {
  success: { label: "Success", className: "bg-green-100 text-green-800" },
  partial_success: { label: "Partial", className: "bg-amber-100 text-amber-800" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800" },
  running: { label: "Running", className: "bg-blue-100 text-blue-800" },
  queued: { label: "Queued", className: "bg-gray-100 text-gray-700" },
  cancelled: { label: "Cancelled", className: "bg-gray-200 text-gray-700" },
};

/** @param {unknown} value */
function formatRunDate(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** @param {Record<string, unknown>} run */
function syncTypeLabel(run) {
  const key = String(run.sync_type || "");
  return SYNC_TYPE_LABELS[key] || key || "—";
}

/** @param {Record<string, unknown>} run */
function marketplaceLabel(run) {
  const id = String(run.marketplace_id || "");
  return MARKETPLACE_LABELS[id] || id || "—";
}

/** @param {Record<string, unknown>} run */
function triggerLabel(run) {
  return run.triggered_by ? "Admin" : "Cron";
}

/** @param {string} status */
function statusBadge(status) {
  return STATUS_BADGES[status] || { label: status || "Unknown", className: "bg-gray-100 text-gray-700" };
}

/**
 * @param {Record<string, unknown>} run
 * @param {boolean} [expanded]
 */
export function buildSyncRunRow(run, expanded = false) {
  const id = String(run.id || "");
  const status = String(run.status || "unknown");
  const badge = statusBadge(status);
  const summary = run.summary && typeof run.summary === "object"
    ? /** @type {Record<string, unknown>} */ (run.summary)
    : null;
  const pages = Number(summary?.pagesFetched);
  const pagesText = Number.isFinite(pages) && pages > 0 ? `${pages} pg` : "—";

  return `
    <tr class="border-b border-gray-100 hover:bg-gray-50" data-sync-run-id="${escapeHtml(id)}">
      <td class="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">${escapeHtml(formatRunDate(run.finished_at || run.created_at))}</td>
      <td class="px-3 py-2 text-xs font-bold">${escapeHtml(syncTypeLabel(run))}</td>
      <td class="px-3 py-2 text-xs font-mono">${escapeHtml(marketplaceLabel(run))}</td>
      <td class="px-3 py-2 text-center"><span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${badge.className}">${escapeHtml(badge.label)}</span></td>
      <td class="px-3 py-2 text-xs text-right font-mono">${escapeHtml(String(run.records_seen ?? 0))}</td>
      <td class="px-3 py-2 text-xs text-right font-mono hidden sm:table-cell">${escapeHtml(String(run.records_created ?? 0))}</td>
      <td class="px-3 py-2 text-xs text-right font-mono hidden sm:table-cell">${escapeHtml(String(run.records_updated ?? 0))}</td>
      <td class="px-3 py-2 text-xs text-right font-mono ${Number(run.records_failed) > 0 ? "text-red-700 font-bold" : ""}">${escapeHtml(String(run.records_failed ?? 0))}</td>
      <td class="px-3 py-2 text-xs text-gray-500 hidden md:table-cell">${escapeHtml(triggerLabel(run))}</td>
      <td class="px-3 py-2 text-xs text-gray-400 hidden lg:table-cell">${escapeHtml(pagesText)}</td>
      <td class="px-3 py-2 text-right">
        <button type="button" data-action="toggle-sync-run-detail" data-sync-run-id="${escapeHtml(id)}" aria-expanded="${expanded ? "true" : "false"}" class="text-[10px] font-black uppercase tracking-wide text-gray-600 hover:text-black min-h-[32px] px-2">${expanded ? "Hide" : "Details"}</button>
      </td>
    </tr>
    <tr class="sync-run-detail-row ${expanded ? "" : "hidden"}" data-sync-run-detail-for="${escapeHtml(id)}">
      <td colspan="11" class="px-3 py-3 bg-gray-50 text-xs text-gray-600">
        <div data-sync-run-detail-body="${escapeHtml(id)}">${expanded ? "Loading errors…" : ""}</div>
      </td>
    </tr>
  `;
}

/**
 * @param {Array<Record<string, unknown>>} errors
 */
export function buildSyncRunErrorList(errors) {
  if (!errors.length) {
    return '<p class="text-gray-500">No row-level errors recorded for this run.</p>';
  }

  const items = errors.map((row) => {
    const sku = escapeHtml(row.seller_sku || "—");
    const code = escapeHtml(row.error_code || "error");
    const message = escapeHtml(row.message || "Unknown error");
    return `<li class="py-1 border-b border-gray-200 last:border-b-0"><span class="font-mono font-bold">${sku}</span> · <span class="uppercase text-[10px] tracking-wide">${code}</span> — ${message}</li>`;
  }).join("");

  return `<ul class="space-y-0">${items}</ul>`;
}

/** @param {string} message */
export function buildSyncRunDetailMessage(message) {
  return `<p class="text-gray-500">${escapeHtml(message)}</p>`;
}

/**
 * @param {Array<Record<string, unknown>>} runs
 * @param {Set<string>} expandedIds
 */
export function renderSyncRunTableRows(runs, expandedIds = new Set()) {
  if (!runs.length) {
    return '<tr><td colspan="11" class="px-3 py-8 text-center text-sm text-gray-400">No sync runs match the current filters.</td></tr>';
  }

  return runs.map((run) => {
    const id = String(run.id || "");
    return buildSyncRunRow(run, expandedIds.has(id));
  }).join("");
}
