/**
 * eBay variation child quantity sync (Phase 060A.3).
 * One child SKU/offer only — no group rebuild, no siblings, no stock writes.
 */

import { getAccessToken, createServiceClient } from "./ebayUtils.ts";
import {
  createInventorySyncRun,
  finalizeInventorySyncRun,
  logInventorySyncResult,
  type InventorySyncRunContext,
} from "./inventoryAmazonSyncUtils.ts";
import {
  processEbayQuantityPatches,
  type EbayQuantityPatchItem,
  EBAY_MARKETPLACE_ID,
} from "./inventoryEbaySyncUtils.ts";
import {
  loadEbayVariationChildCandidate,
  validateVariationChildCandidateForQty,
  type EbayVariationChildCandidate,
} from "./ebayVariationChildCandidateLoaders.ts";

export type { InventorySyncRunContext };

export const EBAY_VARIATION_QTY_DRY_RUN_COPY =
  "eBay variation quantity sync was previewed only. Live eBay quantity patching is disabled.";

export type EbayVariationQtySyncRequest = {
  productId: string;
  variantId: string;
  quantity: number;
  preview?: boolean;
  syncContext?: InventorySyncRunContext | null;
  requestedBy?: string | null;
};

export type EbayVariationQtySyncResult = {
  status: "success" | "dry_run" | "skipped" | "manual" | "failed";
  message: string;
  productId: string;
  variantId: string;
  childSku: string | null;
  childOfferId: string | null;
  parentListingId: string | null;
  requestedQty: number;
  previousQty: number | null;
  qtyDelta: number | null;
  candidateState: string | null;
  runId: string | null;
  errorCode?: string | null;
  error?: string | null;
  responseRef?: string | null;
};

const MANUAL_STATES = new Set([
  "variation_mapping_missing",
  "variation_mapping_ambiguous",
  "variation_child_offer_missing",
  "variation_parent_inactive",
  "variation_manual",
  "variation_qty_cache_missing",
]);

