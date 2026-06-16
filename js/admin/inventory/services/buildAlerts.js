/**

 * Build live alert pills from issue rows (Phase 3C+ / 8A action routes).

 */



import { ISSUE_ACTIONS } from "./issueActions.js";
import { filterAlertEligibleIssues } from "./issueWorkflow.js";



/** @typedef {import('../state.js').InventoryIssueRow} InventoryIssueRow */



/** @typedef {{ id: string, issueType: string, label: string, tone: string, count: number, navigateUrl?: string }} InventoryAlert */



const ALERT_DEFS = [

  { id: "negative-stock", issueType: "negative_stock", tone: "orange", label: (n) => `${n} Negative Stock` },

  { id: "negative-available", issueType: "negative_available", tone: "orange", label: (n) => `${n} Negative Available` },

  { id: "low-stock", issueType: "low_stock", tone: "amber", label: (n) => `${n} Low Stock` },

  { id: "amazon-inactive", issueType: "amazon_listing_inactive", tone: "yellow", label: (n) => `${n} Amazon Inactive` },

  { id: "ebay-ended", issueType: "ebay_listing_ended", tone: "purple", label: (n) => `${n} eBay Listing Ended` },

  { id: "ebay-cache-missing", issueType: "ebay_qty_cache_missing", tone: "violet", label: (n) => `${n} eBay Cache Missing` },

  { id: "channel-sync-failed", issueType: "channel_sync_failed", tone: "red", label: (n) => `${n} Sync Failures` },

  { id: "parcel-mapping", issueType: "parcel_mapping_missing", tone: "blue", label: (n) => `${n} Parcel Rows Awaiting Mapping` },

  { id: "unmapped-order-lines", issueType: "unmapped_order_line", tone: "rose", label: (n) => `${n} Order Lines Need Variant Mapping` },

  { id: "shipped-finalize-audit", issueType: "shipped_finalize_audit_needed", tone: "red", label: (n) => `${n} Shipped Lines Need Audit` },

];



function primaryNavigateUrl(issueType) {

  const url = ISSUE_ACTIONS[issueType]?.primary?.url;

  return url || undefined;

}



/** @param {InventoryIssueRow[]} issueRows @param {boolean} [isLive] */

export function buildInventoryAlerts(issueRows, isLive = true) {

  if (!isLive) return [];

  const eligible = filterAlertEligibleIssues(issueRows);
  const byType = Object.fromEntries(eligible.map((row) => [row.type, row]));

  /** @type {InventoryAlert[]} */

  const alerts = [];



  for (const def of ALERT_DEFS) {

    const issue = byType[def.issueType];

    if (!issue || issue.affectedCount <= 0) continue;

    alerts.push({

      id: def.id,

      issueType: def.issueType,

      label: def.label(issue.affectedCount),

      tone: def.tone,

      count: issue.affectedCount,

      navigateUrl: primaryNavigateUrl(def.issueType),

    });

  }



  return alerts;

}



/** @type {Record<string, { tab?: string, issueType?: string, inventoryState?: string }>} */

export const ALERT_FILTER_MAP = {

  "negative-stock": { tab: "issues", issueType: "negative_stock", inventoryState: "negative" },

  "negative-available": { tab: "issues", inventoryState: "negative_available" },

  "low-stock": { tab: "lowStock" },

  "amazon-inactive": { tab: "issues", issueType: "amazon_listing_inactive" },

  "ebay-ended": { tab: "issues", issueType: "ebay_listing_ended" },

  "ebay-cache-missing": { tab: "issues", issueType: "ebay_qty_cache_missing" },

  "channel-sync-failed": { tab: "issues", issueType: "channel_sync_failed" },

  "parcel-mapping": { tab: "issues", issueType: "parcel_mapping_missing" },

  "unmapped-order-lines": { tab: "issues", issueType: "unmapped_order_line" },

  "shipped-finalize-audit": { tab: "issues", issueType: "shipped_finalize_audit_needed" },

};

