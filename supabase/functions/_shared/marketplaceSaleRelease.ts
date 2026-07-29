// Phase 061C.1 — Release active sale reservations on cancel/refund before ship (no channel push).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type MarketplaceSaleChannel = "ebay" | "amazon" | "kk";

export type SaleReleaseSkipReason =
  | "order_skipped"
  | "no_active_reservation"
  | "already_released"
  | "already_finalized"
  | "afn_skip"
  | "invalid_channel"
  | "invalid_order_ref"
  | "sale_release_failed";

export type SaleReleaseLineResult = {
  lineItemId: string;
  released: boolean;
  skippedReason: string | null;
  reservationId: string | null;
  releaseActionId?: string | null;
  variantId?: string | null;
  productId?: string | null;
};

export type SaleReleaseBatchResult = {
  attempted: number;
  released: number;
  skipped: number;
  failed: number;
  lines: SaleReleaseLineResult[];
};

export type ReleaseMarketplaceSaleReservationInput = {
  supabase: SupabaseClient;
  channel: MarketplaceSaleChannel;
  externalOrderId: string;
  externalLineId: string;
  reservationId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type ReleaseMarketplaceSaleReservationResult = {
  released: boolean;
  skippedReason: string | null;
  reservationId: string | null;
  idempotencyKey: string;
  releaseActionId?: string | null;
  variantId?: string | null;
  productId?: string | null;
};

export function buildSaleReleaseIdempotencyKey(
  channel: string,
  orderId: string,
  lineItemId: string,
): string {
  return `sale:${channel}:${orderId}:${lineItemId}:release`;
}

async function callReleaseRpc(
  sb: SupabaseClient,
  input: {
    channel: MarketplaceSaleChannel;
    sessionId: string;
    lineItemId: string;
    reservationId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<ReleaseMarketplaceSaleReservationResult> {
  const idempotencyKey = buildSaleReleaseIdempotencyKey(
    input.channel,
    input.sessionId,
    input.lineItemId,
  );

  const { data, error } = await sb.rpc("release_marketplace_sale_reservation", {
    p_channel: input.channel,
    p_external_order_id: input.sessionId,
    p_external_line_id: input.lineItemId,
    p_idempotency_key: idempotencyKey,
    p_reservation_id: input.reservationId ?? null,
    p_reason: input.reason ?? null,
    p_metadata: input.metadata ?? null,
  });

  if (error) {
    console.warn(
      `[sale-release] RPC error ${input.channel} ${input.sessionId}/${input.lineItemId}:`,
      error.message,
    );
    return {
      released: false,
      skippedReason: "sale_release_failed",
      reservationId: input.reservationId ?? null,
      idempotencyKey,
    };
  }

  const row = (data || {}) as Record<string, unknown>;
  return {
    released: row.released === true,
    skippedReason: row.skipped_reason ? String(row.skipped_reason) : null,
    reservationId: row.reservation_id ? String(row.reservation_id) : null,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : idempotencyKey,
    releaseActionId: row.audit_id ? String(row.audit_id) : null,
    variantId: row.variant_id ? String(row.variant_id) : null,
    productId: row.product_id ? String(row.product_id) : null,
  };
}

async function resolveVariantFromReservation(
  sb: SupabaseClient,
  reservationId: string | null,
): Promise<{ variantId: string | null; productId: string | null }> {
  if (!reservationId) return { variantId: null, productId: null };
  const { data } = await sb
    .from("inventory_reservations")
    .select("variant_id, product_id")
    .eq("id", reservationId)
    .maybeSingle();
  return {
    variantId: data?.variant_id ? String(data.variant_id) : null,
    productId: data?.product_id ? String(data.product_id) : null,
  };
}

export async function releaseMarketplaceSaleReservation(
  input: ReleaseMarketplaceSaleReservationInput,
): Promise<ReleaseMarketplaceSaleReservationResult> {
  const result = await callReleaseRpc(input.supabase, {
    channel: input.channel,
    sessionId: input.externalOrderId,
    lineItemId: input.externalLineId,
    reservationId: input.reservationId,
    reason: input.reason,
    metadata: input.metadata,
  });

  if (result.released) {
    console.log(
      `[sale-release] Released ${input.channel} ${input.externalOrderId}/${input.externalLineId}`,
    );
  }

  return result;
}

export type SaleReleaseOrderContext = {
  channel: MarketplaceSaleChannel;
  sessionId: string;
  skipOrder?: "not_canceled" | "shipped" | "afn" | null;
  lineItemIds?: string[];
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

/** Release active sale reservations for all lines on an order session (non-fatal). */
export async function releaseSaleReservationsForOrderSession(
  sb: SupabaseClient,
  ctx: SaleReleaseOrderContext,
): Promise<SaleReleaseBatchResult> {
  const result: SaleReleaseBatchResult = {
    attempted: 0,
    released: 0,
    skipped: 0,
    failed: 0,
    lines: [],
  };

  if (ctx.skipOrder) {
    console.log(
      `[sale-release] Order skip ${ctx.channel} ${ctx.sessionId}: ${ctx.skipOrder}`,
    );
    return result;
  }

  let lineIds = ctx.lineItemIds || [];
  if (!lineIds.length) {
    const { data: lines, error: lineErr } = await sb
      .from("line_items_raw")
      .select("stripe_line_item_id")
      .eq("stripe_checkout_session_id", ctx.sessionId);

    if (lineErr) {
      console.warn(`[sale-release] line read failed ${ctx.sessionId}:`, lineErr.message);
      return result;
    }
    lineIds = (lines || [])
      .map((row) => String(row.stripe_line_item_id || ""))
      .filter(Boolean);
  }

  for (const lineItemId of lineIds) {
    result.attempted++;
    const rpcResult = await callReleaseRpc(sb, {
      channel: ctx.channel,
      sessionId: ctx.sessionId,
      lineItemId,
      reason: ctx.reason ?? null,
      metadata: {
        ...(ctx.metadata ?? {}),
        trigger: "sale_release_061c1",
      },
    });

    let variantId = rpcResult.variantId ?? null;
    let productId = rpcResult.productId ?? null;
    if (rpcResult.released && !variantId && rpcResult.reservationId) {
      const resolved = await resolveVariantFromReservation(sb, rpcResult.reservationId);
      variantId = resolved.variantId;
      productId = productId ?? resolved.productId;
    }

    const lineResult: SaleReleaseLineResult = {
      lineItemId,
      released: rpcResult.released,
      skippedReason: rpcResult.skippedReason,
      reservationId: rpcResult.reservationId,
      releaseActionId: rpcResult.releaseActionId,
      variantId,
      productId,
    };
    result.lines.push(lineResult);

    if (rpcResult.released) {
      result.released++;
    } else if (rpcResult.skippedReason === "sale_release_failed") {
      result.failed++;
      console.warn(
        `[sale-release] Failed ${ctx.sessionId}/${lineItemId} — sale_release_failed`,
      );
    } else {
      result.skipped++;
    }
  }

  return result;
}

export function ebayOrderReleaseSkipReason(
  order: Record<string, unknown>,
  isCanceled: boolean,
): "not_canceled" | "shipped" | null {
  if (!isCanceled) return "not_canceled";
  const status = String(order.orderFulfillmentStatus || "").toUpperCase();
  if (status === "FULFILLED") return "shipped";
  return null;
}

export function amazonOrderReleaseSkipReason(
  order: Record<string, unknown>,
  isCanceled: boolean,
): "not_canceled" | "shipped" | "afn" | null {
  if (!isCanceled) return "not_canceled";
  const channel = String(order.FulfillmentChannel || "").toUpperCase();
  if (channel === "AFN") return "afn";
  const status = String(order.OrderStatus || "").toLowerCase();
  if (status === "shipped" || status === "partiallyshipped") return "shipped";
  return null;
}

export function buildEbayReleaseLineIdsFromOrder(
  order: Record<string, unknown>,
): string[] {
  const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
  return lineItems
    .map((item) => `ebay_li_${String(item.lineItemId || "")}`)
    .filter((id) => id !== "ebay_li_");
}

export function buildAmazonReleaseLineIdsFromRows(
  lineItemRows: Record<string, unknown>[],
): string[] {
  return lineItemRows
    .map((row) => String(row.stripe_line_item_id || ""))
    .filter(Boolean);
}

/** Non-fatal release pass after eBay cancel before ship. */
export async function applyEbaySaleReleasesAfterCancel(
  sb: SupabaseClient,
  order: Record<string, unknown>,
  sessionId: string,
  isCanceled: boolean,
): Promise<SaleReleaseBatchResult> {
  try {
    const releaseResult = await releaseSaleReservationsForOrderSession(sb, {
      channel: "ebay",
      sessionId,
      skipOrder: ebayOrderReleaseSkipReason(order, isCanceled),
      lineItemIds: buildEbayReleaseLineIdsFromOrder(order),
      reason: "eBay order canceled before ship (061C.1)",
      metadata: { source: "ebay_cancel_061c1" },
    });
    console.log(
      `[sale-release] eBay ${sessionId}: attempted=${releaseResult.attempted} released=${releaseResult.released} skipped=${releaseResult.skipped}`,
    );
    const { enqueueSaleSyncForReleaseBatch } = await import("./marketplaceSaleSyncAfterRelease.ts");
    const enqueueSummary = await enqueueSaleSyncForReleaseBatch(sb, "ebay", sessionId, releaseResult);
    console.log(
      `[sale-release] eBay enqueue ${sessionId}: enqueued=${enqueueSummary.enqueued} idempotent=${enqueueSummary.idempotent} skipped=${enqueueSummary.skipped}`,
    );
    return releaseResult;
  } catch (err) {
    console.warn(
      `[sale-release] eBay release pass failed ${sessionId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { attempted: 0, released: 0, skipped: 0, failed: 0, lines: [] };
  }
}

/** Non-fatal release pass after Amazon cancel before ship. */
export async function applyAmazonSaleReleasesAfterCancel(
  sb: SupabaseClient,
  order: Record<string, unknown>,
  sessionId: string,
  isCanceled: boolean,
  lineItemRows: Record<string, unknown>[],
): Promise<SaleReleaseBatchResult> {
  try {
    const releaseResult = await releaseSaleReservationsForOrderSession(sb, {
      channel: "amazon",
      sessionId,
      skipOrder: amazonOrderReleaseSkipReason(order, isCanceled),
      lineItemIds: buildAmazonReleaseLineIdsFromRows(lineItemRows),
      reason: "Amazon order canceled before ship (061C.1)",
      metadata: { source: "amazon_cancel_061c1" },
    });
    console.log(
      `[sale-release] Amazon ${sessionId}: attempted=${releaseResult.attempted} released=${releaseResult.released} skipped=${releaseResult.skipped}`,
    );
    const { enqueueSaleSyncForReleaseBatch } = await import("./marketplaceSaleSyncAfterRelease.ts");
    const enqueueSummary = await enqueueSaleSyncForReleaseBatch(sb, "amazon", sessionId, releaseResult);
    console.log(
      `[sale-release] Amazon enqueue ${sessionId}: enqueued=${enqueueSummary.enqueued} idempotent=${enqueueSummary.idempotent} skipped=${enqueueSummary.skipped}`,
    );
    return releaseResult;
  } catch (err) {
    console.warn(
      `[sale-release] Amazon release pass failed ${sessionId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { attempted: 0, released: 0, skipped: 0, failed: 0, lines: [] };
  }
}

/** KK Stripe full refund — release per line via RPC (reserve-only mode). */
export async function releaseKkSaleReservationsOnFullRefund(
  sb: SupabaseClient,
  orderSessionId: string,
  stripeRefundId: string | null,
  metadata?: Record<string, unknown>,
): Promise<SaleReleaseBatchResult> {
  const reason = stripeRefundId
    ? `KK full refund before ship (${stripeRefundId})`
    : "KK full refund before ship";

  try {
    const releaseResult = await releaseSaleReservationsForOrderSession(sb, {
      channel: "kk",
      sessionId: orderSessionId,
      reason,
      metadata: {
        ...(metadata ?? {}),
        stripe_refund_id: stripeRefundId,
        source: "stripe_full_refund_061c1",
      },
    });
    console.log(
      `[sale-release] KK refund ${orderSessionId}: attempted=${releaseResult.attempted} released=${releaseResult.released} skipped=${releaseResult.skipped}`,
    );
    const { enqueueSaleSyncForReleaseBatch } = await import("./marketplaceSaleSyncAfterRelease.ts");
    const enqueueSummary = await enqueueSaleSyncForReleaseBatch(sb, "kk", orderSessionId, releaseResult);
    console.log(
      `[sale-release] KK enqueue ${orderSessionId}: enqueued=${enqueueSummary.enqueued} idempotent=${enqueueSummary.idempotent} skipped=${enqueueSummary.skipped}`,
    );
    return releaseResult;
  } catch (err) {
    console.warn(
      `[sale-release] KK refund release failed ${orderSessionId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { attempted: 0, released: 0, skipped: 0, failed: 0, lines: [] };
  }
}
