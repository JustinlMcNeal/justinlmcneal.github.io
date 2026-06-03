// Ready to Push — bulk variant queue (Phase 7A.3).

import { isParentShellRow, isVariantReadyRow } from "./readyToPushNormalize.js";

/** @typedef {Record<string, unknown>} ReadyRow */

/** @type {ReadyRow[]} */
let activeQueue = [];

/** @param {ReadyRow} row */
export function isPushQueueEligible(row) {
  if (!isVariantReadyRow(row)) return false;
  if (row?.has_active_draft) return false;
  if (String(row?.eligibility_status || "") === "blocked") return false;
  return true;
}

/** @param {ReadyRow[]} rows */
export function startPushQueue(rows) {
  activeQueue = (rows || []).filter(isPushQueueEligible);
  return activeQueue.slice();
}

export function clearPushQueue() {
  activeQueue = [];
}

export function getPushQueueLength() {
  return activeQueue.length;
}

export function peekPushQueue() {
  return activeQueue[0] || null;
}

export function advancePushQueue() {
  activeQueue.shift();
  return activeQueue[0] || null;
}

/** @param {ReadyRow[]} productRows */
export function buildProductGroupSummary(productRows) {
  const variantRows = productRows.filter(isVariantReadyRow);
  const first = variantRows[0] || productRows[0] || {};
  const total = Number(first.variants_total || variantRows.length || 0);
  const mapped = Number(first.variants_mapped || 0);
  const remaining = variantRows.filter(isPushQueueEligible).length;
  const parentShell = productRows.find(isParentShellRow);
  const parentReady = Boolean(
    parentShell?.parent_listing_ready
    || variantRows.some((row) => row.parent_listing_ready),
  );
  const multiVariant = Number(first.variants_total || variantRows.length || 0) > 1;
  const parentNeedsAttention = Boolean(multiVariant && !parentReady);
  return {
    total: total > 0 ? total : variantRows.length,
    mapped,
    remaining,
    onAmazon: mapped,
    parentNeedsAttention,
  };
}

/** @param {ReadyRow} row */
export function readyRowAsTrigger(row) {
  const el = document.createElement("button");
  el.type = "button";
  el.dataset.kkProductId = String(row.kk_product_id || "");
  el.dataset.kkVariantId = row.kk_variant_id ? String(row.kk_variant_id) : "";
  el.dataset.suggestedSellerSku = String(row.suggested_seller_sku || row.kk_sku || "");
  el.dataset.sku = String(row.kk_sku || "");
  el.dataset.kkStock = String(row.kk_stock ?? "");
  el.dataset.readyRowKind = String(row.ready_row_kind || "variant");
  if (isParentShellRow(row)) el.dataset.variationRole = "parent";
  const imageUrl = row.image_url ? String(row.image_url) : "";
  if (imageUrl.startsWith("http")) el.dataset.imageUrl = imageUrl;
  el.dataset.eligibilityStatus = String(row.eligibility_status || "ready");
  if (row.draft_id) el.dataset.draftId = String(row.draft_id);
  return el;
}

/** @param {Record<string, unknown>} row */
export function listingRowAsPushTrigger(row, options = {}) {
  const el = document.createElement("button");
  el.type = "button";
  el.dataset.kkProductId = String(row.kk_product_id || "");
  el.dataset.kkVariantId = row.kk_variant_id ? String(row.kk_variant_id) : "";
  el.dataset.sku = String(row.kk_sku || "");
  el.dataset.suggestedSellerSku = String(row.seller_sku || row.kk_sku || "");
  if (options.linkToFamily) el.dataset.linkVariationFamily = "true";
  return el;
}

/** @param {ReadyRow[]} rows */
export function groupReadyRowsByProduct(rows) {
  /** @type {Map<string, ReadyRow[]>} */
  const groups = new Map();
  for (const row of rows || []) {
    const productId = String(row.kk_product_id || "");
    if (!productId) continue;
    if (!groups.has(productId)) groups.set(productId, []);
    groups.get(productId).push(row);
  }
  return [...groups.values()].map((group) => {
    const parentShell = group.find(isParentShellRow);
    const variants = group.filter(isVariantReadyRow);
    return parentShell ? [parentShell, ...variants] : variants;
  });
}
