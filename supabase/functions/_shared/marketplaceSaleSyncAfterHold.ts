// Phase 061B.3 — Enqueue sale sync after successful hold (no marketplace calls).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueSaleSyncJob } from "./saleSyncQueue.ts";
import { buildSalePushIdempotencyKey, type SaleSourceChannel } from "./saleChannelSyncTypes.ts";
import type { SaleHoldBatchResult, SaleHoldLineResult } from "./marketplaceSaleHold.ts";

export type EnqueueSaleSyncAfterHoldInput = {
  supabase: SupabaseClient;
  sourceChannel: SaleSourceChannel;
  productId?: string | null;
  variantId: string;
  availableQty?: number;
  externalOrderId: string;
  externalLineId: string;
  reservationId?: string | null;
  holdActionId?: string | null;
  metadata?: Record<string, unknown>;
};

export type EnqueueSaleSyncAfterHoldResult = {
  enqueued: boolean;
  idempotent: boolean;
  jobId: string | null;
  pushIdempotencyKey: string;
  skippedReason?: string;
  availableQty?: number;
};

const SKIP_HOLD_REASONS = new Set([
  "unmapped_line",
  "invalid_qty",
  "afn_skip",
  "canceled_or_refunded",
  "already_shipped",
  "sale_hold_failed",
  "invalid_channel",
  "invalid_variant",
  "invalid_order_ref",
]);

export function shouldEnqueueAfterHoldLine(line: SaleHoldLineResult): boolean {
  if (line.reserved) return Boolean(line.variantId);
  if (line.skippedReason === "already_reserved" && line.reservationId && line.variantId) {
    return true;
  }
  return false;
}

export async function fetchVariantAvailableQtyAfterHold(
  sb: SupabaseClient,
  variantId: string,
): Promise<{ availableQty: number; productId: string | null } | null> {
  const { data: candidate, error } = await sb
    .from("v_inventory_channel_sync_candidates")
    .select("available_qty, product_id")
    .eq("variant_id", variantId)
    .maybeSingle();

  if (!error && candidate) {
    const qty = Number(candidate.available_qty);
    if (Number.isFinite(qty)) {
      return {
        availableQty: Math.max(0, Math.trunc(qty)),
        productId: candidate.product_id ? String(candidate.product_id) : null,
      };
    }
  }

  const { data: pv } = await sb
    .from("product_variants")
    .select("stock, product_id")
    .eq("id", variantId)
    .maybeSingle();

  if (!pv) return null;

  const { data: resRows } = await sb
    .from("inventory_reservations")
    .select("quantity")
    .eq("variant_id", variantId)
    .eq("status", "reserved")
    .eq("is_shadow", false);

  const reserved = (resRows || []).reduce(
    (sum, row) => sum + (Number(row.quantity) || 0),
    0,
  );
  const onHand = Number(pv.stock ?? 0);
  if (!Number.isFinite(onHand)) return null;

  return {
    availableQty: Math.max(0, Math.trunc(onHand - reserved)),
    productId: pv.product_id ? String(pv.product_id) : null,
  };
}

export async function enqueueSaleSyncAfterSuccessfulHold(
  input: EnqueueSaleSyncAfterHoldInput,
): Promise<EnqueueSaleSyncAfterHoldResult> {
  const pushKey = buildSalePushIdempotencyKey(
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
        `[sale-sync-enqueue] available qty unknown ${input.sourceChannel} ${input.externalOrderId}/${input.externalLineId}`,
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
    holdActionId: input.holdActionId ?? null,
    pushIdempotencyKey: pushKey,
    syncContext: {
      trigger_source: "sale",
      trigger_reference_type: "order_line",
      trigger_reference_id: triggerRef,
      stock_reservation_id: input.reservationId ?? null,
      orchestration_id: pushKey,
    },
    metadata: {
      ...(input.metadata ?? {}),
      enqueue_trigger: "sale_hold_061b3",
    },
  });

  if (result.enqueued) {
    console.log(
      `[sale-sync-enqueue] Queued ${input.sourceChannel} ${input.externalOrderId}/${input.externalLineId} qty=${qty}`,
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

/** Enqueue sale sync for all qualifying lines in a hold batch (non-fatal). */
export async function enqueueSaleSyncForHoldBatch(
  sb: SupabaseClient,
  sourceChannel: SaleSourceChannel,
  sessionId: string,
  holdResult: SaleHoldBatchResult,
): Promise<{ enqueued: number; skipped: number; idempotent: number }> {
  const summary = { enqueued: 0, skipped: 0, idempotent: 0 };

  for (const line of holdResult.lines) {
    if (!shouldEnqueueAfterHoldLine(line)) {
      if (line.skippedReason && SKIP_HOLD_REASONS.has(line.skippedReason)) {
        summary.skipped++;
      }
      continue;
    }

    if (!line.variantId) {
      summary.skipped++;
      continue;
    }

    try {
      const result = await enqueueSaleSyncAfterSuccessfulHold({
        supabase: sb,
        sourceChannel,
        productId: line.productId ?? null,
        variantId: line.variantId,
        externalOrderId: sessionId,
        externalLineId: line.lineItemId,
        reservationId: line.reservationId,
        holdActionId: line.holdActionId ?? null,
      });

      if (result.enqueued) summary.enqueued++;
      else if (result.idempotent) summary.idempotent++;
      else summary.skipped++;
    } catch (err) {
      console.warn(
        `[sale-sync-enqueue] failed ${sessionId}/${line.lineItemId}:`,
        err instanceof Error ? err.message : String(err),
      );
      summary.skipped++;
    }
  }

  return summary;
}
