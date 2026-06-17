/**
 * Adjust modal channel preview status mappers (Phase 059A.2; 059E.3 UX polish; 060C.2 variation).
 */

import {
  computeVariationSyncToggleContribution,
  isSingleSkuEbayActionable,
  mapVariationChildPreviewStatus,
  mapVariationGroupRelistPreviewStatus,
  resolveEbayPreviewPath,
} from "./adjustChannelVariationPreview.js";

/** @typedef {'success'|'warn'|'muted'|'danger'} PreviewTone */

/**
 * @typedef {Object} ChannelPreviewCard
 * @property {string} channel
 * @property {string} label
 * @property {string} description
 * @property {PreviewTone} tone
 */

/**
 * @typedef {Object} AdjustChannelPreviewState
 * @property {ChannelPreviewCard} kk
 * @property {ChannelPreviewCard} amazon
 * @property {ChannelPreviewCard} ebay
 * @property {boolean} syncToggleDefault
 * @property {number} projectedOnHand
 * @property {number} projectedAvailable
 * @property {number} reservedQty
 */

/** @param {string|null|undefined} action @param {{ projectedAvailable?: number }} [opts] */
export function mapAmazonPreviewStatus(action, opts = {}) {
  switch (action) {
    case "update_qty":
      return card("Amazon", "Amazon quantity will update", "Active FBM listing can sync after KK stock is saved.", "success");
    case "inactive_can_update": {
      const avail = Number(opts.projectedAvailable ?? 0);
      if (avail > 0) {
        return card(
          "Amazon",
          "Amazon inactive offer can be restored",
          "Restore runs when marketplace sync is on. Live success depends on Amazon.",
          "warn",
        );
      }
      return card(
        "Amazon",
        "Amazon inactive — restore unavailable",
        "Projected available quantity is not positive after adjust.",
        "muted",
      );
    }
    case "afn_skip":
      return card("Amazon", "Amazon FBA listing skipped", "FBA/AFN listings are not updated from Inventory.", "muted");
    case "missing_mapping":
      return card("Amazon", "No Amazon mapping", "No mapped Amazon listing for this variant.", "muted");
    case "no_change":
      return card("Amazon", "Amazon already matches", "Marketplace qty already matches available stock.", "muted");
    default:
      return card("Amazon", "Amazon status unavailable", "No channel candidate row for this variant.", "muted");
  }
}

/** @param {string|null|undefined} action @param {{ projectedAvailable?: number, relistAction?: string|null, suppressEndedRelist?: boolean }} [opts] */
export function mapEbayPreviewStatus(action, opts = {}) {
  const relistAction = opts.relistAction ?? null;
  const suppressEndedRelist = Boolean(opts.suppressEndedRelist);
  switch (action) {
    case "update_qty":
      return card("eBay", "eBay quantity will update", "Active listing qty can sync after KK stock is saved.", "success");
    case "qty_cache_missing": {
      const avail = Number(opts.projectedAvailable ?? 0);
      if (avail > 0) {
        return card(
          "eBay",
          "eBay cache will refresh before sync",
          "Cache refresh runs before quantity push when marketplace sync is on.",
          "warn",
        );
      }
      return card(
        "eBay",
        "eBay cache missing — refresh unavailable",
        "Projected available quantity is not positive after adjust.",
        "muted",
      );
    }
    case "ended_needs_relist": {
      const avail = Number(opts.projectedAvailable ?? 0);
      if (suppressEndedRelist) {
        return card(
          "eBay",
          "eBay ended — variation group relist pending",
          "Variation group relist path applies when preview resolves group candidate.",
          "muted",
        );
      }
      if (relistAction === "unsupported_variation") {
        return card(
          "eBay",
          "eBay ended — manual relist required",
          "Variation group listing — use Relist Assist or eBay Listings admin.",
          "warn",
        );
      }
      if (avail <= 0) {
        return card(
          "eBay",
          "eBay ended — relist unavailable",
          "Projected available quantity is not positive after adjust.",
          "muted",
        );
      }
      if (relistAction && relistAction !== "ready_to_relist") {
        return card(
          "eBay",
          "eBay ended — relist unavailable",
          `Relist assist: ${String(relistAction).replace(/_/g, " ")}.`,
          "warn",
        );
      }
      return card(
        "eBay",
        "eBay ended listing can be relisted",
        "Will attempt relist when marketplace sync is on. Success depends on eBay.",
        "warn",
      );
    }
    case "unsupported_variation":
      return card(
        "eBay",
        "eBay variation requires manual handling",
        "Multi-variant group listings are not automated. Use Relist Assist or eBay Listings.",
        "warn",
      );
    case "missing_mapping":
      return card("eBay", "No eBay mapping", "No mapped eBay listing for this variant.", "muted");
    case "no_change":
      return card("eBay", "eBay already matches", "Marketplace qty already matches available stock.", "muted");
    case "no_active_listing":
      return card("eBay", "No active eBay listing", "Product is not listed on eBay.", "muted");
    default:
      return card("eBay", "eBay status unavailable", "No channel candidate row for this variant.", "muted");
  }
}

