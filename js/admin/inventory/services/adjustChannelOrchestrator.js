/**
 * Adjust + safe channel sync orchestrator (Phase 059A.3).
 * adjust_inventory is the only stock writer; channel APIs run after KK success.
 * Amazon/eBay branches live in channelSyncForVariant.js (shared with parcel receive).
 */

import { adjustInventory } from "../api/adjustInventoryApi.js";
import { fetchChannelSyncCandidateForVariant } from "../api/channelSyncCandidateApi.js";
import { buildAdjustSyncContext } from "./adjustSyncContext.js";
import { resolveEbayBranch } from "./adjustChannelEbayBranch.js";
import {
  resolveAmazonBranch,
  skippedChannel,
} from "./channelSyncForVariant.js";
import {
  ADJUST_KK_SUCCESS_COPY,
  ADJUST_KK_UNCHANGED_SYNC_COPY,
} from "./adjustOrchestratorSummary.js";

/** @typedef {import('./channelSyncForVariant.js').ChannelStepResult} ChannelStepResult */

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
