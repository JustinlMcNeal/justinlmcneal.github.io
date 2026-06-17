/**
 * Next-step labels and URLs for adjust channel orchestrator (Phase 059A.3; 060C.3 variation).
 */

import {
  AMAZON_LISTINGS_PAGE,
  EBAY_LISTINGS_PAGE,
} from "../constants/channelLinks.js";
import { kkEbayListingsAdminUrl } from "../api/ebayRelistAssistApi.js";
import {
  EBAY_VARIATION_GROUP_RELIST_MANUAL_COPY,
  EBAY_VARIATION_QTY_MANUAL_COPY,
} from "./adjustOrchestratorSummary.js";

export const INVENTORY_SYNC_CHANNELS_HINT = "/pages/admin/inventory.html";

/** @typedef {'skipped'|'success'|'failed'|'next_step'|'manual'|'dry_run'} ChannelStepStatus */

/**
 * @typedef {Object} ChannelStepResult
 * @property {ChannelStepStatus} status
 * @property {string|null} action
 * @property {string} message
 * @property {string|null} [nextStepUrl]
 */

/** @param {string|null|undefined} action @param {string} [productCode] */
export function resolveAmazonChannelStep(action, productCode = "") {
  switch (action) {
    case "update_qty":
      return null;
    case "inactive_can_update":
      return null;
    case "afn_skip":
      return {
        status: "skipped",
        action,
        message: "Amazon FBA/AFN — skipped.",
        nextStepUrl: null,
      };
    case "missing_mapping":
      return {
        status: "skipped",
        action,
        message: "No Amazon mapping for this variant.",
        nextStepUrl: AMAZON_LISTINGS_PAGE,
      };
    case "no_change":
      return {
        status: "skipped",
        action,
        message: "Amazon quantity already matches available stock.",
        nextStepUrl: null,
      };
    default:
      return {
        status: "skipped",
        action: action || null,
        message: "Amazon status unavailable — no sync run.",
        nextStepUrl: INVENTORY_SYNC_CHANNELS_HINT,
      };
  }
}

/** @param {string|null|undefined} action @param {string} [productCode] */
export function resolveEbayChannelStep(action, productCode = "") {
  switch (action) {
    case "update_qty":
      return null;
    case "ended_needs_relist":
      return null;
    case "qty_cache_missing":
      return null;
    case "unsupported_variation":
      return {
        status: "next_step",
        action,
        message: "eBay variation listing requires manual review.",
        nextStepUrl: productCode ? kkEbayListingsAdminUrl(productCode) : EBAY_LISTINGS_PAGE,
      };
    case "missing_mapping":
      return {
        status: "skipped",
        action,
        message: "No eBay mapping for this variant.",
        nextStepUrl: EBAY_LISTINGS_PAGE,
      };
    case "no_change":
      return {
        status: "skipped",
        action,
        message: "eBay quantity already matches available stock.",
        nextStepUrl: null,
      };
    case "no_active_listing":
      return {
        status: "skipped",
        action,
        message: "No active eBay listing.",
        nextStepUrl: EBAY_LISTINGS_PAGE,
      };
    default:
      return {
        status: "skipped",
        action: action || null,
        message: "eBay status unavailable — no sync run.",
        nextStepUrl: INVENTORY_SYNC_CHANNELS_HINT,
      };
  }
}

/**
 * Manual next-step for variation orchestration paths (060C.3).
 * @param {string} state
 * @param {string} [productCode]
 * @param {"child"|"group"} [kind]
 */
export function resolveEbayVariationManualStep(state, productCode = "", kind = "child") {
  const listingsUrl = productCode ? kkEbayListingsAdminUrl(productCode) : EBAY_LISTINGS_PAGE;
  const isGroup = kind === "group";

  if (state === "variation_qty_cache_missing") {
    return {
      status: "next_step",
      action: "variation_qty_cache_missing",
      message: "eBay variation cache must refresh before quantity sync. Use Sync Channels or eBay Listings.",
      nextStepUrl: INVENTORY_SYNC_CHANNELS_HINT,
    };
  }

  if (isGroup) {
    return {
      status: "manual",
      action: "variation_group_relist",
      message: EBAY_VARIATION_GROUP_RELIST_MANUAL_COPY,
      nextStepUrl: listingsUrl,
    };
  }

  return {
    status: "manual",
    action: "variation_update_qty",
    message: EBAY_VARIATION_QTY_MANUAL_COPY,
    nextStepUrl: listingsUrl,
  };
}
