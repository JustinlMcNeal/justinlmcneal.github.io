/**
 * eBay adjust orchestration branch helpers (Phase 059C.3 / 059D.3 relist).
 */

import { pushEbayInventoryQuantity } from "../api/ebaySyncPushApi.js";
import { relistEbayFromProduct } from "../api/ebayRelistFromProductApi.js";
import { runAdjustEbayCacheRefreshChain } from "./adjustChannelEbayCache.js";
import { resolveEbayChannelStep } from "./adjustChannelNextSteps.js";
import { resolveEbayVariationBranch } from "./adjustChannelEbayVariationBranch.js";
import { kkEbayListingsAdminUrl } from "../api/ebayRelistAssistApi.js";
import { EBAY_LISTINGS_PAGE } from "../constants/channelLinks.js";
import {
  EBAY_CACHE_FAILED_COPY,
  EBAY_QTY_FAILED_COPY,
  EBAY_RELIST_DRY_RUN_COPY,
  EBAY_RELIST_FAILED_COPY,
  EBAY_RELIST_MANUAL_COPY,
} from "./adjustOrchestratorSummary.js";

/** @typedef {'skipped'|'success'|'failed'|'next_step'|'pending'|'manual'|'dry_run'} ChannelStepStatus */

/**
 * @typedef {Object} ChannelStepResult
 * @property {ChannelStepStatus} status
 * @property {string|null} action
 * @property {string} message
 * @property {string|null} [nextStepUrl]
 * @property {string|null} [runId]
 * @property {string|null} [detail]
 * @property {string|null} [listingId]
 * @property {string|null} [offerId]
 */

/** @returns {ChannelStepResult} */
function skippedChannel(message, action = null) {
  return { status: "skipped", action, message, nextStepUrl: null, runId: null };
}

/**
 * @param {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} candidate
 * @param {string} variantId
 * @param {string[]} warnings
 * @param {string[]} errors
 * @param {Record<string, string>|null} syncContext
 */
export async function runEbayUpdateQty(candidate, variantId, warnings, errors, syncContext) {
  const action = "update_qty";
  const available = Number(candidate?.available_qty ?? 0);
  if (available <= 0) {
    return {
      status: "skipped",
      action,
      message: "eBay qty push skipped — available quantity is zero.",
      nextStepUrl: null,
      runId: null,
    };
  }

  try {
    const data = await pushEbayInventoryQuantity({
      variantIds: [variantId],
      limit: 1,
      syncContext,
    });
    const succeeded = Number(data.succeeded ?? data.success_count ?? 0);
    const runId = data.runId ?? data.run_id ?? null;
    if (succeeded > 0) {
      return {
        status: "success",
        action,
        message: "eBay quantity sync requested.",
        nextStepUrl: null,
        runId,
      };
    }
    const failMsg = data.message || "eBay sync returned no successful updates.";
    warnings.push(failMsg);
    errors.push(`eBay: ${failMsg}`);
    return {
      status: "failed",
      action,
      message: EBAY_QTY_FAILED_COPY,
      nextStepUrl: "/pages/admin/inventory.html",
      runId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`eBay: ${message}`);
    return {
      status: "failed",
      action,
      message: EBAY_QTY_FAILED_COPY,
      nextStepUrl: "/pages/admin/inventory.html",
      runId: null,
    };
  }
}

/**
 * Map relist-ebay-from-product edge response to adjust channel step.
 * @param {Awaited<ReturnType<typeof relistEbayFromProduct>>} data
 * @param {string} productCodeHint
 * @param {string[]} warnings
 * @param {string[]} errors
 * @param {string|null} [detail]
 */
