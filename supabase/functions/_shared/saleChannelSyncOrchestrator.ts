/** Phase 061B.2 — Sale-triggered cross-channel qty push orchestrator (no stock writes). */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseInventorySyncRunContext } from "./inventoryAmazonSyncUtils.ts";
import { runSaleAmazonTarget } from "./saleChannelSyncAmazonTarget.ts";
import { runSaleEbayTarget } from "./saleChannelSyncEbayTarget.ts";
import type { SaleSyncQueueJob } from "./saleSyncQueue.ts";
import {
  aggregateSaleSyncStatus,
  buildSalePushIdempotencyKey,
  resolveSaleTargetChannels,
  type SaleChannelSyncInput,
  type SaleChannelSyncOutput,
  type SaleSourceChannel,
  type SaleTargetChannel,
} from "./saleChannelSyncTypes.ts";

export type RunSaleChannelSyncOptions = {
  preview?: boolean;
};

function isSaleSyncEnabled(): boolean {
  return Deno.env.get("SALE_CHANNEL_SYNC_ENABLED") === "true";
}

function amazonLiveEnabled(): boolean {
  return Deno.env.get("AMAZON_ENABLE_LIVE_PATCH") === "true";
}

function ebayLiveEnabled(): boolean {
  return Deno.env.get("EBAY_ENABLE_LIVE_QUANTITY_PATCH") === "true";
}

function buildSyncContext(input: SaleChannelSyncInput) {
  const base = input.syncContext ?? {
    trigger_source: "sale" as const,
    trigger_reference_type: "order_line" as const,
    trigger_reference_id: `${input.externalOrderId}:${input.externalLineId}`,
    stock_reservation_id: input.reservationId,
    orchestration_id: input.idempotencyKey,
  };
  return parseInventorySyncRunContext(base);
}

export function saleSyncInputFromQueueJob(job: SaleSyncQueueJob): SaleChannelSyncInput {
  const ctx = (job.sync_context || {}) as Record<string, unknown>;
  const triggerSource = ctx.trigger_source === "sale_release" ? "sale_release" : "sale";
  return {
    sourceChannel: job.source_channel,
    productId: String(job.product_id || ""),
    variantId: job.variant_id,
    availableQty: job.available_qty,
    externalOrderId: String(job.external_order_id || ""),
    externalLineId: String(job.external_line_id || ""),
    holdActionId: job.hold_action_id ?? undefined,
    reservationId: job.reservation_id ?? undefined,
    idempotencyKey: job.push_idempotency_key,
    syncContext: {
      trigger_source: triggerSource,
      trigger_reference_type: "order_line",
      trigger_reference_id: String(ctx.trigger_reference_id || `${job.external_order_id}:${job.external_line_id}`),
      stock_reservation_id: job.reservation_id ?? undefined,
      orchestration_id: job.push_idempotency_key,
    },
  };
}

export async function runSaleChannelSync(
  supabase: SupabaseClient,
  input: SaleChannelSyncInput,
  options: RunSaleChannelSyncOptions = {},
): Promise<SaleChannelSyncOutput> {
  const issueHints: string[] = [];
  const idempotencyKey = input.idempotencyKey?.trim()
    || buildSalePushIdempotencyKey(input.sourceChannel, input.externalOrderId, input.externalLineId);

  if (!isSaleSyncEnabled()) {
    return {
      status: "skipped",
      sourceChannel: input.sourceChannel,
      variantId: input.variantId,
      availableQty: input.availableQty,
      results: [],
      idempotencyKey,
      issueHints: ["sale_sync_disabled"],
    };
  }

  const qty = Math.trunc(Number(input.availableQty));
  if (!Number.isFinite(qty) || qty < 0) {
    return {
      status: "failed",
      sourceChannel: input.sourceChannel,
      variantId: input.variantId,
      availableQty: input.availableQty,
      results: [],
      idempotencyKey,
      issueHints: ["invalid_qty"],
    };
  }

  const preview = options.preview === true;
  const syncContext = buildSyncContext({ ...input, idempotencyKey });
  const targets = resolveSaleTargetChannels(input.sourceChannel);
  const results = [];

  for (const channel of targets) {
    if (channel === "amazon") {
      results.push(await runSaleAmazonTarget({
        supabase,
        variantId: input.variantId,
        productId: input.productId,
        availableQty: qty,
        preview,
        liveEnabled: amazonLiveEnabled(),
        syncContext,
        orchestrationId: idempotencyKey,
      }));
    } else if (channel === "ebay") {
      results.push(await runSaleEbayTarget({
        supabase,
        variantId: input.variantId,
        productId: input.productId,
        availableQty: qty,
        preview,
        liveEnabled: ebayLiveEnabled(),
        syncContext,
        orchestrationId: idempotencyKey,
      }));
    }
  }

  for (const r of results) {
    for (const w of r.warnings || []) {
      if (!issueHints.includes(w)) issueHints.push(w);
    }
  }

  return {
    status: aggregateSaleSyncStatus(results),
    sourceChannel: input.sourceChannel,
    variantId: input.variantId,
    availableQty: qty,
    results,
    idempotencyKey,
    issueHints: issueHints.length ? issueHints : undefined,
  };
}

export function resolveTargetsForSource(source: SaleSourceChannel): SaleTargetChannel[] {
  return resolveSaleTargetChannels(source);
}
