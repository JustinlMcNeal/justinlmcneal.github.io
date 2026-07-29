// Phase 061C.2 — Enqueue sale sync after successful release (no marketplace calls).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueSaleSyncJob } from "./saleSyncQueue.ts";
import {
  buildSaleReleasePushIdempotencyKey,
  type SaleSourceChannel,
} from "./saleChannelSyncTypes.ts";
import { fetchVariantAvailableQtyAfterHold } from "./marketplaceSaleSyncAfterHold.ts";
import type { SaleReleaseBatchResult, SaleReleaseLineResult } from "./marketplaceSaleRelease.ts";

export type EnqueueSaleSyncAfterReleaseInput = {
  supabase: SupabaseClient;
  sourceChannel: SaleSourceChannel;
  productId?: string | null;
  variantId: string;
  availableQty?: number;
  externalOrderId: string;
  externalLineId: string;
  reservationId?: string | null;
  releaseActionId?: string | null;
  metadata?: Record<string, unknown>;
};

export type EnqueueSaleSyncAfterReleaseResult = {
  enqueued: boolean;
  idempotent: boolean;
  jobId: string | null;
  pushIdempotencyKey: string;
  skippedReason?: string;
  availableQty?: number;
};

const SKIP_RELEASE_REASONS = new Set([
  "no_active_reservation",
  "already_finalized",
  "afn_skip",
  "sale_release_failed",
  "invalid_channel",
  "invalid_order_ref",
  "order_skipped",
]);

export function shouldEnqueueAfterReleaseLine(line: SaleReleaseLineResult): boolean {
  return line.released === true && Boolean(line.variantId);
}

export async function enqueueSaleSyncAfterSuccessfulRelease(
  input: EnqueueSaleSyncAfterReleaseInput,
): Promise<EnqueueSaleSyncAfterReleaseResult> {
  const pushKey = buildSaleReleasePushIdempotencyKey(
    input.sourceChannel,
    input.externalOrderId,
    input.externalLineId,
  );

  let availableQty = input.availableQty;
  let productId = input.productId ?? null;

  if (availableQty === undefined || productId === null) {
    const avail = await fetchVariantAvailableQtyAfterHold(input.supabase, input.variantId);
    if (!avail) {
      console.warn(
        `[sale-sync-release-enqueue] available qty unknown ${input.sourceChannel} ${input.externalOrderId}/${input.externalLineId}`,
      );
      return {
        enqueued: false,
        idempotent: false,
        jobId: null,
        pushIdempotencyKey: pushKey,
        skippedReason: "sale_sync_available_qty_unknown",
      };
    }
    availableQty = avail.availableQty;
    productId = productId ?? avail.productId;
  }

  const qty = Math.trunc(Number(availableQty));
  if (!Number.isFinite(qty) || qty < 0) {
    return {
      enqueued: false,
      idempotent: false,
      jobId: null,
      pushIdempotencyKey: pushKey,
      skippedReason: "invalid_available_qty",
    };
  }

  const triggerRef = `${input.externalOrderId}:${input.externalLineId}`;
  const result = await enqueueSaleSyncJob({
    supabase: input.supabase,
    sourceChannel: input.sourceChannel,
    productId,
    variantId: input.variantId,
    availableQty: qty,
    externalOrderId: input.externalOrderId,
    externalLineId: input.externalLineId,
    reservationId: input.reservationId ?? null,
    holdActionId: input.releaseActionId ?? null,
    pushIdempotencyKey: pushKey,
    syncContext: {
      trigger_source: "sale_release",
      trigger_reference_type: "order_line",
      trigger_reference_id: triggerRef,
      stock_reservation_id: input.reservationId ?? null,
      orchestration_id: pushKey,
    },
    metadata: {
      ...(input.metadata ?? {}),
      enqueue_trigger: "sale_release_061c2",
    },
  });

  if (result.enqueued) {
    console.log(
      `[sale-sync-release-enqueue] Queued ${input.sourceChannel} ${input.externalOrderId}/${input.externalLineId} qty=${qty}`,
    );
  }

  return {
    enqueued: result.enqueued,
    idempotent: result.idempotent,
    jobId: result.jobId,
    pushIdempotencyKey: result.pushIdempotencyKey,
    skippedReason: result.skippedReason,
    availableQty: qty,
  };
}

/** Enqueue restore push for all qualifying lines in a release batch (non-fatal). */
export async function enqueueSaleSyncForReleaseBatch(
  sb: SupabaseClient,
  sourceChannel: SaleSourceChannel,
  sessionId: string,
  releaseResult: SaleReleaseBatchResult,
): Promise<{ enqueued: number; skipped: number; idempotent: number }> {
  const summary = { enqueued: 0, skipped: 0, idempotent: 0 };

  for (const line of releaseResult.lines) {
    if (!shouldEnqueueAfterReleaseLine(line)) {
      if (line.skippedReason && SKIP_RELEASE_REASONS.has(line.skippedReason)) {
        summary.skipped++;
      }
      continue;
    }

    if (!line.variantId) {
      summary.skipped++;
      continue;
    }

    try {
      const result = await enqueueSaleSyncAfterSuccessfulRelease({
        supabase: sb,
        sourceChannel,
        productId: line.productId ?? null,
        variantId: line.variantId,
        externalOrderId: sessionId,
        externalLineId: line.lineItemId,
        reservationId: line.reservationId,
        releaseActionId: line.releaseActionId ?? null,
      });

      if (result.enqueued) summary.enqueued++;
      else if (result.idempotent) summary.idempotent++;
      else summary.skipped++;
    } catch (err) {
      console.warn(
        `[sale-sync-release-enqueue] failed ${sessionId}/${line.lineItemId}:`,
        err instanceof Error ? err.message : String(err),
      );
      summary.skipped++;
    }
  }

  return summary;
}

/** Documented operator visibility issue hints (audit tables are source of truth). */
export const SALE_SYNC_VISIBILITY_ISSUES = [
  "sale_unmapped_no_hold",
  "sale_hold_failed",
  "sale_release_failed",
  "sale_sync_push_failed",
  "sale_sync_mapping_manual",
  "sale_sync_gate_off",
  "sale_sync_disabled",
  "sale_sync_available_qty_unknown",
] as const;
