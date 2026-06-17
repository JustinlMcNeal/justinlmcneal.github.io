/**
 * eBay variation adjust orchestration branch (Phase 060C.3).
 * Active child qty sync + ended group relist — post-adjust only; no stock writes.
 */

import { fetchEbayVariationChildCandidate } from "../api/ebayVariationCandidateApi.js";
import { fetchEbayVariationRelistCandidate } from "../api/ebayVariationRelistCandidateApi.js";
import { syncEbayVariationChildQuantity } from "../api/ebayVariationQtySyncApi.js";
import { relistEbayVariationGroup } from "../api/ebayVariationGroupRelistApi.js";
import { kkEbayListingsAdminUrl } from "../api/ebayRelistAssistApi.js";
import { EBAY_LISTINGS_PAGE } from "../constants/channelLinks.js";
import {
  shouldFetchVariationChildCandidate,
  shouldFetchVariationRelistCandidate,
} from "./adjustChannelVariationPreview.js";
import { resolveEbayVariationManualStep } from "./adjustChannelNextSteps.js";
import {
  EBAY_VARIATION_GROUP_RELIST_DRY_RUN_COPY,
  EBAY_VARIATION_GROUP_RELIST_FAILED_COPY,
  EBAY_VARIATION_GROUP_RELIST_MANUAL_COPY,
  EBAY_VARIATION_GROUP_RELIST_SKIPPED_COPY,
  EBAY_VARIATION_GROUP_RELIST_SUCCESS_COPY,
  EBAY_VARIATION_QTY_DRY_RUN_COPY,
  EBAY_VARIATION_QTY_FAILED_COPY,
  EBAY_VARIATION_QTY_MANUAL_COPY,
  EBAY_VARIATION_QTY_SKIPPED_COPY,
  EBAY_VARIATION_QTY_SUCCESS_COPY,
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
 * @property {string|null} [groupKey]
 */

const GROUP_RELIST_STATES = new Set([
  "variation_group_ready_to_relist",
  "variation_group_relist_dry_run_ready",
]);

const CHILD_MANUAL_STATES = new Set([
  "variation_mapping_missing",
  "variation_mapping_ambiguous",
  "variation_child_offer_missing",
  "variation_parent_inactive",
  "variation_manual",
]);

const GROUP_MANUAL_STATES = new Set([
  "variation_group_missing_metadata",
  "variation_group_missing_aspects",
  "variation_group_missing_images",
  "variation_group_mapping_missing",
  "variation_group_mapping_ambiguous",
  "variation_group_child_offer_conflict",
  "variation_group_unsupported_structure",
  "variation_group_manual",
  "variation_group_no_in_stock_children",
]);

/**
 * @param {import('../api/ebayVariationRelistCandidateApi.js').EbayVariationGroupRelistCandidateRow|null} row
 */
function isGroupRelistRunnable(row) {
  if (!row) return false;
  if (row.candidate_state === "variation_group_active") return false;
  if (!GROUP_RELIST_STATES.has(row.candidate_state)) return false;
  return Number(row.in_stock_child_count ?? 0) > 0;
}

/**
 * @param {Awaited<ReturnType<typeof syncEbayVariationChildQuantity>>} data
 * @param {string} productCodeHint
 * @param {string[]} warnings
 * @param {string[]} errors
 */
function mapVariationQtyResponse(data, productCodeHint, warnings, errors) {
  const action = "variation_update_qty";
  const runId = data.runId ?? data.run_id ?? null;
  const childSku = data.childSku ?? data.child_sku ?? null;
  const childOfferId = data.childOfferId ?? data.child_offer_id ?? null;
  const listingId = data.parentListingId ?? data.parent_listing_id ?? null;
  const detailParts = [
    childSku ? `SKU ${childSku}` : null,
    childOfferId ? `offer ${childOfferId}` : null,
    listingId ? `parent ${listingId}` : null,
  ].filter(Boolean);
  const detail = detailParts.join(" · ") || null;
  const listingsUrl = productCodeHint ? kkEbayListingsAdminUrl(productCodeHint) : EBAY_LISTINGS_PAGE;
  const base = { action, runId, listingId, offerId: childOfferId, detail };

  switch (data.status) {
    case "success":
      return { ...base, status: "success", message: EBAY_VARIATION_QTY_SUCCESS_COPY, nextStepUrl: null };
    case "dry_run": {
      const msg = data.message || EBAY_VARIATION_QTY_DRY_RUN_COPY;
      if (msg !== EBAY_VARIATION_QTY_DRY_RUN_COPY) warnings.push(msg);
      return { ...base, status: "dry_run", message: EBAY_VARIATION_QTY_DRY_RUN_COPY, nextStepUrl: listingsUrl };
    }
    case "manual": {
      const msg = data.message || EBAY_VARIATION_QTY_MANUAL_COPY;
      if (msg !== EBAY_VARIATION_QTY_MANUAL_COPY) warnings.push(msg);
      return { ...base, status: "manual", message: EBAY_VARIATION_QTY_MANUAL_COPY, nextStepUrl: listingsUrl };
    }
    case "skipped":
      return {
        ...base,
        status: "skipped",
        message: data.message || EBAY_VARIATION_QTY_SKIPPED_COPY,
        nextStepUrl: null,
      };
    case "failed":
    default: {
      const msg = data.message || EBAY_VARIATION_QTY_FAILED_COPY;
      warnings.push(msg);
      errors.push(`eBay: ${msg}`);
      return { ...base, status: "failed", message: EBAY_VARIATION_QTY_FAILED_COPY, nextStepUrl: listingsUrl };
    }
  }
}

/**
 * @param {Awaited<ReturnType<typeof relistEbayVariationGroup>>} data
 * @param {string} productCodeHint
 * @param {string[]} warnings
 * @param {string[]} errors
 */
function mapVariationGroupRelistResponse(data, productCodeHint, warnings, errors) {
  const action = "variation_group_relist";
  const runId = data.runId ?? data.run_id ?? null;
  const listingId = data.listingId ?? data.listing_id ?? null;
  const groupKey = data.groupKey ?? data.group_key ?? data.ebay_item_group_key ?? null;
  const offerIds = Array.isArray(data.offerIds) ? data.offerIds : [];
  const warnList = Array.isArray(data.warnings) ? data.warnings : [];
  const detailParts = [
    groupKey ? `group ${groupKey}` : null,
    listingId ? `listing ${listingId}` : null,
    offerIds.length ? `offers ${offerIds.join(", ")}` : null,
    warnList.find((w) => /qty-0|sibling/i.test(String(w))) || null,
    data.message && !Object.values({
      s: EBAY_VARIATION_GROUP_RELIST_SUCCESS_COPY,
      d: EBAY_VARIATION_GROUP_RELIST_DRY_RUN_COPY,
      m: EBAY_VARIATION_GROUP_RELIST_MANUAL_COPY,
      f: EBAY_VARIATION_GROUP_RELIST_FAILED_COPY,
    }).includes(data.message)
      ? data.message
      : null,
  ].filter(Boolean);
  const detail = detailParts.join(" · ") || null;
  const relistUrl = productCodeHint ? kkEbayListingsAdminUrl(productCodeHint) : EBAY_LISTINGS_PAGE;
  const base = { action, runId, listingId, offerId: offerIds[0] || null, groupKey, detail };

  switch (data.status) {
    case "success":
      return { ...base, status: "success", message: EBAY_VARIATION_GROUP_RELIST_SUCCESS_COPY, nextStepUrl: null };
    case "dry_run": {
      const msg = data.message || EBAY_VARIATION_GROUP_RELIST_DRY_RUN_COPY;
      if (msg !== EBAY_VARIATION_GROUP_RELIST_DRY_RUN_COPY) warnings.push(msg);
      for (const w of warnList) warnings.push(w);
      return { ...base, status: "dry_run", message: EBAY_VARIATION_GROUP_RELIST_DRY_RUN_COPY, nextStepUrl: relistUrl };
    }
    case "manual": {
      const msg = data.message || EBAY_VARIATION_GROUP_RELIST_MANUAL_COPY;
      if (msg !== EBAY_VARIATION_GROUP_RELIST_MANUAL_COPY) warnings.push(msg);
      return { ...base, status: "manual", message: EBAY_VARIATION_GROUP_RELIST_MANUAL_COPY, nextStepUrl: relistUrl };
    }
    case "skipped":
      return {
        ...base,
        status: "skipped",
        message: data.message || EBAY_VARIATION_GROUP_RELIST_SKIPPED_COPY,
        nextStepUrl: null,
      };
    case "failed":
    default: {
      const msg = data.message || EBAY_VARIATION_GROUP_RELIST_FAILED_COPY;
      warnings.push(msg);
      errors.push(`eBay: ${msg}`);
      return { ...base, status: "failed", message: EBAY_VARIATION_GROUP_RELIST_FAILED_COPY, nextStepUrl: relistUrl };
    }
  }
}

/**
 * @param {Object} args
 * @param {string} args.productId
 * @param {string} args.variantId
 * @param {number} args.availableQty
 * @param {import('../api/ebayVariationCandidateApi.js').EbayVariationChildCandidateRow|null} args.variationCandidate
 * @param {string} args.productCodeHint
 * @param {string[]} args.warnings
 * @param {string[]} args.errors
 * @param {Record<string, string>|null} args.syncContext
 */
export async function runEbayVariationQtySync({
  productId,
  variantId,
  availableQty,
  variationCandidate,
  productCodeHint,
  warnings,
  errors,
  syncContext,
}) {
  const action = "variation_update_qty";
  if (availableQty <= 0) {
    return {
      status: "skipped",
      action,
      message: EBAY_VARIATION_QTY_SKIPPED_COPY,
      nextStepUrl: null,
      runId: null,
    };
  }
  if (!variationCandidate || variationCandidate.candidate_state !== "variation_update_qty") {
    return null;
  }
  if (!variationCandidate.child_offer_id) {
    const manual = resolveEbayVariationManualStep("variation_child_offer_missing", productCodeHint, "child");
    return manual ? { ...manual, runId: null } : null;
  }

  try {
    const data = await syncEbayVariationChildQuantity({
      productId,
      variantId,
      quantity: availableQty,
      preview: false,
      syncContext,
    });
    return mapVariationQtyResponse(data, productCodeHint, warnings, errors);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`eBay: ${message}`);
    return {
      status: "failed",
      action,
      message: EBAY_VARIATION_QTY_FAILED_COPY,
      nextStepUrl: productCodeHint ? kkEbayListingsAdminUrl(productCodeHint) : EBAY_LISTINGS_PAGE,
      runId: null,
    };
  }
}

