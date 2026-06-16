// Phase 10O — Upsert read-only marketplace refund/cancel observations (no inventory mutations).

type ObservationUpsert = {
  sourceChannel: "ebay" | "amazon";
  sourceOrderId: string;
  sourceOrderItemId?: string | null;
  externalTransactionId?: string | null;
  externalRefundId?: string | null;
  refundAmountCents?: number | null;
  refundStatus?: string | null;
  refundReason?: string | null;
  cancellationStatus?: string | null;
  returnStatus?: string | null;
  lineAllocationConfidence?: string;
  fulfillmentChannel?: string | null;
  isAfn?: boolean;
  observationKind: "refund" | "cancellation" | "return" | "fulfillment";
  observationDedupKey: string;
  observedAt?: string | null;
  syncSource: "order_sync" | "finance_sync" | "webhook" | "admin_backfill";
  rawPayload?: unknown;
};

// deno-lint-ignore no-explicit-any
type DbClient = any;

export async function upsertMarketplaceObservation(
  client: DbClient,
  row: ObservationUpsert,
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    source_channel: row.sourceChannel,
    source_order_id: row.sourceOrderId,
    source_order_item_id: row.sourceOrderItemId ?? null,
    external_transaction_id: row.externalTransactionId ?? null,
    external_refund_id: row.externalRefundId ?? null,
    refund_amount_cents: row.refundAmountCents ?? null,
    currency: "usd",
    refund_status: row.refundStatus ?? null,
    refund_reason: row.refundReason ?? null,
    cancellation_status: row.cancellationStatus ?? null,
    return_status: row.returnStatus ?? null,
    line_allocation_confidence: row.lineAllocationConfidence ?? "order_level",
    fulfillment_channel: row.fulfillmentChannel ?? null,
    is_afn: row.isAfn ?? false,
    observation_kind: row.observationKind,
    observation_dedup_key: row.observationDedupKey,
    observed_at: row.observedAt ?? new Date().toISOString(),
    sync_source: row.syncSource,
    raw_payload: row.rawPayload ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await client
    .from("marketplace_refund_observations")
    .upsert(payload, { onConflict: "source_channel,observation_dedup_key" });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function upsertAmazonCancelObservations(
  client: DbClient,
  input: {
    sourceOrderId: string;
    isAfn: boolean;
    observedAt: string;
    orderPayload: unknown;
    lineItemRows: Array<{ stripe_line_item_id: string }>;
  },
): Promise<number> {
  let count = 0;
  const orderKey = `cancel:${input.sourceOrderId}`;
  const orderObs = await upsertMarketplaceObservation(client, {
    sourceChannel: "amazon",
    sourceOrderId: input.sourceOrderId,
    cancellationStatus: "cancelled",
    observationKind: "cancellation",
    observationDedupKey: orderKey,
    observedAt: input.observedAt,
    syncSource: "order_sync",
    isAfn: input.isAfn,
    fulfillmentChannel: input.isAfn ? "AFN" : "FBM",
    lineAllocationConfidence: "order_level",
    rawPayload: input.orderPayload,
  });
  if (orderObs.ok) count++;

  for (const line of input.lineItemRows) {
    const lineObs = await upsertMarketplaceObservation(client, {
      sourceChannel: "amazon",
      sourceOrderId: input.sourceOrderId,
      sourceOrderItemId: line.stripe_line_item_id,
      cancellationStatus: "cancelled",
      observationKind: "cancellation",
      observationDedupKey: `${orderKey}:line:${line.stripe_line_item_id}`,
      observedAt: input.observedAt,
      syncSource: "order_sync",
      isAfn: input.isAfn,
      fulfillmentChannel: input.isAfn ? "AFN" : "FBM",
      lineAllocationConfidence: "line_confirmed",
      rawPayload: input.orderPayload,
    });
    if (lineObs.ok) count++;
  }
  return count;
}

export async function upsertEbayCancelObservations(
  client: DbClient,
  input: {
    sourceOrderId: string;
    observedAt: string;
    orderPayload: unknown;
    lineItemIds: string[];
    syncSource?: ObservationUpsert["syncSource"];
  },
): Promise<number> {
  let count = 0;
  const syncSource = input.syncSource ?? "order_sync";
  const orderKey = `cancel:${input.sourceOrderId}`;
  const orderObs = await upsertMarketplaceObservation(client, {
    sourceChannel: "ebay",
    sourceOrderId: input.sourceOrderId,
    cancellationStatus: "cancelled",
    observationKind: "cancellation",
    observationDedupKey: orderKey,
    observedAt: input.observedAt,
    syncSource,
    lineAllocationConfidence: "order_level",
    rawPayload: input.orderPayload,
  });
  if (orderObs.ok) count++;

  for (const lineId of input.lineItemIds) {
    const stripeLineId = lineId.startsWith("ebay_li_") ? lineId : `ebay_li_${lineId}`;
    const lineObs = await upsertMarketplaceObservation(client, {
      sourceChannel: "ebay",
      sourceOrderId: input.sourceOrderId,
      sourceOrderItemId: stripeLineId,
      cancellationStatus: "cancelled",
      observationKind: "cancellation",
      observationDedupKey: `${orderKey}:line:${stripeLineId}`,
      observedAt: input.observedAt,
      syncSource,
      lineAllocationConfidence: "line_confirmed",
      rawPayload: input.orderPayload,
    });
    if (lineObs.ok) count++;
  }
  return count;
}
