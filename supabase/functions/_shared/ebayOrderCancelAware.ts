// Phase 10O/10P — eBay cancel-aware fulfillment + observation updates + 061C.1 sale release.

import { upsertEbayCancelObservations } from "./marketplaceObservationSync.ts";
import { applyEbaySaleReleasesAfterCancel } from "./marketplaceSaleRelease.ts";
import {
  loadEbayVariantHints,
  ProductVariantHint,
  repairEbayLineItemVariants,
} from "./ebayOrderVariantResolve.ts";

// deno-lint-ignore no-explicit-any
type DbClient = any;

/** eBay cancelStatus.cancelState === CANCELED */
export function isEbayOrderCanceled(order: Record<string, unknown>): boolean {
  const cancelStatus = order.cancelStatus as Record<string, unknown> | undefined;
  const state = String(cancelStatus?.cancelState || "").toUpperCase();
  return state === "CANCELED" || state === "CANCELLED";
}

function toCents(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export type EbayRefundPatch = {
  refund_status: "full" | "partial";
  refund_amount_cents: number;
  refunded_at: string;
  refund_reason: "cancelled_before_ship" | "returned";
  stripe_refund_id: string | null;
};

/**
 * Map eBay Fulfillment payment/refund fields onto orders_raw.refund_*.
 * Prefer line-item refund totals (buyer-facing) over paymentSummary.refunds (often net-to-seller).
 */
export function extractEbayRefundPatch(
  order: Record<string, unknown>,
  totalPaidCents: number,
): EbayRefundPatch | null {
  const pay = String(order.orderPaymentStatus || "").toUpperCase();
  const paymentSummary = (order.paymentSummary || {}) as Record<string, unknown>;
  const summaryRefunds = (paymentSummary.refunds as Record<string, unknown>[]) || [];
  const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
  const lineRefunds = lineItems.flatMap((li) =>
    ((li.refunds as Record<string, unknown>[]) || []),
  );

  let summaryAmount = 0;
  let lineAmount = 0;
  let refundedAt: string | null = null;
  let refundId: string | null = null;

  for (const r of summaryRefunds) {
    const amt = r.amount as Record<string, unknown> | undefined;
    summaryAmount += toCents(amt?.value);
    if (!refundedAt && r.refundDate) refundedAt = String(r.refundDate);
    if (!refundId) {
      refundId = String(r.refundId || r.refundReferenceId || "") || null;
    }
  }
  for (const r of lineRefunds) {
    const amt = r.amount as Record<string, unknown> | undefined;
    lineAmount += toCents(amt?.value);
    if (!refundedAt && r.refundDate) refundedAt = String(r.refundDate);
    if (!refundId) refundId = String(r.refundId || "") || null;
  }

  let amount = lineAmount > 0 ? lineAmount : summaryAmount;
  const fully =
    pay === "FULLY_REFUNDED" ||
    (amount > 0 && totalPaidCents > 0 && amount >= totalPaidCents);
  const partially =
    pay === "PARTIALLY_REFUNDED" ||
    (amount > 0 && totalPaidCents > 0 && amount < totalPaidCents);

  if (!fully && !partially && amount <= 0) return null;
  if (fully && amount <= 0) amount = totalPaidCents;

  const fulfilled = String(order.orderFulfillmentStatus || "").toUpperCase() === "FULFILLED";
  return {
    refund_status: fully ? "full" : "partial",
    refund_amount_cents: amount,
    refunded_at: refundedAt || new Date().toISOString(),
    refund_reason: fulfilled ? "returned" : "cancelled_before_ship",
    stripe_refund_id: refundId ? `ebay_refund_${refundId}` : null,
  };
}

async function applyEbayRefundToOrdersRaw(
  supabase: DbClient,
  sessionId: string,
  order: Record<string, unknown>,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("orders_raw")
    .select("total_paid_cents, refund_status, refund_amount_cents, refund_reason, stripe_refund_id")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (!existing) return false;

  const patch = extractEbayRefundPatch(order, Number(existing.total_paid_cents || 0));
  if (!patch) return false;

  // Don't downgrade a stronger local refund record.
  if (existing.refund_status === "full" && patch.refund_status === "partial") {
    return false;
  }
  if (
    existing.refund_status === patch.refund_status &&
    Number(existing.refund_amount_cents || 0) === patch.refund_amount_cents
  ) {
    return false;
  }

  const update: Record<string, unknown> = {
    refund_status: patch.refund_status,
    refund_amount_cents: patch.refund_amount_cents,
    refunded_at: patch.refunded_at,
    updated_at: new Date().toISOString(),
  };
  if (!existing.refund_reason) update.refund_reason = patch.refund_reason;
  if (!existing.stripe_refund_id && patch.stripe_refund_id) {
    update.stripe_refund_id = patch.stripe_refund_id;
  }

  const { error } = await supabase
    .from("orders_raw")
    .update(update)
    .eq("stripe_checkout_session_id", sessionId);

  if (error) {
    console.error("[ebay-order-update] refund patch failed:", error.message);
    return false;
  }
  return true;
}

export type EbayExistingOrderUpdateResult = {
  found: boolean;
  sessionId: string;
  canceled: boolean;
  refundUpdated: boolean;
  fulfillmentUpdated: boolean;
  variantsRepaired: number;
};

/**
 * When an eBay order already exists, align fulfillment status + cancel observations (10O rules).
 * Also repairs line variant labels when rows still store legacyVariationId.
 * Writes orders_raw.refund_* when eBay reports FULLY/PARTIALLY_REFUNDED or refund rows.
 */
export async function updateExistingEbayOrderFromApi(
  supabase: DbClient,
  order: Record<string, unknown>,
  opts?: {
    syncSource?: "order_sync" | "webhook" | "finance_sync" | "admin_backfill";
    resolveProductCode?: (title: string) => string | null;
    variantHints?: ProductVariantHint[];
  },
): Promise<EbayExistingOrderUpdateResult> {
  const orderId = String(order.orderId || "");
  const defaultSessionId = `ebay_api_${orderId}`;
  const isCanceled = isEbayOrderCanceled(order);

  const { data: existing } = await supabase
    .from("orders_raw")
    .select("stripe_checkout_session_id")
    .or(`stripe_checkout_session_id.eq.ebay_${orderId},stripe_checkout_session_id.eq.${defaultSessionId}`)
    .maybeSingle();

  if (!existing) {
    return {
      found: false,
      sessionId: defaultSessionId,
      canceled: isCanceled,
      refundUpdated: false,
      fulfillmentUpdated: false,
      variantsRepaired: 0,
    };
  }

  const sessionId = String(existing.stripe_checkout_session_id || defaultSessionId);
  const orderFulfillmentStatus = String(order.orderFulfillmentStatus || "");
  let labelStatus = "pending";
  if (isCanceled) labelStatus = "cancelled";
  else if (orderFulfillmentStatus === "FULFILLED") labelStatus = "shipped";
  else if (orderFulfillmentStatus === "IN_PROGRESS") labelStatus = "label_purchased";

  await supabase.from("fulfillment_shipments").upsert({
    stripe_checkout_session_id: sessionId,
    kk_order_id: `EBAY-${orderId}`,
    label_status: labelStatus,
    notes: isCanceled
      ? `eBay order canceled (${String((order.cancelStatus as Record<string, unknown>)?.cancelState || "CANCELED")})`
      : `eBay order ${orderId}, fulfillment status: ${orderFulfillmentStatus || "UNKNOWN"}`,
  }, { onConflict: "stripe_checkout_session_id" });

  let variantsRepaired = 0;
  try {
    const hints = opts?.variantHints ?? await loadEbayVariantHints(supabase);
    const resolveProductCode = opts?.resolveProductCode ?? (() => null);
    variantsRepaired = await repairEbayLineItemVariants(
      supabase,
      sessionId,
      order,
      resolveProductCode,
      hints,
    );
  } catch (err) {
    console.error("[ebay-order-update] Variant repair failed:", err);
  }

  const refundUpdated = await applyEbayRefundToOrdersRaw(supabase, sessionId, order);

  if (isCanceled) {
    const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
    await upsertEbayCancelObservations(supabase, {
      sourceOrderId: sessionId,
      observedAt: String(order.creationDate || new Date().toISOString()),
      orderPayload: order,
      lineItemIds: lineItems.map((item) => String(item.lineItemId || "")).filter(Boolean),
      syncSource: opts?.syncSource ?? "order_sync",
    });
    await applyEbaySaleReleasesAfterCancel(supabase, order, sessionId, isCanceled);
  }

  return {
    found: true,
    sessionId,
    canceled: isCanceled,
    refundUpdated,
    fulfillmentUpdated: true,
    variantsRepaired,
  };
}
