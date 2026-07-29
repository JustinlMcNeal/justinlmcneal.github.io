/**
 * Sync-only marketplace push for one variant (Adjust + parcel receive).
 * Does not write KK stock — callers update stock first.
 */

import { fetchChannelSyncCandidateForVariant } from "../api/channelSyncCandidateApi.js";
import { pushAmazonFbmInventory } from "../api/amazonSyncPushApi.js";
import { resolveAmazonChannelStep } from "./adjustChannelNextSteps.js";
import { resolveEbayBranch } from "./adjustChannelEbayBranch.js";
import {
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
 * @typedef {Object} ChannelSyncForVariantResult
 * @property {string} variantId
 * @property {number|null} availableQty
 * @property {ChannelStepResult} amazon
 * @property {ChannelStepResult} ebay
 * @property {string[]} warnings
 * @property {string[]} errors
 */

/** @returns {ChannelStepResult} */
export function skippedChannel(message, action = null) {
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

    const failMsg = row?.message || data.message || AMAZON_SYNC_FAILED_COPY;
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
export async function resolveAmazonBranch(
  candidate,
  variantId,
  productCodeHint,
  warnings,
  errors,
  syncContext,
) {
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
 * Push mapped eBay/Amazon qty for one variant after KK stock is already correct.
 *
 * @param {Object} params
 * @param {string} params.variantId
 * @param {number} [params.stockAfter] on-hand after KK write (preferred for available calc)
 * @param {number} [params.reservedQty] reserved units; falls back to candidate.reserved_qty
 * @param {string} [params.productCodeHint]
 * @param {Record<string, string>|null} [params.syncContext]
 * @returns {Promise<ChannelSyncForVariantResult>}
 */
export async function runChannelSyncForVariant({
  variantId,
  stockAfter = null,
  reservedQty = null,
  productCodeHint = "",
  syncContext = null,
}) {
  const id = String(variantId || "").trim();
  const warnings = [];
  const errors = [];

  /** @type {ChannelSyncForVariantResult} */
  const base = {
    variantId: id,
    availableQty: null,
    amazon: skippedChannel("No variant id."),
    ebay: skippedChannel("No variant id."),
    warnings,
    errors,
  };

  if (!id) return base;

  let candidate = null;
  let relist = null;
  try {
    const bundle = await fetchChannelSyncCandidateForVariant(id);
    candidate = bundle.candidate;
    relist = bundle.relist;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Could not load channel candidate: ${message}`);
  }

  const reserved =
    reservedQty != null && Number.isFinite(Number(reservedQty))
      ? Number(reservedQty)
      : Number(candidate?.reserved_qty ?? 0) || 0;

  let availableQty;
  if (stockAfter != null && Number.isFinite(Number(stockAfter))) {
    availableQty = Number(stockAfter) - reserved;
  } else if (candidate?.available_qty != null) {
    availableQty = Number(candidate.available_qty);
  } else {
    availableQty = null;
  }

  base.availableQty = availableQty;

  if (availableQty == null) {
    const msg = "Marketplace sync skipped — could not resolve available quantity.";
    warnings.push(msg);
    base.amazon = skippedChannel(msg);
    base.ebay = skippedChannel(msg);
    return base;
  }

  if (availableQty < 0) {
    const msg = "Marketplace sync skipped — projected available quantity is negative.";
    warnings.push(msg);
    base.amazon = skippedChannel(msg);
    base.ebay = skippedChannel(msg);
    return base;
  }

  const hint =
    String(productCodeHint || "").trim() ||
    String(candidate?.product_id || "").trim();

  base.amazon = await resolveAmazonBranch(
    candidate,
    id,
    hint,
    warnings,
    errors,
    syncContext,
  );
  base.ebay = await resolveEbayBranch(
    candidate,
    id,
    hint,
    warnings,
    errors,
    syncContext,
    { relist, availableQty },
  );

  return base;
}

/**
 * @param {string} importId
 * @returns {Record<string, string>|null}
 */
export function buildParcelReceiveSyncContext(importId) {
  const id = String(importId || "").trim();
  if (!id) return null;
  return {
    trigger_source: "parcel_receive",
    trigger_reference_type: "parcel_import",
    trigger_reference_id: id,
    orchestration_id: `parcel_receive:${id}`,
  };
}

/**
 * Summarize many per-variant channel sync results for status UI.
 *
 * @param {ChannelSyncForVariantResult[]} results
 */
export function summarizeChannelSyncBatch(results) {
  const tallies = {
    ebay: { ok: 0, failed: 0, skipped: 0, other: 0 },
    amazon: { ok: 0, failed: 0, skipped: 0, other: 0 },
  };

  /** @param {'ebay'|'amazon'} channel @param {ChannelStepResult|undefined} step */
  function count(channel, step) {
    const status = step?.status || "skipped";
    if (status === "success") tallies[channel].ok += 1;
    else if (status === "failed") tallies[channel].failed += 1;
    else if (status === "skipped") tallies[channel].skipped += 1;
    else tallies[channel].other += 1;
  }

  for (const r of results || []) {
    count("ebay", r.ebay);
    count("amazon", r.amazon);
  }

  const parts = [
    `eBay ${tallies.ebay.ok} ok` +
      (tallies.ebay.failed ? `, ${tallies.ebay.failed} failed` : "") +
      (tallies.ebay.skipped ? `, ${tallies.ebay.skipped} skipped` : "") +
      (tallies.ebay.other ? `, ${tallies.ebay.other} other` : ""),
    `Amazon ${tallies.amazon.ok} ok` +
      (tallies.amazon.failed ? `, ${tallies.amazon.failed} failed` : "") +
      (tallies.amazon.skipped ? `, ${tallies.amazon.skipped} skipped` : "") +
      (tallies.amazon.other ? `, ${tallies.amazon.other} other` : ""),
  ];

  return {
    tallies,
    line: `Channels: ${parts.join("; ")}.`,
    hasFailures: tallies.ebay.failed > 0 || tallies.amazon.failed > 0,
  };
}

const CHANNEL_SYNC_DELAY_MS = 350;

/**
 * Sequential best-effort sync for many variants (parcel receive).
 *
 * @param {Object} params
 * @param {Array<{ variant_id?: string, variantId?: string, stock_after?: number, stockAfter?: number, qty_received?: number }>} params.variants
 * @param {string} params.importId
 * @returns {Promise<{ results: ChannelSyncForVariantResult[], summary: ReturnType<typeof summarizeChannelSyncBatch> }>}
 */
export async function runChannelSyncForParcelVariants({ variants, importId }) {
  const syncContext = buildParcelReceiveSyncContext(importId);
  const results = [];
  const list = Array.isArray(variants) ? variants : [];

  for (let i = 0; i < list.length; i++) {
    const row = list[i] || {};
    const variantId = String(row.variant_id || row.variantId || "").trim();
    if (!variantId) continue;

    const stockAfter = row.stock_after ?? row.stockAfter ?? null;
    const result = await runChannelSyncForVariant({
      variantId,
      stockAfter: stockAfter == null ? null : Number(stockAfter),
      syncContext,
    });
    results.push(result);

    if (i < list.length - 1) {
      await new Promise((r) => setTimeout(r, CHANNEL_SYNC_DELAY_MS));
    }
  }

  return { results, summary: summarizeChannelSyncBatch(results) };
}
