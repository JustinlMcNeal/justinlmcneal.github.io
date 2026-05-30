/** Listing health badges, filters, and export helpers (Phase 5E). */

const HEALTH_BADGES = {
  healthy: { label: "Healthy", className: "bg-green-100 text-green-800" },
  warning: { label: "Warning", className: "bg-amber-100 text-amber-800" },
  error: { label: "Error", className: "bg-red-100 text-red-800" },
  suppressed: { label: "Suppressed", className: "bg-red-100 text-red-800" },
  sync_error: { label: "Sync Error", className: "bg-orange-100 text-orange-900" },
  unknown: { label: "Unknown", className: "bg-gray-200 text-gray-700" },
};

/** @param {Record<string, unknown>} row */
export function getHealthStatus(row) {
  return String(row.listing_health_status || "unknown");
}

/** @param {Record<string, unknown>} row */
export function hasListingHealthIssue(row) {
  return row.has_listing_health_issue === true;
}

/** @param {Array<Record<string, unknown>>} rows */
export function countListingHealthIssues(rows) {
  return rows.filter((row) => hasListingHealthIssue(row)).length;
}

/** @param {Record<string, unknown>} row */
export function getHealthBadge(row) {
  const status = getHealthStatus(row);
  return HEALTH_BADGES[status] || HEALTH_BADGES.unknown;
}

/** @param {Record<string, unknown>} row */
export function getOpenIssueCount(row) {
  return Number(row.open_issue_count || 0);
}

/** @param {Record<string, unknown>} row */
export function getHealthIssueCountLabel(row) {
  const open = getOpenIssueCount(row);
  if (open <= 0) return "";
  return `${open} open issue${open === 1 ? "" : "s"}`;
}

/** @param {unknown} reasons */
export function getHealthReasons(row) {
  const reasons = row.listing_health_reasons;
  if (Array.isArray(reasons)) {
    return reasons.map((item) => String(item)).filter(Boolean);
  }
  return [];
}

/** @param {Record<string, unknown>} row @param {typeof import("./renderListings.js").escapeHtml} escapeHtml */
export function renderHealthReasonChips(row, escapeHtml) {
  const reasons = getHealthReasons(row);
  if (reasons.length === 0) return "";
  return reasons.slice(0, 3).map((reason) =>
    `<span class="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-100 text-gray-700 mr-1 mb-1">${escapeHtml(reason)}</span>`,
  ).join("");
}

/** @param {Record<string, unknown>} row */
export function getHealthRowClass(row) {
  const status = getHealthStatus(row);
  if (status === "error" || status === "suppressed") {
    return "amazon-row-health-error";
  }
  if (status === "warning" || status === "sync_error") {
    return "amazon-row-health-warning";
  }
  if (status === "unknown") {
    return "amazon-row-health-unknown";
  }
  return "";
}

/** @param {Record<string, unknown>} row @param {typeof import("./renderListings.js").escapeHtml} escapeHtml */
export function renderHealthCell(row, escapeHtml) {
  const badge = getHealthBadge(row);
  const issueLabel = getHealthIssueCountLabel(row);
  const issueLine = issueLabel
    ? `<span class="text-[10px] text-gray-500 block mt-0.5">${escapeHtml(issueLabel)}</span>`
    : "";

  return `
    <span class="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${badge.className}">${escapeHtml(badge.label)}</span>
    ${issueLine}
  `;
}

/** @param {Record<string, unknown>} row @param {string} filterValue */
export function healthMatchesFilter(row, filterValue) {
  const filter = String(filterValue || "").trim();
  if (!filter || filter === "all") return true;

  const status = getHealthStatus(row);
  const openIssues = getOpenIssueCount(row);

  if (filter === "healthy") return status === "healthy";
  if (filter === "warning") return status === "warning";
  if (filter === "error") return status === "error";
  if (filter === "suppressed") return status === "suppressed";
  if (filter === "sync_error") return status === "sync_error";
  if (filter === "unknown") return status === "unknown";
  if (filter === "has_issues") {
    return openIssues > 0 || hasListingHealthIssue(row);
  }
  return true;
}

/** @param {unknown} value */
function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** @param {Record<string, unknown>} row */
export function getHealthSummaryText(row) {
  const badge = getHealthBadge(row);
  const parts = [`Health: ${badge.label}`];
  const open = getOpenIssueCount(row);
  if (open > 0) parts.push(`${open} open issue${open === 1 ? "" : "s"}`);
  if (row.latest_issue_message) {
    parts.push(`Latest issue: ${String(row.latest_issue_message).slice(0, 120)}`);
  }
  if (Number(row.recent_sync_error_count || 0) > 0 && row.latest_sync_error_message) {
    parts.push(`Latest sync error: ${String(row.latest_sync_error_message).slice(0, 120)}`);
  }
  return parts.join(" · ");
}

/** @param {Record<string, unknown>} row */
export function getHealthExportFields(row) {
  return {
    healthStatus: getHealthStatus(row),
    openIssueCount: getOpenIssueCount(row),
    errorIssueCount: Number(row.error_issue_count || 0),
    warningIssueCount: Number(row.warning_issue_count || 0),
    latestIssueCode: row.latest_issue_code ?? "",
    latestIssueMessage: row.latest_issue_message ?? "",
    latestIssueSource: row.latest_issue_source ?? "",
    recentSyncErrorCount: Number(row.recent_sync_error_count || 0),
    latestSyncError: row.latest_sync_error_message ?? "",
    latestSyncErrorAt: formatDateTime(row.latest_sync_error_at),
  };
}

/** @param {Record<string, unknown>} row */
export function healthSummaryLine(row) {
  if (!hasListingHealthIssue(row) && getOpenIssueCount(row) === 0) return "";
  return ` · ${getHealthSummaryText(row)}`;
}
