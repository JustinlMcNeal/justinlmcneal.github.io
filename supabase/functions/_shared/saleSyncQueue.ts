// Phase 061B.2 — Sale sync queue helper (read/write only; no marketplace calls).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildSalePushIdempotencyKey,
  resolveSaleTargetChannels,
  type SaleSourceChannel,
  type SaleSyncQueueStatus,
} from "./saleChannelSyncTypes.ts";

export type SaleSyncQueueJob = {
  id: string;
  status: SaleSyncQueueStatus;
  source_channel: SaleSourceChannel;
  target_channels: string[];
  product_id: string | null;
  variant_id: string;
  available_qty: number;
  external_order_id: string | null;
  external_line_id: string | null;
  reservation_id: string | null;
  hold_action_id: string | null;
  push_idempotency_key: string;
  sync_context: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  metadata: Record<string, unknown>;
};

export type EnqueueSaleSyncJobInput = {
  supabase: SupabaseClient;
  sourceChannel: SaleSourceChannel;
  targetChannels?: string[];
  productId?: string | null;
  variantId: string;
  availableQty: number;
  externalOrderId: string;
  externalLineId: string;
  reservationId?: string | null;
  holdActionId?: string | null;
  pushIdempotencyKey?: string;
  syncContext?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type EnqueueSaleSyncJobResult = {
  enqueued: boolean;
  idempotent: boolean;
  jobId: string | null;
  pushIdempotencyKey: string;
  skippedReason?: string;
};

export type ClaimSaleSyncJobsInput = {
  supabase: SupabaseClient;
  limit?: number;
  workerId?: string;
};

export type MarkSaleSyncJobResultInput = {
  supabase: SupabaseClient;
  jobId: string;
  status: SaleSyncQueueStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
  retryDelaySeconds?: number;
};

const BACKOFF_SECONDS = [30, 60, 120, 300, 600];

function backoffSeconds(attemptCount: number): number {
  const idx = Math.min(Math.max(0, attemptCount - 1), BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[idx];
}

export async function enqueueSaleSyncJob(
  input: EnqueueSaleSyncJobInput,
): Promise<EnqueueSaleSyncJobResult> {
  const pushKey = input.pushIdempotencyKey?.trim()
    || buildSalePushIdempotencyKey(input.sourceChannel, input.externalOrderId, input.externalLineId);

  const { data: existing } = await input.supabase
    .from("inventory_sale_sync_queue")
    .select("id, status")
    .eq("push_idempotency_key", pushKey)
    .maybeSingle();

  if (existing?.id) {
    return {
      enqueued: false,
      idempotent: true,
      jobId: existing.id,
      pushIdempotencyKey: pushKey,
      skippedReason: "already_queued",
    };
  }

  const qty = Math.trunc(Number(input.availableQty));
  if (!Number.isFinite(qty) || qty < 0) {
    return {
      enqueued: false,
      idempotent: false,
      jobId: null,
      pushIdempotencyKey: pushKey,
      skippedReason: "invalid_qty",
    };
  }

  const targets = (input.targetChannels?.length
    ? input.targetChannels
    : resolveSaleTargetChannels(input.sourceChannel)) as string[];

  const row = {
    source_channel: input.sourceChannel,
    target_channels: targets,
    product_id: input.productId ?? null,
    variant_id: input.variantId,
    available_qty: qty,
    external_order_id: input.externalOrderId,
    external_line_id: input.externalLineId,
    reservation_id: input.reservationId ?? null,
    hold_action_id: input.holdActionId ?? null,
    push_idempotency_key: pushKey,
    sync_context: input.syncContext ?? {},
    metadata: input.metadata ?? {},
    status: "pending",
  };

  const { data, error } = await input.supabase
    .from("inventory_sale_sync_queue")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: dup } = await input.supabase
        .from("inventory_sale_sync_queue")
        .select("id")
        .eq("push_idempotency_key", pushKey)
        .maybeSingle();
      return {
        enqueued: false,
        idempotent: true,
        jobId: dup?.id ?? null,
        pushIdempotencyKey: pushKey,
        skippedReason: "already_queued",
      };
    }
    throw error;
  }

  return {
    enqueued: true,
    idempotent: false,
    jobId: data.id,
    pushIdempotencyKey: pushKey,
  };
}

export async function claimSaleSyncJobs(
  input: ClaimSaleSyncJobsInput,
): Promise<SaleSyncQueueJob[]> {
  const limit = Math.min(Math.max(1, input.limit ?? 10), 50);
  const workerId = input.workerId?.trim() || "worker";

  const { data, error } = await input.supabase.rpc("claim_inventory_sale_sync_jobs", {
    p_limit: limit,
    p_worker_id: workerId,
  });

  if (error) throw error;
  return (data || []) as SaleSyncQueueJob[];
}

export async function markSaleSyncJobResult(
  input: MarkSaleSyncJobResultInput,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: current } = await input.supabase
    .from("inventory_sale_sync_queue")
    .select("attempt_count, max_attempts, status")
    .eq("id", input.jobId)
    .maybeSingle();

  const attemptCount = Number(current?.attempt_count ?? 0);
  const maxAttempts = Number(current?.max_attempts ?? 5);
  const terminal = new Set(["succeeded", "dry_run", "skipped", "partial", "dead"]);

  let nextStatus = input.status;
  let availableAt = now;
  let nextAttempt = attemptCount;

  if (input.status === "failed" && !terminal.has(String(current?.status))) {
    nextAttempt = attemptCount + 1;
    if (nextAttempt >= maxAttempts) {
      nextStatus = "dead";
    } else {
      nextStatus = "pending";
      const delay = input.retryDelaySeconds ?? backoffSeconds(nextAttempt);
      availableAt = new Date(Date.now() + delay * 1000).toISOString();
    }
  }

  const patch: Record<string, unknown> = {
    status: nextStatus,
    last_result: input.result ?? null,
    last_error: input.error ?? null,
    updated_at: now,
    locked_at: null,
    locked_by: null,
    attempt_count: nextAttempt,
    available_at: availableAt,
  };

  const { error } = await input.supabase
    .from("inventory_sale_sync_queue")
    .update(patch)
    .eq("id", input.jobId);

  if (error) throw error;
}
