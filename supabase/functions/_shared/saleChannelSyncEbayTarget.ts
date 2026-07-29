/** Phase 061B.2 — eBay target for sale-triggered channel sync (variation child or single-SKU). */

import { getAccessToken } from "./ebayUtils.ts";
import {
  candidatesToEbayPatchItems,
  loadEbaySyncCandidates,
  processEbayQuantityPatches,
  createInventorySyncRun,
  finalizeInventorySyncRun,
  logInventorySyncResult,
  EBAY_MARKETPLACE_ID,
} from "./inventoryEbaySyncUtils.ts";
import { syncEbayVariationChildQuantity } from "./inventoryEbayVariationSyncUtils.ts";
import type { InventorySyncRunContext } from "./inventoryAmazonSyncUtils.ts";
import type { SaleChannelTargetResult } from "./saleChannelSyncTypes.ts";

export type SaleEbayTargetInput = {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  variantId: string;
  productId: string;
  availableQty: number;
  preview: boolean;
  liveEnabled: boolean;
  syncContext: InventorySyncRunContext;
  orchestrationId: string;
};

function isVariationListing(row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  const groupKey = row.ebay_item_group_key;
  const count = Number(row.product_active_variant_count ?? 0);
  return Boolean(groupKey && count > 1);
}

async function runVariationChildPath(
  input: SaleEbayTargetInput,
): Promise<SaleChannelTargetResult> {
  const path = "ebay_variation_child_update_qty";
  const targetQty = Math.max(0, Math.trunc(input.availableQty));
  const effectivePreview = input.preview || !input.liveEnabled;

  if (!input.liveEnabled && !input.preview) {
    return {
      channel: "ebay",
      path,
      status: "dry_run",
      message: "eBay live qty patch disabled — dry_run only.",
      warnings: ["sale_sync_gate_off"],
    };
  }

  const result = await syncEbayVariationChildQuantity({
    supabase: input.supabase,
    request: {
      productId: input.productId,
      variantId: input.variantId,
      quantity: targetQty,
      preview: effectivePreview,
      syncContext: input.syncContext,
      requestedBy: null,
    },
    liveEnabled: input.liveEnabled && !input.preview,
  });

  if (result.status === "success") {
    return {
      channel: "ebay",
      path,
      status: "success",
      message: result.message,
      runId: result.runId ?? undefined,
    };
  }
  if (result.status === "dry_run") {
    return {
      channel: "ebay",
      path,
      status: "dry_run",
      message: result.message,
      runId: result.runId ?? undefined,
      warnings: input.liveEnabled ? undefined : ["sale_sync_gate_off"],
    };
  }
  if (result.status === "skipped") {
    return {
      channel: "ebay",
      path,
      status: "skipped",
      message: result.message,
      runId: result.runId ?? undefined,
    };
  }
  if (result.status === "manual") {
    return {
      channel: "ebay",
      path,
      status: "manual",
      message: result.message,
      runId: result.runId ?? undefined,
      warnings: ["sale_sync_mapping_manual"],
    };
  }
  return {
    channel: "ebay",
    path,
    status: "failed",
    message: result.message,
    runId: result.runId ?? undefined,
    errors: result.error ? [result.error] : undefined,
    warnings: ["sale_sync_push_failed"],
  };
}

