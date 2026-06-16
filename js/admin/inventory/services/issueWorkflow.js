/**
 * Issue workflow filter helpers (Phase 8B).
 */

/** @typedef {'active'|'reviewed'|'snoozed'|'resolved'} IssuesWorkflowFilter */

/** @param {import('../state.js').InventoryIssueRow} issue */
export function isSnoozeActive(issue) {
  if (issue.workflowStatus !== "snoozed") return false;
  if (!issue.snoozedUntil) return true;
  return new Date(issue.snoozedUntil).getTime() > Date.now();
}

/**
 * @param {import('../state.js').InventoryIssueRow} issue
 * @param {IssuesWorkflowFilter} filter
 */
export function issueMatchesWorkflowFilter(issue, filter) {
  const status = issue.workflowStatus || "open";
  switch (filter) {
    case "reviewed":
      return status === "reviewed";
    case "snoozed":
      return isSnoozeActive(issue);
    case "resolved":
      return status === "resolved" || status === "ignored";
    case "active":
    default:
      return issue.isActiveWorkflow !== false;
  }
}

/**
 * @param {import('../state.js').InventoryIssueRow[]} rows
 * @param {IssuesWorkflowFilter} filter
 */
export function filterIssuesByWorkflow(rows, filter) {
  return rows.filter((row) => issueMatchesWorkflowFilter(row, filter));
}

/** @param {import('../state.js').InventoryIssueRow[]} rows — alert-eligible only */
export function filterAlertEligibleIssues(rows) {
  return rows.filter((row) => row.isActiveWorkflow !== false);
}

/** @param {string} status */
export function workflowStatusLabel(status) {
  const labels = {
    open: "Open",
    reviewed: "Reviewed",
    snoozed: "Snoozed",
    resolved: "Resolved",
    ignored: "Ignored",
  };
  return labels[status] || status;
}
