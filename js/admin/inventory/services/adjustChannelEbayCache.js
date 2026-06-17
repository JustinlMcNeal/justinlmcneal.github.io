/**
 * Adjust-chain eBay cache refresh + candidate re-read (Phase 059C.2).
 * Refresh + re-fetch; qty push wired from orchestrator in 059C.3.
 */

import { refreshEbayListingCache } from "../api/ebayCacheRefreshApi.js";
import { fetchChannelSyncCandidateForVariant } from "../api/channelSyncCandidateApi.js";

/** @typedef {'success'|'failed'|'skipped'} ChainStatus */

/**
 * @typedef {'update_qty'|'manual'|'ended_relist'|'unsupported_variation'|'missing_mapping'|'no_change'} EbayCacheNextAction
 */

/**
 * @typedef {Object} AdjustEbayCacheRefreshResult
 * @property {ChainStatus} status
 * @property {{ status: ChainStatus, message: string, runId: string|null }} cacheRefresh
 * @property {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} candidate
 * @property {EbayCacheNextAction} nextAction
 * @property {string} message
 */

const SKIP_BEFORE_REFRESH = new Set(["ended_needs_relist", "unsupported_variation"]);

/** @param {string|null|undefined} action @returns {EbayCacheNextAction} */
export function mapEbayCacheNextAction(action) {
  switch (action) {
    case "update_qty":
      return "update_qty";
    case "ended_needs_relist":
      return "ended_relist";
    case "unsupported_variation":
      return "unsupported_variation";
    case "missing_mapping":
      return "missing_mapping";
    case "no_change":
      return "no_change";
    default:
      return "manual";
  }
}

/**
 * Refresh eBay cache for one product and re-read the variant candidate.
 *
 * @param {Object} params
 * @param {string} params.variantId
 * @param {string} params.productId
 * @param {Record<string, string>|null} [params.syncContext]
 * @param {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} [params.candidate]
 * @returns {Promise<AdjustEbayCacheRefreshResult>}
 */
export async function runAdjustEbayCacheRefreshChain({
  variantId,
  productId,
  syncContext = null,
  candidate = null,
}) {
  const vid = String(variantId || "").trim();
  const pid = String(productId || "").trim();

  if (!vid) {
    return chainResult("skipped", "skipped", null, null, "manual", "Missing variant id — cache refresh skipped.");
  }
  if (!pid) {
    return chainResult("skipped", "skipped", null, null, "manual", "Missing product id — cache refresh skipped.");
  }

  const preAction = candidate?.ebay_sync_action ?? null;
  if (preAction && SKIP_BEFORE_REFRESH.has(preAction)) {
    const nextAction = mapEbayCacheNextAction(preAction);
    return chainResult(
      "skipped",
      "skipped",
      null,
      candidate,
      nextAction,
      `eBay cache refresh skipped — candidate is ${preAction}.`,
    );
  }

  let cacheRefresh;
  try {
    const data = await refreshEbayListingCache({
      productIds: [pid],
      limit: 1,
      syncContext,
    });
    const summary = data.summary || {};
    const productResult = (data.results || []).find((r) => String(r.productId) === pid);
    const refreshStatus = productResult?.status === "success"
      ? "success"
      : productResult?.status === "skipped"
        ? "skipped"
        : summary.failed > 0
          ? "failed"
          : summary.succeeded > 0
            ? "success"
            : "failed";

    cacheRefresh = {
      status: /** @type {ChainStatus} */ (refreshStatus),
      message: refreshMessage(refreshStatus, productResult, summary),
      runId: data.runId ?? data.run_id ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return chainResult(
      "failed",
      "failed",
      null,
      candidate,
      mapEbayCacheNextAction(preAction),
      message,
    );
  }

  if (cacheRefresh.status === "failed") {
    return chainResult(
      "failed",
      cacheRefresh.status,
      cacheRefresh,
      candidate,
      "manual",
      cacheRefresh.message,
    );
  }

  let refreshedCandidate = null;
  try {
    const bundle = await fetchChannelSyncCandidateForVariant(vid);
    refreshedCandidate = bundle.candidate;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return chainResult(
      "failed",
      cacheRefresh.status,
      cacheRefresh,
      candidate,
      "manual",
      `Cache refreshed but candidate re-read failed: ${message}`,
    );
  }

  const action = refreshedCandidate?.ebay_sync_action ?? null;
  const nextAction = mapEbayCacheNextAction(action);
  const chainStatus = cacheRefresh.status === "skipped" ? "skipped" : "success";
  const message = nextAction === "update_qty"
    ? "eBay cache refreshed — candidate ready for quantity push."
    : action === "qty_cache_missing"
      ? "eBay cache refreshed but quantity cache is still missing."
      : `eBay cache refreshed — next action: ${nextAction}.`;

  return chainResult(chainStatus, cacheRefresh.status, cacheRefresh, refreshedCandidate, nextAction, message);
}

/**
 * @param {ChainStatus} status
 * @param {ChainStatus} cacheStatus
 * @param {{ status: ChainStatus, message: string, runId: string|null }|null} cacheRefresh
 * @param {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} candidate
 * @param {EbayCacheNextAction} nextAction
 * @param {string} message
 */
function chainResult(status, cacheStatus, cacheRefresh, candidate, nextAction, message) {
  return {
    status,
    cacheRefresh: cacheRefresh ?? {
      status: cacheStatus,
      message,
      runId: null,
    },
    candidate,
    nextAction,
    message,
  };
}

/** @param {ChainStatus} status @param {Record<string, unknown>|undefined} productResult @param {Record<string, unknown>} summary */
function refreshMessage(status, productResult, summary) {
  if (status === "success") {
    const rows = productResult?.rows ?? 0;
    return `eBay cache refresh succeeded${rows ? ` (${rows} row(s))` : ""}.`;
  }
  if (status === "skipped") {
    return productResult?.errors
      ? `eBay cache refresh skipped: ${JSON.stringify(productResult.errors)}`
      : "eBay cache refresh skipped — no cache rows returned.";
  }
  return productResult?.error
    ? String(productResult.error)
    : `eBay cache refresh failed (${summary.failed ?? 0} failed).`;
}
