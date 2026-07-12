/**
 * Adjust + safe channel sync orchestrator (Phase 059A.3).
 * adjust_inventory is the only stock writer; channel APIs run after KK success.
 */

import { adjustInventory } from "../api/adjustInventoryApi.js";
import { fetchChannelSyncCandidateForVariant } from "../api/channelSyncCandidateApi.js";
import { pushAmazonFbmInventory } from "../api/amazonSyncPushApi.js";
import {
  resolveAmazonChannelStep,
} from "./adjustChannelNextSteps.js";
import { buildAdjustSyncContext } from "./adjustSyncContext.js";
import { resolveEbayBranch } from "./adjustChannelEbayBranch.js";
import {
  ADJUST_KK_SUCCESS_COPY,
  ADJUST_KK_UNCHANGED_SYNC_COPY,
  AMAZON_DRY_RUN_COPY,
  AMAZON_SYNC_FAILED_COPY,
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

/**
 * @typedef {Object} AdjustOrchestrationResult
 * @property {string} orchestrationId
 * @property {boolean} syncChannelsEnabled
 * @property {{ status: 'success'|'failed', message: string, ledgerId: string, stockAfter: number, delta: number, stockBefore: number }} kk
 * @property {ChannelStepResult} amazon
 * @property {ChannelStepResult} ebay
 * @property {string[]} warnings
 * @property {string[]} errors
 */

/** @returns {ChannelStepResult} */
function skippedChannel(message, action = null) {
  return { status: "skipped", action, message, nextStepUrl: null, runId: null };
}

/**
 * @param {string} variantId
 * @param {string[]} warnings
 * @param {string[]} errors
 * @param {Record<string, string>|null} syncContext
 */
async function runAmazonUpdateQty(variantId, warnings, errors, syncContext) {
  const action = "update_qty";
  try {
    const data = await pushAmazonFbmInventory({
      variantIds: [variantId],
      limit: 1,
      syncContext,
    });
    const succeeded = Number(data.succeeded ?? data.success_count ?? data.summary?.succeeded ?? 0);
    const runId = data.runId ?? data.run_id ?? null;
    if (succeeded > 0) {
      return {
        status: "success",
        action,
        message: "Amazon FBM quantity sync requested.",
        nextStepUrl: null,
        runId,
      };
    }
    const failMsg = data.message || "Amazon sync returned no successful updates.";
    warnings.push(failMsg);
    errors.push(`Amazon: ${failMsg}`);
    return {
      status: "failed",
      action,
      message: AMAZON_SYNC_FAILED_COPY,
      nextStepUrl: "/pages/admin/inventory.html",
      runId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Amazon: ${message}`);
    return {
      status: "failed",
      action,
      message: AMAZON_SYNC_FAILED_COPY,
      nextStepUrl: "/pages/admin/inventory.html",
      runId: null,
    };
  }
}

/**
 * @param {string} variantId
 * @param {string[]} warnings
 * @param {string[]} errors
 * @param {Record<string, string>|null} syncContext
 */
async function runAmazonInactiveRestock(variantId, warnings, errors, syncContext) {
  const action = "inactive_can_update";
  try {
    const data = await pushAmazonFbmInventory({
      mode: "inactive_restock",
      variantIds: [variantId],
      limit: 1,
      syncContext,
    });
    const runId = data.runId ?? data.run_id ?? null;
    const row = Array.isArray(data.results) ? data.results[0] : null;
    const innerStatus = row?.status ?? null;
    const succeeded = Number(data.summary?.succeeded ?? 0);

    if (innerStatus === "success" || succeeded > 0) {
      return {
        status: "success",
        action,
        message: "Amazon inactive offer restore requested.",
        nextStepUrl: null,
        runId,
      };
    }

    if (innerStatus === "dry_run") {
      const msg = row?.message || AMAZON_DRY_RUN_COPY;
      warnings.push(msg);
      return {
        status: "dry_run",
        action,
        message: AMAZON_DRY_RUN_COPY,
        nextStepUrl: "/pages/admin/inventory.html",
        runId,
      };
    }

    if (innerStatus === "skipped") {
      return {
        status: "skipped",
        action,
        message: row?.message || "Amazon inactive restore skipped.",
        nextStepUrl: null,
        runId,
      };
    }

    const failMsg =
      row?.message || data.message || AMAZON_SYNC_FAILED_COPY;
    warnings.push(failMsg);
    errors.push(`Amazon: ${failMsg}`);
    return {
      status: "failed",
      action,
      message: AMAZON_SYNC_FAILED_COPY,
      nextStepUrl: "/pages/admin/inventory.html",
      runId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Amazon: ${message}`);
    return {
      status: "failed",
      action,
      message: AMAZON_SYNC_FAILED_COPY,
      nextStepUrl: "/pages/admin/inventory.html",
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
async function resolveAmazonBranch(candidate, variantId, productCodeHint, warnings, errors, syncContext) {
  const action = candidate?.amazon_sync_action ?? null;
  if (action === "update_qty") {
    return runAmazonUpdateQty(variantId, warnings, errors, syncContext);
  }
  if (action === "inactive_can_update") {
    return runAmazonInactiveRestock(variantId, warnings, errors, syncContext);
  }
  const next = resolveAmazonChannelStep(action, productCodeHint);
  return next ? { ...next, runId: null } : skippedChannel("Amazon sync not applicable.", action);
}

/**
 * @param {Object} params
 * @param {import('./mapWorkspaceRow.js').InventoryRow} params.row
 * @param {import('../api/adjustInventoryApi.js').AdjustInventoryParams} params.adjustParams
 * @param {boolean} params.syncChannelsEnabled
 * @param {number} params.reservedQty
 * @returns {Promise<AdjustOrchestrationResult>}
 */
export async function runAdjustChannelOrchestration({
  row,
  adjustParams,
  syncChannelsEnabled,
  reservedQty,
}) {
  const orchestrationId = String(adjustParams.idempotencyKey || "");
  const warnings = [];
  const errors = [];
  const productCodeHint = String(row.shortSku || row.internalSku || "").trim();

  /** @type {AdjustOrchestrationResult} */
  const base = {
    orchestrationId,
    syncChannelsEnabled,
    kk: {
      status: "failed",
      message: "",
      ledgerId: "",
      stockAfter: 0,
      delta: 0,
      stockBefore: 0,
    },
    amazon: skippedChannel("Channel sync not requested."),
    ebay: skippedChannel("Channel sync not requested."),
    warnings,
    errors,
  };

  let kkResult;
  const deltaQty = Number(adjustParams.deltaQty) || 0;

  if (deltaQty === 0) {
    if (!syncChannelsEnabled) {
      const message =
        "KK stock is already at this quantity. Turn on marketplace sync to push channels without changing stock.";
      base.kk = {
        status: "failed",
        message,
        ledgerId: "",
        stockAfter: row.onHand,
        delta: 0,
        stockBefore: row.onHand,
      };
      base.errors.push(message);
      return base;
    }

    kkResult = {
      variantId: adjustParams.variantId,
      productId: "",
      delta: 0,
      stockBefore: row.onHand,
      stockAfter: row.onHand,
      ledgerId: "",
      createdAt: new Date().toISOString(),
      idempotentReplay: false,
    };
  } else {
    try {
      kkResult = await adjustInventory(adjustParams);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      base.kk = {
        status: "failed",
        message,
        ledgerId: "",
        stockAfter: row.onHand,
        delta: 0,
        stockBefore: row.onHand,
      };
      base.errors.push(message);
      return base;
    }
  }

  base.kk = {
    status: "success",
    message: deltaQty === 0 ? ADJUST_KK_UNCHANGED_SYNC_COPY : ADJUST_KK_SUCCESS_COPY,
    ledgerId: kkResult.ledgerId,
    stockAfter: kkResult.stockAfter,
    delta: kkResult.delta,
    stockBefore: kkResult.stockBefore,
  };

  const syncContext = buildAdjustSyncContext(orchestrationId, kkResult.ledgerId);

  const projectedAvailable = kkResult.stockAfter - (Number(reservedQty) || 0);

  if (!syncChannelsEnabled) {
    base.amazon = skippedChannel("Sync channels after adjust is off.");
    base.ebay = skippedChannel("Sync channels after adjust is off.");
    return base;
  }

  if (projectedAvailable < 0) {
    const msg = "Marketplace sync skipped — projected available quantity is negative.";
    warnings.push(msg);
    base.amazon = skippedChannel(msg);
    base.ebay = skippedChannel(msg);
    return base;
  }

  let candidate = null;
  let relist = null;
  try {
    const bundle = await fetchChannelSyncCandidateForVariant(row.id);
    candidate = bundle.candidate;
    relist = bundle.relist;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Could not reload channel candidate: ${message}`);
  }

  base.amazon = await resolveAmazonBranch(
    candidate,
    row.id,
    productCodeHint,
    warnings,
    errors,
    syncContext,
  );
  base.ebay = await resolveEbayBranch(
    candidate,
    row.id,
    productCodeHint,
    warnings,
    errors,
    syncContext,
    { relist, availableQty: projectedAvailable },
  );

  return base;
}