function mapRelistEdgeResponse(data, productCodeHint, warnings, errors, detail = null) {
  const action = "ended_needs_relist";
  const runId = data.runId ?? data.run_id ?? null;
  const listingId = data.listingId ?? data.listing_id ?? null;
  const offerId = data.offerId ?? data.offer_id ?? null;
  const relistAssistUrl = productCodeHint ? kkEbayListingsAdminUrl(productCodeHint) : EBAY_LISTINGS_PAGE;
  const idsDetail = [listingId ? `listing ${listingId}` : null, offerId ? `offer ${offerId}` : null]
    .filter(Boolean)
    .join(" · ");
  const base = { action, runId, listingId, offerId, detail: detail || idsDetail || null };

  switch (data.status) {
    case "success":
      return {
        ...base,
        status: "success",
        message: "eBay listing relisted successfully.",
        nextStepUrl: null,
        detail: idsDetail || base.detail,
      };
    case "dry_run": {
      const msg = data.message || EBAY_RELIST_DRY_RUN_COPY;
      if (msg !== EBAY_RELIST_DRY_RUN_COPY) warnings.push(msg);
      return {
        ...base,
        status: "dry_run",
        message: EBAY_RELIST_DRY_RUN_COPY,
        nextStepUrl: relistAssistUrl,
      };
    }
    case "manual": {
      const msg = data.message || EBAY_RELIST_MANUAL_COPY;
      if (msg !== EBAY_RELIST_MANUAL_COPY) warnings.push(msg);
      return {
        ...base,
        status: "manual",
        message: EBAY_RELIST_MANUAL_COPY,
        nextStepUrl: relistAssistUrl,
      };
    }
    case "skipped":
      return {
        ...base,
        status: "skipped",
        message: data.message || "eBay relist skipped.",
        nextStepUrl: null,
      };
    case "failed":
    default: {
      const msg = data.message || EBAY_RELIST_FAILED_COPY;
      warnings.push(msg);
      errors.push(`eBay: ${msg}`);
      return {
        ...base,
        status: "failed",
        message: EBAY_RELIST_FAILED_COPY,
        nextStepUrl: relistAssistUrl,
        detail: idsDetail || data.message || null,
      };
    }
  }
}

/**
 * @param {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} candidate
 * @param {string} variantId
 * @param {string} productCodeHint
 * @param {string[]} warnings
 * @param {string[]} errors
 * @param {Record<string, string>|null} syncContext
 */
export async function runEbayEndedRelist(candidate, variantId, productCodeHint, warnings, errors, syncContext) {
  const action = "ended_needs_relist";
  const productId = String(candidate?.product_id || "").trim();
  const available = Number(candidate?.available_qty ?? 0);

  if (available <= 0) {
    return {
      status: "skipped",
      action,
      message: "eBay relist skipped — available quantity is zero.",
      nextStepUrl: null,
      runId: null,
    };
  }
  if (!productId) {
    return {
      status: "skipped",
      action,
      message: "eBay relist skipped — missing product id.",
      nextStepUrl: null,
      runId: null,
    };
  }

  try {
    const data = await relistEbayFromProduct({
      productId,
      variantId,
      quantity: available,
      preview: false,
      syncContext,
    });
    return mapRelistEdgeResponse(data, productCodeHint, warnings, errors);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`eBay: ${message}`);
    return {
      status: "failed",
      action,
      message: EBAY_RELIST_FAILED_COPY,
      nextStepUrl: productCodeHint ? kkEbayListingsAdminUrl(productCodeHint) : EBAY_LISTINGS_PAGE,
      runId: null,
    };
  }
}

/**
 * @param {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} candidate
 * @param {string} variantId
 * @param {string} productCodeHint
 * @param {string[]} warnings
 * @param {string[]} errors
 * @param {Record<string, string>|null} syncContext
 */
