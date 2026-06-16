/**
 * Render inventory issues panel (compact, footer center column).
 */

import { INVENTORY_ISSUES } from "../mockData.js";
import { esc } from "../utils/formatters.js";
import { getPrimaryActionForIssue, getIssueActionDef } from "../services/issueActions.js";
import { workflowStatusLabel, isSnoozeActive } from "../services/issueWorkflow.js";

const SEVERITY_DOTS = {
  critical: "bg-red-500",
  high: "bg-red-500",
  medium: "bg-amber-400",
  low: "bg-blue-400",
};

const WORKFLOW_BADGE = {
  reviewed: "bg-blue-100 text-blue-900 border-blue-300",
  snoozed: "bg-violet-100 text-violet-900 border-violet-300",
  resolved: "bg-gray-100 text-gray-600 border-gray-300",
  ignored: "bg-gray-100 text-gray-500 border-gray-300",
};

/** @typedef {'active'|'reviewed'|'snoozed'|'resolved'} IssuesWorkflowFilter */

const WORKFLOW_FILTERS = [
  { id: "active", label: "Active" },
  { id: "reviewed", label: "Reviewed" },
  { id: "snoozed", label: "Snoozed" },
  { id: "resolved", label: "Resolved / Ignored" },
];

/** @param {import('../state.js').InventoryIssueRow} issue */
function workflowBadge(issue) {
  const status = issue.workflowStatus || "open";
  if (status === "open") return "";
  const cls = WORKFLOW_BADGE[status] || WORKFLOW_BADGE.resolved;
  let extra = "";
  if (status === "snoozed" && issue.snoozedUntil && isSnoozeActive(issue)) {
    const d = new Date(issue.snoozedUntil);
    if (!Number.isNaN(d.getTime())) {
      extra = ` until ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    }
  }
  return `<span class="inline-block mt-1 text-[9px] font-black uppercase tracking-[.06em] border px-1.5 py-0.5 rounded ${cls}">${esc(workflowStatusLabel(status))}${esc(extra)}</span>`;
}

/** @param {import('../state.js').InventoryIssueRow} issue */
function issueActionButtons(issue) {
  const primary = getPrimaryActionForIssue(issue);
  const primaryBtn = primary.implemented
    ? `<button type="button" data-inventory-issue-primary="${esc(issue.type)}" class="inline-flex items-center mt-1 mr-2 text-[10px] font-black uppercase tracking-[.06em] text-teal-800 hover:underline">${esc(primary.label)} →</button>`
    : `<span class="text-[10px] text-gray-400 mt-1 block">Manual review</span>`;

  return `
    <div class="flex flex-wrap items-center gap-1 mt-1">
      ${primaryBtn}
      <button type="button" data-inventory-issue-detail="${esc(issue.type)}" class="text-[10px] font-black uppercase tracking-[.06em] text-gray-500 hover:underline">Details</button>
      ${
        issue.type === "unmapped_order_line" || issue.type === "amazon_mapping_missing"
          ? `<button type="button" data-inventory-mapping-assist="${esc(issue.type)}" class="text-[10px] font-black uppercase tracking-[.06em] text-teal-800 hover:underline">Map Assist</button>`
          : ""
      }
      ${
        issue.type === "unmapped_order_line"
          ? `<button type="button" data-inventory-ebay-worklist class="text-[10px] font-black uppercase tracking-[.06em] text-violet-800 hover:underline">eBay Worklist</button>`
          : ""
      }
    </div>`;
}

/** @param {{ type: string, label: string, severity: string, description: string, affectedCount: number }} issue */
function issueRow(issue) {
  const def = getIssueActionDef(issue.type);
  const severity = def?.severity || issue.severity;
  const dot = SEVERITY_DOTS[severity] || SEVERITY_DOTS.medium;
  return `
    <tr class="border-b border-gray-100 hover:bg-gray-50/60" data-issue-type="${esc(issue.type)}">
      <td class="py-2.5 pr-2 align-top">
        <p class="text-[11px] font-bold text-gray-900 leading-snug">${esc(issue.label)}</p>
        <p class="text-[9px] font-mono text-gray-400 mt-0.5">${esc(issue.type)}</p>
        ${workflowBadge(issue)}
        ${issueActionButtons(issue)}
      </td>
      <td class="py-2.5 pr-2 align-top">
        <span class="inline-flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full ${dot}" aria-hidden="true"></span>
          <span class="text-[10px] font-black uppercase text-gray-500">${esc(severity)}</span>
        </span>
      </td>
      <td class="py-2.5 pr-2 align-top text-[11px] text-gray-600 leading-snug">${esc(issue.description)}</td>
      <td class="py-2.5 text-right align-top font-black text-sm text-gray-900">${issue.affectedCount}</td>
    </tr>
  `;
}

function workflowFilterPills(activeFilter) {
  return `
    <div class="flex flex-wrap gap-1 mb-2" role="tablist" aria-label="Issue workflow filter">
      ${WORKFLOW_FILTERS.map((f) => {
        const selected = f.id === activeFilter;
        const cls = selected
          ? "border-2 border-black bg-black text-white"
          : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
        return `<button type="button" role="tab" aria-selected="${selected ? "true" : "false"}" data-issues-workflow-filter="${f.id}" class="px-2 py-1 text-[9px] font-black uppercase tracking-[.08em] rounded-lg min-h-[32px] ${cls}">${f.label}</button>`;
      }).join("")}
    </div>`;
}

function emptyMessage(filter) {
  const messages = {
    active: "No active inventory issues detected.",
    reviewed: "No issues marked reviewed.",
    snoozed: "No snoozed issues.",
    resolved: "No resolved or ignored issues.",
  };
  return messages[filter] || messages.active;
}

/** @param {{ loading?: boolean, error?: string|null, isLive?: boolean }} opts */
function issuesStatusBanner(opts) {
  const { loading, error, isLive } = opts;
  if (loading) {
    return `<p class="text-xs text-gray-500 mb-2" role="status" aria-live="polite">Loading issues…</p>`;
  }
  if (error && !isLive) {
    return `<p class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2" role="alert">Live issues unavailable (${esc(error)}). Showing placeholder data.</p>`;
  }
  return "";
}

/**
 * @param {HTMLElement|null} mount
 * @param {typeof INVENTORY_ISSUES} [issues]
 * @param {{ loading?: boolean, error?: string|null, isLive?: boolean, workflowFilter?: IssuesWorkflowFilter, postMapQueueCount?: number }} [opts]
 */
export function renderIssues(mount, issues, opts = {}) {
  if (!mount) return;

  const {
    loading = false,
    error = null,
    isLive = false,
    workflowFilter = "active",
    postMapQueueCount = 0,
  } = opts;
  const rows = issues ?? INVENTORY_ISSUES;

  const body = loading
    ? `<tr><td colspan="4" class="py-6 text-center text-xs text-gray-400">Loading…</td></tr>`
    : rows.length
      ? rows.map(issueRow).join("")
      : `<tr><td colspan="4" class="py-6 text-center text-xs text-gray-400">${emptyMessage(workflowFilter)}</td></tr>`;

  mount.innerHTML = `
    ${issuesStatusBanner({ loading, error, isLive })}
    ${
      isLive
        ? `<div class="mb-2 flex flex-wrap items-center gap-2">
      <button type="button" data-inventory-post-map-queue class="border-2 border-violet-700 text-violet-900 px-3 py-1.5 text-[10px] font-black uppercase min-h-[36px]">
        Post-Map Queue${postMapQueueCount > 0 ? ` (${postMapQueueCount})` : ""}
      </button>
      <span class="text-[10px] text-gray-500">Follow-up todos after mapping — navigation only</span>
    </div>`
        : ""
    }
    ${isLive ? workflowFilterPills(workflowFilter) : ""}
    <div class="overflow-x-auto" ${loading ? 'aria-busy="true"' : ""}>
      <table class="w-full border-collapse text-sm min-w-[320px]">
        <thead>
          <tr class="border-b border-gray-200 text-left">
            <th scope="col" class="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[.1em] text-gray-400">Issue Type</th>
            <th scope="col" class="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[.1em] text-gray-400">Severity</th>
            <th scope="col" class="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[.1em] text-gray-400">Description</th>
            <th scope="col" class="py-1.5 text-[9px] font-black uppercase tracking-[.1em] text-gray-400 text-right">Affected</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;

  mount.querySelectorAll("[data-issues-workflow-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.getAttribute("data-issues-workflow-filter");
      if (!filter) return;
      import("../state.js").then(({ setIssuesWorkflowFilter }) => {
        setIssuesWorkflowFilter(/** @type {IssuesWorkflowFilter} */ (filter));
        import("../events.js").then((mod) => mod.refreshIssuesPanel());
      });
    });
  });
}