/**
 * @param {Object} args
 * @param {string} args.productId
 * @param {string} args.variantId
 * @param {number} args.availableQty
 * @param {import('../api/ebayVariationRelistCandidateApi.js').EbayVariationGroupRelistCandidateRow|null} args.variationRelistCandidate
 * @param {string} args.productCodeHint
 * @param {string[]} args.warnings
 * @param {string[]} args.errors
 * @param {Record<string, string>|null} args.syncContext
 */
export async function runEbayVariationGroupRelist({
  productId,
  variantId,
  availableQty,
  variationRelistCandidate,
  productCodeHint,
  warnings,
  errors,
  syncContext,
}) {
  const action = "variation_group_relist";
  if (availableQty <= 0) {
    return {
      status: "skipped",
      action,
      message: EBAY_VARIATION_GROUP_RELIST_SKIPPED_COPY,
      nextStepUrl: null,
      runId: null,
    };
  }
  if (!isGroupRelistRunnable(variationRelistCandidate)) return null;

  try {
    const data = await relistEbayVariationGroup({
      productId,
      triggeringVariantId: variantId,
      preview: false,
      syncContext,
    });
    return mapVariationGroupRelistResponse(data, productCodeHint, warnings, errors);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`eBay: ${message}`);
    return {
      status: "failed",
      action,
      message: EBAY_VARIATION_GROUP_RELIST_FAILED_COPY,
      nextStepUrl: productCodeHint ? kkEbayListingsAdminUrl(productCodeHint) : EBAY_LISTINGS_PAGE,
      runId: null,
    };
  }
}