function positiveInt(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

function resolveChildSku(candidate: EbayVariationChildCandidate): string | null {
  return candidate.cache_ebay_sku || candidate.expected_ebay_sku || null;
}

function buildPatchItem(
  candidate: EbayVariationChildCandidate,
  targetQty: number,
): EbayQuantityPatchItem | null {
  const ebaySku = resolveChildSku(candidate);
  const offerId = candidate.child_offer_id;
  if (!ebaySku || !offerId) return null;
  return {
    variantId: candidate.variant_id,
    productId: candidate.product_id,
    ebaySku,
    offerId,
    listingId: candidate.parent_ebay_listing_id,
    targetQty,
    previousQty: candidate.ebay_child_qty,
  };
}

function manualResult(
  base: Partial<EbayVariationQtySyncResult>,
  state: string,
  reason: string,
  message: string,
): EbayVariationQtySyncResult {
  return {
    status: "manual",
    message,
    productId: base.productId ?? "",
    variantId: base.variantId ?? "",
    childSku: base.childSku ?? null,
    childOfferId: base.childOfferId ?? null,
    parentListingId: base.parentListingId ?? null,
    requestedQty: base.requestedQty ?? 0,
    previousQty: base.previousQty ?? null,
    qtyDelta: base.qtyDelta ?? null,
    candidateState: state,
    runId: base.runId ?? null,
    errorCode: reason,
  };
}

async function logVariationResult(
  // deno-lint-ignore no-explicit-any
  client: any,
  runId: string | null,
  item: EbayQuantityPatchItem,
  result: EbayVariationQtySyncResult,
): Promise<void> {
  if (!runId) return;
  const dbStatus = result.status === "success" || result.status === "dry_run"
    ? "success"
    : result.status === "skipped" || result.status === "manual"
    ? "skipped"
    : "failed";
  await logInventorySyncResult(client, {
    runId,
    variantId: item.variantId,
    productId: item.productId,
    sellerSku: item.ebaySku,
    marketplaceId: EBAY_MARKETPLACE_ID,
    ebayOfferId: item.offerId,
    ebayListingId: item.listingId,
    previousQty: item.previousQty,
    targetQty: item.targetQty,
    status: dbStatus,
    action: "variation_child_update_qty",
    errorCode: result.errorCode ?? null,
    errorMessage: result.status === "failed" || result.status === "manual" ? result.message : null,
    responseRef: result.responseRef ?? null,
  });
}

export async function syncEbayVariationChildQuantity({
  supabase,
  request,
  liveEnabled,
}: {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  request: EbayVariationQtySyncRequest;
  liveEnabled: boolean;
}): Promise<EbayVariationQtySyncResult> {
  const productId = String(request.productId || "").trim();
  const variantId = String(request.variantId || "").trim();
  const requestedQty = positiveInt(request.quantity);
  const preview = request.preview === true || !liveEnabled;
  const syncCtx = request.syncContext ?? {};

  const base: Partial<EbayVariationQtySyncResult> = {
    productId,
    variantId,
    requestedQty: requestedQty ?? 0,
    runId: null,
  };

  if (!productId || !variantId) {
    return manualResult(base, "variation_manual", "missing_ids", "productId and variantId are required.");
  }
  if (!requestedQty) {
    return {
      status: "skipped",
      message: "Quantity must be greater than zero.",
      productId,
      variantId,
      childSku: null,
      childOfferId: null,
      parentListingId: null,
      requestedQty: 0,
      previousQty: null,
      qtyDelta: null,
      candidateState: null,
      runId: null,
      errorCode: "quantity_required",
    };
  }

  let candidate: EbayVariationChildCandidate | null;
  try {
    candidate = await loadEbayVariationChildCandidate({ supabase, productId, variantId });
  } catch {
    return {
      status: "failed",
      message: "Failed to load variation candidate.",
      productId,
      variantId,
      childSku: null,
      childOfferId: null,
      parentListingId: null,
      requestedQty,
      previousQty: null,
      qtyDelta: null,
      candidateState: null,
      runId: null,
      errorCode: "database_error",
    };
  }

  if (!candidate) {
    return manualResult(
      { ...base, requestedQty },
      "variation_manual",
      "no_candidate_row",
      "No variation sync candidate row for this variant.",
    );
  }

  base.childSku = resolveChildSku(candidate);
  base.childOfferId = candidate.child_offer_id;
  base.parentListingId = candidate.parent_ebay_listing_id;
  base.previousQty = candidate.ebay_child_qty;
  base.qtyDelta = candidate.ebay_child_qty != null ? requestedQty - candidate.ebay_child_qty : null;
  base.candidateState = candidate.candidate_state;

  if (candidate.candidate_state !== "variation_update_qty") {
    if (candidate.candidate_state === "variation_no_change") {
      return {
        status: "skipped",
        message: "eBay child quantity already matches requested quantity.",
        productId,
        variantId,
        childSku: base.childSku,
        childOfferId: base.childOfferId,
        parentListingId: base.parentListingId,
        requestedQty,
        previousQty: base.previousQty,
        qtyDelta: 0,
        candidateState: candidate.candidate_state,
        runId: null,
        errorCode: "no_change",
      };
    }
    if (MANUAL_STATES.has(candidate.candidate_state)) {
      return manualResult(
        { ...base, requestedQty },
        candidate.candidate_state,
        candidate.candidate_reason || candidate.candidate_state,
        `Variation qty sync requires manual review (${candidate.candidate_state}).`,
      );
    }
    return manualResult(
      { ...base, requestedQty },
      candidate.candidate_state,
      "unsupported_state",
      `Candidate state must be variation_update_qty (got ${candidate.candidate_state}).`,
    );
  }

  const validation = validateVariationChildCandidateForQty(candidate);
  if (!validation.ok) {
    if (validation.state === "variation_no_change") {
      return {
        status: "skipped",
        message: "eBay child quantity already matches KK available quantity.",
        productId,
        variantId,
        childSku: base.childSku,
        childOfferId: base.childOfferId,
        parentListingId: base.parentListingId,
        requestedQty,
        previousQty: base.previousQty,
        qtyDelta: 0,
        candidateState: validation.state,
        runId: null,
      };
    }
    return manualResult(
      { ...base, requestedQty },
      validation.state,
      validation.reason,
      `Variation qty sync not eligible (${validation.reason}).`,
    );
  }

  const patchItem = buildPatchItem(candidate, requestedQty);
  if (!patchItem) {
    return manualResult(
      { ...base, requestedQty },
      "variation_child_offer_missing",
      "missing_patch_fields",
      "Child SKU and offer ID are required for variation qty sync.",
    );
  }

  if (patchItem.previousQty != null && patchItem.previousQty === requestedQty) {
    return {
      status: "skipped",
      message: "eBay child quantity already matches requested quantity.",
      productId,
      variantId,
      childSku: patchItem.ebaySku,
      childOfferId: patchItem.offerId,
      parentListingId: patchItem.listingId,
      requestedQty,
      previousQty: patchItem.previousQty,
      qtyDelta: 0,
      candidateState: candidate.candidate_state,
      runId: null,
    };
  }

  const run = await createInventorySyncRun(supabase, {
    channel: "ebay",
    mode: preview ? "dry_run" : "push",
    requestedBy: request.requestedBy ?? null,
    candidateCount: 1,
    notes: preview
      ? "eBay variation child qty sync preview (variation_child_update_qty)"
      : "eBay variation child qty push (variation_child_update_qty)",
    triggerSource: syncCtx.triggerSource,
    triggerReferenceType: syncCtx.triggerReferenceType,
    triggerReferenceId: syncCtx.triggerReferenceId,
    stockLedgerId: syncCtx.stockLedgerId,
    orchestrationId: syncCtx.orchestrationId,
  });
  base.runId = run?.id ?? null;

  if (preview) {
    const dryRun: EbayVariationQtySyncResult = {
      status: "dry_run",
      message: EBAY_VARIATION_QTY_DRY_RUN_COPY,
      productId,
      variantId,
      childSku: patchItem.ebaySku,
      childOfferId: patchItem.offerId,
      parentListingId: patchItem.listingId,
      requestedQty,
      previousQty: patchItem.previousQty,
      qtyDelta: patchItem.previousQty != null ? requestedQty - patchItem.previousQty : null,
      candidateState: candidate.candidate_state,
      runId: run?.id ?? null,
      responseRef: "preview",
    };
    await logVariationResult(supabase, run?.id ?? null, patchItem, dryRun);
    if (run?.id) {
      await finalizeInventorySyncRun(supabase, run.id, { succeeded: 1, failed: 0, skipped: 0 }, new Date().toISOString());
    }
    return dryRun;
  }

  const ebayClient = createServiceClient();
  let accessToken: string;
  try {
    accessToken = await getAccessToken(ebayClient);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed: EbayVariationQtySyncResult = {
      status: "failed",
      message: msg,
      productId,
      variantId,
      childSku: patchItem.ebaySku,
      childOfferId: patchItem.offerId,
      parentListingId: patchItem.listingId,
      requestedQty,
      previousQty: patchItem.previousQty,
      qtyDelta: patchItem.previousQty != null ? requestedQty - patchItem.previousQty : null,
      candidateState: candidate.candidate_state,
      runId: run?.id ?? null,
      errorCode: "ebay_not_connected",
    };
    await logVariationResult(supabase, run?.id ?? null, patchItem, failed);
    if (run?.id) {
      await finalizeInventorySyncRun(supabase, run.id, { succeeded: 0, failed: 1, skipped: 0 }, new Date().toISOString());
    }
    return failed;
  }

  const now = new Date().toISOString();
  const { results, summary } = await processEbayQuantityPatches({
    client: supabase,
    accessToken,
    items: [patchItem],
    preview: false,
    now,
  });

  const patchResult = results[0];
  if (!patchResult || patchResult.status === "failed") {
    const failed: EbayVariationQtySyncResult = {
      status: "failed",
      message: patchResult?.error || "eBay variation quantity sync failed.",
      productId,
      variantId,
      childSku: patchItem.ebaySku,
      childOfferId: patchItem.offerId,
      parentListingId: patchItem.listingId,
      requestedQty,
      previousQty: patchItem.previousQty,
      qtyDelta: patchItem.previousQty != null ? requestedQty - patchItem.previousQty : null,
      candidateState: candidate.candidate_state,
      runId: run?.id ?? null,
      errorCode: patchResult?.errorCode ?? "ebay_patch_failed",
      error: patchResult?.error,
    };
    await logVariationResult(supabase, run?.id ?? null, patchItem, failed);
    if (run?.id) await finalizeInventorySyncRun(supabase, run.id, summary, now);
    return failed;
  }

  if (patchResult.status === "skipped") {
    const skipped: EbayVariationQtySyncResult = {
      status: "skipped",
      message: patchResult.error || "eBay child quantity already matched.",
      productId,
      variantId,
      childSku: patchItem.ebaySku,
      childOfferId: patchItem.offerId,
      parentListingId: patchItem.listingId,
      requestedQty,
      previousQty: patchItem.previousQty,
      qtyDelta: 0,
      candidateState: candidate.candidate_state,
      runId: run?.id ?? null,
    };
    await logVariationResult(supabase, run?.id ?? null, patchItem, skipped);
    if (run?.id) await finalizeInventorySyncRun(supabase, run.id, summary, now);
    return skipped;
  }

  const success: EbayVariationQtySyncResult = {
    status: "success",
    message: "eBay variation child quantity updated.",
    productId,
    variantId,
    childSku: patchItem.ebaySku,
    childOfferId: patchItem.offerId,
    parentListingId: patchItem.listingId,
    requestedQty,
    previousQty: patchItem.previousQty,
    qtyDelta: patchItem.previousQty != null ? requestedQty - patchItem.previousQty : null,
    candidateState: candidate.candidate_state,
    runId: run?.id ?? null,
    responseRef: patchResult.responseRef ?? null,
  };
  await logVariationResult(supabase, run?.id ?? null, patchItem, success);
  if (run?.id) await finalizeInventorySyncRun(supabase, run.id, summary, now);
  return success;
}
