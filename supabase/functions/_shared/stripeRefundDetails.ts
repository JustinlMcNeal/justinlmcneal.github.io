// Phase 10K/10L — Observational Stripe refund detail cache (no stock/workflow mutations).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type Stripe from "npm:stripe@17.7.0";

export type LineAllocationConfidence = "order_level" | "line_inferred" | "line_confirmed" | "none";
export type RefundSyncSource = "webhook" | "admin_refresh";

export type LineTotalRow = {
  stripe_line_item_id: string;
  quantity?: number | null;
  post_discount_unit_price_cents?: number | null;
  unit_price_cents?: number | null;
};

export function buildLineTotalsMap(lineItems: LineTotalRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const li of lineItems) {
    const qty = Number(li.quantity ?? 1);
    const unit = Number(li.post_discount_unit_price_cents ?? li.unit_price_cents ?? 0);
    if (li.stripe_line_item_id) map.set(String(li.stripe_line_item_id), qty * unit);
  }
  return map;
}

export function classifyLineAllocation(
  refund: Stripe.Refund,
  lineTotals: Map<string, number>,
): { lineId: string | null; confidence: LineAllocationConfidence } {
  const amount = refund.amount ?? 0;
  const metaLine =
    (refund.metadata?.stripe_line_item_id as string | undefined) ||
    (refund.metadata?.line_id as string | undefined) ||
    null;

  let lineId: string | null = metaLine;
  let confidence: LineAllocationConfidence = "order_level";

  if (metaLine) {
    confidence = "line_confirmed";
  } else if (lineTotals.size === 1) {
    lineId = [...lineTotals.keys()][0];
    confidence = amount >= (lineTotals.get(lineId!) ?? 0) ? "line_inferred" : "order_level";
  } else if (lineId && lineTotals.has(lineId) && amount >= (lineTotals.get(lineId) ?? 0)) {
    confidence = "line_inferred";
  }

  return { lineId, confidence };
}

export function normalizeRefundDetailRow(
  refund: Stripe.Refund,
  opts: {
    sessionId: string;
    paymentIntentId: string;
    lineTotals: Map<string, number>;
    syncSource: RefundSyncSource;
  },
): Record<string, unknown> {
  const amount = refund.amount ?? 0;
  const createdAt = new Date((refund.created ?? 0) * 1000).toISOString();
  const { lineId, confidence } = classifyLineAllocation(refund, opts.lineTotals);
  const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id ?? null;

  return {
    source_channel: "kk",
    source_order_id: opts.sessionId,
    source_order_item_id: lineId,
    stripe_refund_id: refund.id,
    stripe_payment_intent_id: opts.paymentIntentId,
    stripe_charge_id: chargeId,
    refund_amount_cents: amount,
    currency: refund.currency ?? "usd",
    refund_status: refund.status ?? null,
    refund_reason: refund.reason ?? null,
    line_allocation_confidence: confidence,
    refund_created_at: createdAt,
    sync_source: opts.syncSource,
    raw_payload: refund as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  };
}