async function runSingleSkuPath(
  input: SaleEbayTargetInput,
): Promise<SaleChannelTargetResult> {
  const path = "ebay_update_qty";
  const targetQty = Math.max(0, Math.trunc(input.availableQty));
  const effectivePreview = input.preview || !input.liveEnabled;

  if (!input.liveEnabled) {
    return {
      channel: "ebay",
      path,
      status: "dry_run",
      message: "eBay live qty patch disabled (EBAY_ENABLE_LIVE_QUANTITY_PATCH) — dry_run only.",
      warnings: ["sale_sync_gate_off"],
    };
  }

  const candidates = await loadEbaySyncCandidates(input.supabase, {
    variantIds: [input.variantId],
    limit: 1,
  });

  if (!candidates.length) {
    return {
      channel: "ebay",
      path,
      status: "manual",
      message: "No eBay single-SKU update_qty candidate (ended listings require manual relist).",
      warnings: ["sale_sync_mapping_manual"],
    };
  }

  const patchItems = candidatesToEbayPatchItems(candidates).map((item) => ({
    ...item,
    targetQty,
  }));

  const now = new Date().toISOString();
  const run = await createInventorySyncRun(input.supabase, {
    channel: "ebay",
    mode: effectivePreview ? "dry_run" : "push",
    candidateCount: patchItems.length,
    notes: "Sale-triggered eBay single-SKU qty push (061B)",
    triggerSource: input.syncContext.triggerSource ?? "sale",
    triggerReferenceType: input.syncContext.triggerReferenceType ?? "order_line",
    triggerReferenceId: input.syncContext.triggerReferenceId ?? null,
    stockLedgerId: input.syncContext.stockLedgerId ?? null,
    orchestrationId: input.orchestrationId,
  });

  if (effectivePreview) {
    if (run?.id) {
      await finalizeInventorySyncRun(input.supabase, run.id, {
        succeeded: patchItems.length,
        failed: 0,
        skipped: 0,
      }, now);
    }
    return {
      channel: "ebay",
      path,
      status: "dry_run",
      message: `eBay qty push preview — target ${targetQty}.`,
      runId: run?.id ?? undefined,
      warnings: ["sale_sync_gate_off"],
    };
  }

  const accessToken = await getAccessToken(input.supabase);
  const { results, summary } = await processEbayQuantityPatches({
    client: input.supabase,
    accessToken,
    items: patchItems,
    preview: false,
    now,
  });

  if (run?.id) {
    for (const r of results) {
      await logInventorySyncResult(input.supabase, {
        runId: run.id,
        variantId: r.variantId,
        productId: r.productId,
        sellerSku: r.ebaySku,
        marketplaceId: EBAY_MARKETPLACE_ID,
        ebayOfferId: r.offerId,
        ebayListingId: r.listingId,
        previousQty: r.previousQty,
        targetQty: r.targetQty,
        status: r.status,
        action: "update_qty",
        errorCode: r.errorCode ?? null,
        errorMessage: r.error ?? null,
        responseRef: r.responseRef ?? null,
      });
    }
    await finalizeInventorySyncRun(input.supabase, run.id, summary, now);
  }

  if (summary.succeeded > 0) {
    return {
      channel: "ebay",
      path,
      status: "success",
      message: `eBay qty pushed to ${targetQty}.`,
      runId: run?.id ?? undefined,
    };
  }

  return {
    channel: "ebay",
    path,
    status: "failed",
    message: "eBay sale sync push failed.",
    runId: run?.id ?? undefined,
    errors: results.map((r) => r.error).filter(Boolean) as string[],
    warnings: ["sale_sync_push_failed"],
  };
}

export async function runSaleEbayTarget(
  input: SaleEbayTargetInput,
): Promise<SaleChannelTargetResult> {
  const { data: row } = await input.supabase
    .from("v_inventory_channel_sync_candidates")
    .select("ebay_item_group_key, product_active_variant_count, ebay_sync_action")
    .eq("variant_id", input.variantId)
    .maybeSingle();

  if (row?.ebay_sync_action === "ended_needs_relist") {
    return {
      channel: "ebay",
      path: "ebay_ended_skip",
      status: "manual",
      message: "eBay listing ended — relist not run from sale sync (Adjust/manual).",
      warnings: ["sale_sync_mapping_manual"],
    };
  }

  if (isVariationListing(row as Record<string, unknown>)) {
    return runVariationChildPath(input);
  }

  return runSingleSkuPath(input);
}
