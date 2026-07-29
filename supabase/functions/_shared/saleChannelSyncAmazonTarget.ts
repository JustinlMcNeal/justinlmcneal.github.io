/** Phase 061B.2 — Amazon target for sale-triggered channel sync. */

import {
  candidatesToPatchItems,
  createInventorySyncRun,
  finalizeInventorySyncRun,
  loadAmazonSyncCandidates,
  logInventorySyncResult,
  processPerListingQuantityPatches,
  type InventorySyncRunContext,
} from "./inventoryAmazonSyncUtils.ts";
import { readSyncEnvConfig } from "./amazonSyncAccountUtils.ts";
import type { SaleChannelTargetResult } from "./saleChannelSyncTypes.ts";

export type SaleAmazonTargetInput = {
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

export async function runSaleAmazonTarget(
  input: SaleAmazonTargetInput,
): Promise<SaleChannelTargetResult> {
  const path = "amazon_update_qty";
  const warnings: string[] = [];

  if (!input.liveEnabled) {
    return {
      channel: "amazon",
      path,
      status: "dry_run",
      message: "Amazon live patch disabled (AMAZON_ENABLE_LIVE_PATCH) — dry_run only.",
      warnings: ["sale_sync_gate_off"],
    };
  }

  const effectivePreview = input.preview || !input.liveEnabled;

  const { data: row } = await input.supabase
    .from("v_inventory_channel_sync_candidates")
    .select("variant_id, product_id, amazon_is_afn, amazon_sync_action")
    .eq("variant_id", input.variantId)
    .maybeSingle();

  if (row?.amazon_is_afn) {
    return {
      channel: "amazon",
      path,
      status: "skipped",
      message: "Amazon AFN/FBA — skip sale sync push.",
    };
  }

  if (row && row.amazon_sync_action && row.amazon_sync_action !== "update_qty") {
    return {
      channel: "amazon",
      path,
      status: "manual",
      message: `Amazon sync action ${row.amazon_sync_action} — manual review required.`,
      warnings: ["sale_sync_mapping_manual"],
    };
  }

  const candidates = await loadAmazonSyncCandidates(input.supabase, {
    variantIds: [input.variantId],
    limit: 1,
  });

  if (!candidates.length) {
    return {
      channel: "amazon",
      path,
      status: "manual",
      message: "No Amazon FBM update_qty candidate for variant.",
      warnings: ["sale_sync_mapping_manual"],
    };
  }

  const targetQty = Math.max(0, Math.trunc(input.availableQty));
  const patchItems = candidatesToPatchItems(candidates).map((item) => ({
    ...item,
    quantity: targetQty,
  }));

  const now = new Date().toISOString();
  const run = await createInventorySyncRun(input.supabase, {
    channel: "amazon",
    mode: effectivePreview ? "dry_run" : "push",
    candidateCount: patchItems.length,
    notes: "Sale-triggered Amazon FBM qty push (061B)",
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
      channel: "amazon",
      path,
      status: "dry_run",
      message: `Amazon qty push preview — target ${targetQty}.`,
      runId: run?.id ?? undefined,
      warnings: input.liveEnabled ? undefined : ["sale_sync_gate_off"],
    };
  }

  const syncEnv = readSyncEnvConfig();
  const { results, summary } = await processPerListingQuantityPatches({
    client: input.supabase,
    items: patchItems,
    preview: false,
    syncEnv,
    now,
  });

  if (run?.id) {
    for (const r of results) {
      const cand = candidates.find((c) => String(c.amazon_listing_id) === String(r.amazonListingId));
      await logInventorySyncResult(input.supabase, {
        runId: run.id,
        variantId: cand?.variant_id ?? input.variantId,
        productId: cand?.product_id ?? input.productId,
        amazonListingId: r.amazonListingId,
        sellerSku: cand?.amazon_seller_sku ?? null,
        previousQty: cand?.amazon_current_qty ?? null,
        targetQty,
        status: r.status === "success" ? "success" : r.status === "skipped" ? "skipped" : "failed",
        action: "update_qty",
        errorMessage: r.error ?? null,
        responseRef: r.responseRef ?? null,
      });
    }
    await finalizeInventorySyncRun(input.supabase, run.id, summary, now);
  }

  if (summary.succeeded > 0) {
    return {
      channel: "amazon",
      path,
      status: "success",
      message: `Amazon qty pushed to ${targetQty}.`,
      runId: run?.id ?? undefined,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  return {
    channel: "amazon",
    path,
    status: "failed",
    message: "Amazon sale sync push failed.",
    runId: run?.id ?? undefined,
    errors: results.map((r) => r.error).filter(Boolean) as string[],
    warnings: ["sale_sync_push_failed"],
  };
}
