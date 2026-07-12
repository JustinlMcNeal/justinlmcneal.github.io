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

export type EbayExistingOrderUpdateResult = {
  found: boolean;
  sessionId: string;
  canceled: boolean;
  fulfillmentUpdated: boolean;
  variantsRepaired: number;
};

/**
 * When an eBay order already exists, align fulfillment status + cancel observations (10O rules).
 * Also repairs line variant labels when rows still store legacyVariationId.
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
    fulfillmentUpdated: true,
    variantsRepaired,
  };
}