export async function upsertRefundDetailRow(
  sb: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb
    .from("order_refund_details")
    .upsert(row, { onConflict: "stripe_refund_id", ignoreDuplicates: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function summarizeRefunds(refunds: Stripe.Refund[], totalPaidCents: number) {
  let totalRefunded = 0;
  let latestRefundAt: string | null = null;
  let latestRefundId: string | null = null;

  for (const refund of refunds) {
    const amount = refund.amount ?? 0;
    totalRefunded += amount;
    const createdAt = new Date((refund.created ?? 0) * 1000).toISOString();
    if (!latestRefundAt || createdAt > latestRefundAt) {
      latestRefundAt = createdAt;
      latestRefundId = refund.id;
    }
  }

  const isFullRefund = totalPaidCents > 0 ? totalRefunded >= totalPaidCents : totalRefunded > 0;
  return {
    totalRefunded,
    latestRefundAt,
    latestRefundId,
    refundStatus: totalRefunded > 0 ? (isFullRefund ? "full" : "partial") : null,
    isFullRefund,
  };
}

export async function syncOrdersRawRefundSummary(
  sb: SupabaseClient,
  sessionId: string,
  summary: ReturnType<typeof summarizeRefunds>,
  paymentIntentId: string,
) {
  await sb.from("orders_raw").update({
    refund_status: summary.refundStatus,
    refund_amount_cents: summary.totalRefunded,
    refunded_at: summary.latestRefundAt,
    stripe_refund_id: summary.latestRefundId,
    stripe_payment_intent_id: paymentIntentId,
    updated_at: new Date().toISOString(),
  }).eq("stripe_checkout_session_id", sessionId);
}

/** Upsert observational refund rows only — never touches stock, reservations, or workflows. */
export async function enrichOrderRefundDetails(opts: {
  sb: SupabaseClient;
  sessionId: string;
  paymentIntentId: string;
  refunds: Stripe.Refund[];
  syncSource: RefundSyncSource;
  lineItems?: LineTotalRow[];
}): Promise<{ upserted: number; failed: number; refundsProcessed: number }> {
  let lineItems = opts.lineItems;
  if (!lineItems) {
    const { data } = await opts.sb
      .from("line_items_raw")
      .select("stripe_line_item_id, quantity, post_discount_unit_price_cents, unit_price_cents")
      .eq("stripe_checkout_session_id", opts.sessionId);
    lineItems = data ?? [];
  }

  const lineTotals = buildLineTotalsMap(lineItems);
  let upserted = 0;
  let failed = 0;

  for (const refund of opts.refunds) {
    const row = normalizeRefundDetailRow(refund, {
      sessionId: opts.sessionId,
      paymentIntentId: opts.paymentIntentId,
      lineTotals,
      syncSource: opts.syncSource,
    });
    const result = await upsertRefundDetailRow(opts.sb, row);
    if (result.ok) upserted += 1;
    else {
      failed += 1;
      console.warn(`[stripeRefundDetails] upsert failed refund=${refund.id}: ${result.error}`);
    }
  }

  return { upserted, failed, refundsProcessed: opts.refunds.length };
}

export async function resolveOrderSessionFromPaymentIntent(
  stripe: Stripe,
  sb: SupabaseClient,
  paymentIntentId: string,
): Promise<string | null> {
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  if (sessions.data.length > 0) return sessions.data[0].id;

  const { data: matchRows } = await sb
    .from("orders_raw")
    .select("stripe_checkout_session_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1);

  if (matchRows?.length) return matchRows[0].stripe_checkout_session_id as string;
  return null;
}

export async function fetchAllRefundsForPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<Stripe.Refund[]> {
  const listed = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  return listed.data ?? [];
}

/** Prefer Stripe list API; fall back to charge-embedded refunds from webhook payload. */
export async function fetchAllRefundsForCharge(
  stripe: Stripe,
  chargeId: string,
  chargeRefunds?: Stripe.Refund[],
): Promise<Stripe.Refund[]> {
  try {
    const listed = await stripe.refunds.list({ charge: chargeId, limit: 100 });
    if (listed.data?.length) return listed.data;
  } catch (err) {
    console.warn("[stripeRefundDetails] refunds.list(charge) failed, using embedded list", err);
  }
  return chargeRefunds ?? [];
}

/** Webhook helper: enrich cache from charge.refunded (non-throwing). */
export async function enrichRefundDetailsFromChargeEvent(opts: {
  sb: SupabaseClient;
  stripe: Stripe;
  charge: Stripe.Charge;
  sessionId: string;
  paymentIntentId: string;
}): Promise<{ upserted: number; failed: number; refundsProcessed: number }> {
  const chargeId = opts.charge.id;
  const refunds = await fetchAllRefundsForCharge(
    opts.stripe,
    chargeId,
    opts.charge.refunds?.data ?? [],
  );

  if (!refunds.length) {
    console.log(
      `[stripeRefundDetails] no refund objects for charge=${chargeId} session=${opts.sessionId}`,
    );
    return { upserted: 0, failed: 0, refundsProcessed: 0 };
  }

  return enrichOrderRefundDetails({
    sb: opts.sb,
    sessionId: opts.sessionId,
    paymentIntentId: opts.paymentIntentId,
    refunds,
    syncSource: "webhook",
  });
}
