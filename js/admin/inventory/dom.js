/**
 * DOM references for Inventory admin page.
 */

/** @type {Record<string, HTMLElement|null>} */
let dom = {};

export function initDom() {
  dom = {
    page: document.getElementById("inventoryPage"),
    previewNote: document.getElementById("inventoryPreviewNote"),
    statusToast: document.getElementById("inventoryStatusToast"),
    channelStatusMount: document.getElementById("inventoryChannelStatusMount"),
    kpiMount: document.getElementById("inventoryKpiMount"),
    alertsMount: document.getElementById("inventoryAlertsMount"),
    filtersMount: document.getElementById("inventoryFiltersMount"),
    tableMount: document.getElementById("inventoryTableMount"),
    tableSummaryMount: document.getElementById("inventoryTableSummaryMount"),
    parcelSummaryMount: document.getElementById("inventoryParcelSummaryMount"),
    ledgerMount: document.getElementById("inventoryLedgerMount"),
    issuesMount: document.getElementById("inventoryIssuesMount"),
    bundleMount: document.getElementById("inventoryBundleMount"),
    tabList: document.getElementById("inventoryTabList"),
    emptyState: document.getElementById("inventoryEmptyState"),
    adjustModalMount: document.getElementById("inventoryAdjustModalMount"),
    syncDryRunModalMount: document.getElementById("inventorySyncDryRunModalMount"),
    issueDetailModalMount: document.getElementById("inventoryIssueDetailModalMount"),
    mappingAssistModalMount: document.getElementById("inventoryMappingAssistModalMount"),
    shippedAuditModalMount: document.getElementById("inventoryShippedAuditModalMount"),
    ebayWorklistModalMount: document.getElementById("inventoryEbayWorklistModalMount"),
    postMapChecklistMount: document.getElementById("inventoryPostMapChecklistMount"),
    postMapQueueModalMount: document.getElementById("inventoryPostMapQueueModalMount"),
    bundlePreviewModalMount: document.getElementById("inventoryBundlePreviewModalMount"),
    restockAssistQueueModalMount: document.getElementById("inventoryRestockAssistQueueModalMount"),
    returnsRestockDashboardModalMount: document.getElementById("inventoryReturnsRestockDashboardModalMount"),
    returnsRestockDigestPreviewMount: document.getElementById("inventoryReturnsRestockDigestPreviewMount"),
  };
}

/** @returns {typeof dom} */
export function getDom() {
  return dom;
}