/**
 * @param {number} currentOnHand
 * @param {number} reservedQty
 * @param {number} projectedOnHand
 * @param {boolean} adjustmentValid
 */
export function mapKkPreviewStatus(currentOnHand, reservedQty, projectedOnHand, adjustmentValid) {
  const reserved = Number(reservedQty) || 0;
  const onHand = adjustmentValid ? projectedOnHand : currentOnHand;
  const available = onHand - reserved;

  if (!adjustmentValid) {
    return card(
      "KK",
      `On hand ${currentOnHand} · available ${currentOnHand - reserved}`,
      "Enter a valid adjustment to preview storefront stock.",
      "muted",
    );
  }

  if (available > 0) {
    return card(
      "KK",
      "KK will show in stock after adjust",
      `KK stock will update immediately. Projected on hand ${onHand}, available ${available} (reserved ${reserved}).`,
      "success",
    );
  }

  return card(
    "KK",
    "KK will remain backorder",
    `KK stock will update immediately. Projected on hand ${onHand}, available ${available} (reserved ${reserved}).`,
    "warn",
  );
}

/**
 * @param {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} candidate
 * @param {number} projectedAvailable
 * @param {import('../api/channelSyncCandidateApi.js').EbayRelistCandidateRow|null} [relist]
 */
export function computeSyncToggleDefault(
  candidate,
  projectedAvailable,
  relist = null,
  variationChild = null,
  variationRelist = null,
) {
  if (!candidate || projectedAvailable <= 0) return false;
  const amazonSafe =
    candidate.amazon_sync_action === "update_qty" ||
    candidate.amazon_sync_action === "inactive_can_update";
  const ebaySafe = isSingleSkuEbayActionable(candidate, relist, projectedAvailable);
  const variationSafe = computeVariationSyncToggleContribution(
    variationChild,
    variationRelist,
    projectedAvailable,
  );
  return amazonSafe || ebaySafe || variationSafe;
}

/**
 * @param {Object} opts
 * @param {import('../api/channelSyncCandidateApi.js').ChannelSyncCandidateRow|null} opts.candidate
 * @param {import('../api/channelSyncCandidateApi.js').EbayRelistCandidateRow|null} opts.relist
 * @param {import('../api/ebayVariationCandidateApi.js').EbayVariationChildCandidateRow|null} [opts.variationChild]
 * @param {import('../api/ebayVariationRelistCandidateApi.js').EbayVariationGroupRelistCandidateRow|null} [opts.variationRelist]
 * @param {{ valid: boolean, newStock: number }} opts.adjustment
 * @param {number} opts.fallbackOnHand
 * @param {number} opts.fallbackReserved
 * @returns {AdjustChannelPreviewState}
 */
export function buildAdjustChannelPreviewState({
  candidate,
  relist,
  variationChild = null,
  variationRelist = null,
  adjustment,
  fallbackOnHand,
  fallbackReserved,
}) {
  const currentOnHand = Number(candidate?.on_hand_qty ?? fallbackOnHand ?? 0);
  const reservedQty = Number(candidate?.reserved_qty ?? fallbackReserved ?? 0);
  const projectedOnHand = adjustment.valid ? adjustment.newStock : currentOnHand;
  const projectedAvailable = projectedOnHand - reservedQty;

  const ebayPath = resolveEbayPreviewPath({
    candidate,
    relist,
    variationChild,
    variationRelist,
    projectedAvailable,
  });

  /** @type {ChannelPreviewCard} */
  let ebay;
  switch (ebayPath) {
    case "variation_child":
      ebay = mapVariationChildPreviewStatus(variationChild, { projectedAvailable });
      break;
    case "variation_group_relist":
      ebay = mapVariationGroupRelistPreviewStatus(variationRelist, { projectedAvailable });
      break;
    case "single_sku":
    case "channel_fallback":
    default:
      ebay = mapEbayPreviewStatus(candidate?.ebay_sync_action, {
        relistAction: relist?.relist_action,
        projectedAvailable,
        suppressEndedRelist:
          ebayPath === "channel_fallback" &&
          variationRelist &&
          (variationRelist.candidate_state === "variation_group_ready_to_relist" ||
            variationRelist.candidate_state === "variation_group_relist_dry_run_ready"),
      });
      break;
  }

  return {
    kk: mapKkPreviewStatus(currentOnHand, reservedQty, projectedOnHand, adjustment.valid),
    amazon: mapAmazonPreviewStatus(candidate?.amazon_sync_action, { projectedAvailable }),
    ebay,
    syncToggleDefault: computeSyncToggleDefault(
      candidate,
      projectedAvailable,
      relist,
      variationChild,
      variationRelist,
    ),
    projectedOnHand,
    projectedAvailable,
    reservedQty,
  };
}

/** @param {string} channel @param {string} label @param {string} description @param {PreviewTone} tone */
function card(channel, label, description, tone) {
  return { channel, label, description, tone };
}
