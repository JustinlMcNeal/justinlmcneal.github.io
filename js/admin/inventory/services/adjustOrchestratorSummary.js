/**

 * Format adjust orchestrator results for toasts (Phase 059A.3 — short summary; panel is primary in 059A.4).

 * Phase 059E.2 — standardized failure / partial-success copy.

 */



export const ADJUST_KK_SUCCESS_COPY = "KK stock was adjusted successfully.";



export const ADJUST_PARTIAL_BANNER_TITLE =

  "Stock update complete. Some marketplace actions need attention.";



export const ADJUST_PARTIAL_CHANNEL_FAILURE_COPY =

  "Stock remains adjusted. Retry marketplace sync from the links below.";



export const ADJUST_NO_ROLLBACK_COPY =

  "Marketplace failures do not undo the stock adjustment.";



export const AMAZON_SYNC_FAILED_COPY = "Amazon sync failed. KK stock remains adjusted.";



export const AMAZON_DRY_RUN_COPY =

  "Amazon sync was previewed only. Live Amazon patching is disabled.";



export const EBAY_QTY_FAILED_COPY = "eBay quantity sync failed. KK stock remains adjusted.";



export const EBAY_CACHE_FAILED_COPY =

  "eBay cache refresh failed. Quantity sync was not attempted.";



export const EBAY_RELIST_DRY_RUN_COPY =

  "eBay relist was previewed only. Live relist is disabled.";



export const EBAY_RELIST_MANUAL_COPY = "eBay relist requires manual review.";



export const EBAY_RELIST_FAILED_COPY = "eBay relist failed. KK stock remains adjusted.";

export const EBAY_VARIATION_QTY_SUCCESS_COPY = "eBay variation quantity updated.";

export const EBAY_VARIATION_QTY_DRY_RUN_COPY =
  "eBay variation quantity sync was previewed only. Live eBay quantity patching is disabled.";

export const EBAY_VARIATION_QTY_MANUAL_COPY = "eBay variation requires manual mapping review.";

export const EBAY_VARIATION_QTY_SKIPPED_COPY = "eBay variation quantity sync skipped.";

export const EBAY_VARIATION_QTY_FAILED_COPY =
  "eBay variation quantity sync failed. KK stock remains adjusted.";

export const EBAY_VARIATION_GROUP_RELIST_SUCCESS_COPY = "eBay variation group relisted successfully.";

export const EBAY_VARIATION_GROUP_RELIST_DRY_RUN_COPY =
  "eBay variation group relist was previewed only. Live variation relist is disabled.";

export const EBAY_VARIATION_GROUP_RELIST_MANUAL_COPY =
  "eBay variation group relist requires manual review.";

export const EBAY_VARIATION_GROUP_RELIST_SKIPPED_COPY = "eBay variation group relist skipped.";

export const EBAY_VARIATION_GROUP_RELIST_FAILED_COPY =
  "eBay variation group relist failed. KK stock remains adjusted.";



/**

 * @param {import('./adjustChannelOrchestrator.js').ChannelStepResult} step

 * @returns {boolean}

 */

export function channelNeedsAttention(step) {

  if (["failed", "manual", "dry_run", "next_step"].includes(step.status)) return true;

  return step.status === "skipped" && step.action != null && step.action !== "no_change";

}



/**

 * @param {import('./adjustChannelOrchestrator.js').AdjustOrchestrationResult} result

 * @returns {boolean}

 */

export function hasPartialChannelFailure(result) {

  if (result.kk.status !== "success" || !result.syncChannelsEnabled) return false;

  return channelNeedsAttention(result.amazon) || channelNeedsAttention(result.ebay);

}



/**

 * @param {import('./adjustChannelOrchestrator.js').AdjustOrchestrationResult} result

 * @returns {{ message: string, variant: 'success'|'error'|'warning' }}

 */

export function formatAdjustOrchestratorToast(result) {

  if (result.kk.status === "failed") {

    return { message: result.kk.message || "Stock adjustment failed.", variant: "error" };

  }



  const parts = [];

  const sign = result.kk.delta > 0 ? "+" : "";

  parts.push(`KK: ${sign}${result.kk.delta} → ${result.kk.stockAfter} on hand`);



  const channelLine = (label, step) => {

    if (step.status === "success") return `${label}: synced`;

    if (step.status === "failed") return `${label}: failed`;

    if (step.status === "dry_run") return `${label}: dry run`;

    if (step.status === "next_step" || step.status === "manual") return `${label}: manual step`;

    return `${label}: skipped`;

  };



  parts.push(channelLine("Amazon", result.amazon));

  parts.push(channelLine("eBay", result.ebay));



  const hasFailure =

    result.amazon.status === "failed" || result.ebay.status === "failed";

  const hasNextStep =

    result.amazon.status === "next_step" ||

    result.ebay.status === "next_step" ||

    result.amazon.status === "manual" ||

    result.ebay.status === "manual";

  const hasDryRun =

    result.amazon.status === "dry_run" || result.ebay.status === "dry_run";



  let variant = "success";

  if (hasFailure) variant = "warning";

  else if ((hasNextStep || hasDryRun) && result.syncChannelsEnabled) variant = "warning";



  if (result.warnings.length) {

    parts.push(result.warnings[0]);

  }



  return { message: parts.join(" · "), variant };

}


