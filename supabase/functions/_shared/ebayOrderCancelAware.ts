// Phase 10O/10P — eBay cancel-aware fulfillment + observation updates (no inventory mutations).

import { upsertEbayCancelObservations } from "./marketplaceObservationSync.ts";

// deno-lint-ignore no-explicit-any
type DbClient = any;

/** eBay cancelStatus.cancelState === CANCELED */
export function isEbayOrderCanceled(order: Record<string, unknown>): boolean {
  const cancelStatus = order.cancelStatus as Record<string, unknown> | undefined;
  const state = String(cancelStatus?.cancelState || "").toUpperCase();
  return state === "CANCELED" || state === "CANCELLED";
}

export type EbayExistingOrderUpdateResult = {
  found: boolean;
  sessionId: string;
  canceled: boolean;
  fulfillmentUpdated: boolean;
};

/**
 * When an eBay order already exists, align fulfillment status + cancel observations (10O rules).
 */
export async function updateExistingEbayOrderFromApi(
  supabase: DbClient,
  order: Record<string, unknown>,
  opts?: { syncSource?: "order_sync" | "webhook" | "finance_sync" | "admin_backfill" },
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
    return { found: false, sessionId: defaultSessionId, canceled: isCanceled, fulfillmentUpdated: false };
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

  if (isCanceled) {
    const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
    await upsertEbayCancelObservations(supabase, {
      sourceOrderId: sessionId,
      observedAt: String(order.creationDate || new Date().toISOString()),
      orderPayload: order,
      lineItemIds: lineItems.map((item) => String(item.lineItemId || "")).filter(Boolean),
      syncSource: opts?.syncSource ?? "order_sync",
    });
  }

  return { found: true, sessionId, canceled: isCanceled, fulfillmentUpdated: true };
}