export async function runEbayQtyCacheMissing(candidate, variantId, productCodeHint, warnings, errors, syncContext) {
  const action = "qty_cache_missing";
  const productId = String(candidate?.product_id || "").trim();
  const available = Number(candidate?.available_qty ?? 0);

  if (available <= 0) {
    return {
      status: "skipped",
      action,
      message: "eBay cache refresh skipped — available quantity is zero.",
      nextStepUrl: null,
      runId: null,
    };
  }
  if (!productId) {
    return {
      status: "skipped",
      action,
      message: "eBay cache refresh skipped — missing product id.",
      nextStepUrl: null,
      runId: null,
    };
  }

  const chain = await runAdjustEbayCacheRefreshChain({
    variantId,
    productId,
    candidate,
    syncContext,
  });

  const cacheDetail = chain.cacheRefresh?.message || chain.message;

  if (chain.status === "failed" || chain.cacheRefresh?.status === "failed") {
    const message = EBAY_CACHE_FAILED_COPY;
    warnings.push(message);
    errors.push(`eBay: ${cacheDetail}`);
    return {
      status: "failed",
      action,
      message,
      detail: cacheDetail,
      nextStepUrl: "/pages/admin/inventory.html",
      runId: chain.cacheRefresh?.runId ?? null,
    };
  }

  const refreshed = chain.candidate;
  const refreshedAction = refreshed?.ebay_sync_action ?? null;

  if (chain.nextAction === "update_qty" && refreshedAction === "update_qty") {
    const pushResult = await runEbayUpdateQty(refreshed, variantId, warnings, errors, syncContext);
    return {
      ...pushResult,
      action,
      message:
        pushResult.status === "success"
          ? "eBay cache refreshed and quantity sync requested."
          : pushResult.message,
      detail: cacheDetail,
      runId: pushResult.runId || chain.cacheRefresh?.runId || null,
    };
  }

  if (chain.nextAction === "ended_relist" || refreshedAction === "ended_needs_relist") {
    const relistResult = await runEbayEndedRelist(refreshed, variantId, productCodeHint, warnings, errors, syncContext);
    return { ...relistResult, detail: relistResult.detail || cacheDetail, runId: relistResult.runId || chain.cacheRefresh?.runId || null };
  }

  if (chain.nextAction === "unsupported_variation" || refreshedAction === "unsupported_variation") {
    return {
      status: "next_step",
      action: "unsupported_variation",
      message: "eBay variation listing requires manual review.",
      detail: cacheDetail,
      nextStepUrl: productCodeHint ? kkEbayListingsAdminUrl(productCodeHint) : EBAY_LISTINGS_PAGE,
      runId: chain.cacheRefresh?.runId ?? null,
    };
  }

  if (chain.nextAction === "no_change" || refreshedAction === "no_change") {
    return {
      status: "skipped",
      action: "no_change",
      message: "eBay quantity already matches after cache refresh.",
      detail: cacheDetail,
      nextStepUrl: null,
      runId: chain.cacheRefresh?.runId ?? null,
    };
  }

  if (refreshedAction === "qty_cache_missing" || chain.nextAction === "manual") {
    return {
      status: "next_step",
      action: "qty_cache_missing",
      message: "eBay cache refreshed, but quantity is still unavailable. Retry from Sync Channels.",
      detail: cacheDetail,
      nextStepUrl: "/pages/admin/inventory.html",
      runId: chain.cacheRefresh?.runId ?? null,
    };
  }

  const next = resolveEbayChannelStep(refreshedAction, productCodeHint);
  if (next) {
    return { ...next, detail: cacheDetail, runId: chain.cacheRefresh?.runId ?? null };
  }

  return {
    status: "skipped",
    action: refreshedAction || action,
    message: chain.message || "eBay cache refreshed — no quantity push.",
    detail: cacheDetail,
    nextStepUrl: "/pages/admin/inventory.html",
    runId: chain.cacheRefresh?.runId ?? null,
  };
}

/**
 * @param {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} candidate
 * @param {string} variantId
 * @param {string} productCodeHint
 * @param {string[]} warnings
 * @param {string[]} errors
 * @param {Record<string, string>|null} syncContext
 * @param {{ relist?: import('../api/channelSyncCandidateApi.js').EbayRelistCandidateRow|null, availableQty?: number }} [opts]
 */
export async function resolveEbayBranch(
  candidate,
  variantId,
  productCodeHint,
  warnings,
  errors,
  syncContext,
  opts = {},
) {
  const relist = opts.relist ?? null;
  const availableQty = Number(
    opts.availableQty ?? candidate?.available_qty ?? 0,
  );
  const action = candidate?.ebay_sync_action ?? null;

  if (action === "update_qty") {
    return runEbayUpdateQty(candidate, variantId, warnings, errors, syncContext);
  }
  if (action === "qty_cache_missing") {
    return runEbayQtyCacheMissing(candidate, variantId, productCodeHint, warnings, errors, syncContext);
  }
  if (action === "ended_needs_relist") {
    const relistAction = relist?.relist_action ?? null;
    if (relistAction !== "unsupported_variation") {
      if (!relistAction || relistAction === "ready_to_relist") {
        return runEbayEndedRelist(candidate, variantId, productCodeHint, warnings, errors, syncContext);
      }
    }
  } else if (action !== "unsupported_variation") {
    const next = resolveEbayChannelStep(action, productCodeHint);
    if (next) return { ...next, runId: null };
    if (action !== "ended_needs_relist") {
      return skippedChannel("eBay sync not applicable.", action);
    }
  }

  const variationResult = await resolveEbayVariationBranch({
    candidate,
    relist,
    variantId,
    productCodeHint,
    availableQty,
    warnings,
    errors,
    syncContext,
  });
  if (variationResult) return variationResult;

  const fallback = resolveEbayChannelStep(action, productCodeHint);
  return fallback ? { ...fallback, runId: null } : skippedChannel("eBay sync not applicable.", action);
}