/**
 * @param {Object} args
 * @param {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} args.candidate
 * @param {import('../api/channelSyncCandidateApi.js').EbayRelistCandidateRow|null} args.relist
 * @param {string} args.variantId
 * @param {string} args.productCodeHint
 * @param {number} args.availableQty
 * @param {string[]} args.warnings
 * @param {string[]} args.errors
 * @param {Record<string, string>|null} args.syncContext
 * @returns {Promise<ChannelStepResult|null>}
 */
export async function resolveEbayVariationBranch({
  candidate,
  relist,
  variantId,
  productCodeHint,
  availableQty,
  warnings,
  errors,
  syncContext,
}) {
  if (availableQty <= 0) return null;

  const productId = String(candidate?.product_id || "").trim();
  if (!productId) return null;

  let variationChild = null;
  let variationRelist = null;

  if (shouldFetchVariationChildCandidate(candidate, relist)) {
    variationChild = await fetchEbayVariationChildCandidate({ productId, variantId });
  }
  if (shouldFetchVariationRelistCandidate(candidate, relist)) {
    variationRelist = await fetchEbayVariationRelistCandidate({ productId });
  }

  if (variationRelist && isGroupRelistRunnable(variationRelist)) {
    const groupResult = await runEbayVariationGroupRelist({
      productId,
      variantId,
      availableQty,
      variationRelistCandidate: variationRelist,
      productCodeHint,
      warnings,
      errors,
      syncContext,
    });
    if (groupResult) return groupResult;
  }

  if (variationChild?.candidate_state === "variation_update_qty") {
    const qtyResult = await runEbayVariationQtySync({
      productId,
      variantId,
      availableQty,
      variationCandidate: variationChild,
      productCodeHint,
      warnings,
      errors,
      syncContext,
    });
    if (qtyResult) return qtyResult;
  }

  if (variationChild?.candidate_state === "variation_qty_cache_missing") {
    const manual = resolveEbayVariationManualStep("variation_qty_cache_missing", productCodeHint, "child");
    return manual ? { ...manual, runId: null } : null;
  }

  if (variationChild && CHILD_MANUAL_STATES.has(variationChild.candidate_state)) {
    const manual = resolveEbayVariationManualStep(variationChild.candidate_state, productCodeHint, "child");
    return manual ? { ...manual, runId: null, detail: variationChild.candidate_reason || null } : null;
  }

  if (variationRelist && GROUP_MANUAL_STATES.has(variationRelist.candidate_state)) {
    const manual = resolveEbayVariationManualStep(variationRelist.candidate_state, productCodeHint, "group");
    return manual
      ? { ...manual, runId: null, detail: variationRelist.candidate_reason || null, groupKey: variationRelist.ebay_item_group_key }
      : null;
  }

  return null;
}
