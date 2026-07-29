// Phase 061A — Automatic sale inventory hold (reservation-first, no channel push).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type MarketplaceSaleChannel = "ebay" | "amazon";

export type SaleHoldSkipReason =
  | "order_skipped"
  | "unmapped_line"
  | "already_reserved"
  | "invalid_qty"
  | "afn_skip"
  | "not_paid"
  | "already_shipped"
  | "canceled_or_refunded"
  | "sale_hold_failed"
  | "invalid_channel"
  | "invalid_variant";

export type SaleHoldLineHint = {
  lineItemId: string;
  sellerSku?: string | null;
  productCode?: string | null;
  variantHint?: string | null;
  quantity: number;
};

export type SaleHoldOrderContext = {
  channel: MarketplaceSaleChannel;
  sessionId: string;
  skipOrder?: "canceled" | "shipped" | "afn" | null;
  lines?: SaleHoldLineHint[];
};

export type SaleHoldLineResult = {
  lineItemId: string;
  reserved: boolean;
  skippedReason: string | null;
  reservationId: string | null;
  variantId: string | null;
  productId?: string | null;
  holdActionId?: string | null;
};

export type SaleHoldBatchResult = {
  attempted: number;
  reserved: number;
  skipped: number;
  failed: number;
  lines: SaleHoldLineResult[];
};

export function buildSaleHoldIdempotencyKey(
  channel: string,
  orderId: string,
  lineItemId: string,
): string {
  return `sale:${channel}:${orderId}:${lineItemId}:reserve`;
}

type VariantResolveResult = {
  variantId: string | null;
  productId: string | null;
};

async function resolveVariantFromLineRow(
  sb: SupabaseClient,
  channel: MarketplaceSaleChannel,
  line: {
    variant_id?: string | null;
    product_id?: string | null;
    variant?: string | null;
    quantity?: number | null;
    stripe_line_item_id?: string | null;
  },
  hint?: SaleHoldLineHint,
): Promise<VariantResolveResult> {
  if (line.variant_id) {
    const { data: pv } = await sb
      .from("product_variants")
      .select("id, product_id")
      .eq("id", line.variant_id)
      .maybeSingle();
    if (pv?.id) {
      return { variantId: pv.id, productId: pv.product_id ?? null };
    }
  }

  const sellerSku = hint?.sellerSku?.trim() || null;
  const variantHint = hint?.variantHint || line.variant || null;
  const skuProductCode = sellerSku?.toUpperCase().match(/^(KK-\d+)/)?.[1] || null;
  const productCode = skuProductCode || hint?.productCode || line.product_id || null;

  if (channel === "amazon") {
    const sku = sellerSku || productCode;
    if (!sku) return { variantId: null, productId: null };

    const { data: byListing } = await sb
      .from("amazon_listings")
      .select("id, seller_sku")
      .eq("seller_sku", sku.trim())
      .limit(1)
      .maybeSingle();

    if (byListing?.id) {
      const { data: mapping } = await sb
        .from("amazon_listing_mappings")
        .select("kk_variant_id, kk_product_id")
        .eq("amazon_listing_id", byListing.id)
        .eq("mapping_status", "mapped")
        .not("kk_variant_id", "is", null)
        .limit(1)
        .maybeSingle();
      if (mapping?.kk_variant_id) {
        return {
          variantId: mapping.kk_variant_id,
          productId: mapping.kk_product_id ?? null,
        };
      }
    }

    return { variantId: null, productId: null };
  }

  if (!productCode) return { variantId: null, productId: null };

  const { data: product } = await sb
    .from("products")
    .select("id, code")
    .eq("code", productCode)
    .maybeSingle();

  if (!product?.id) return { variantId: null, productId: null };

  const skuCandidates = [sellerSku, variantHint].filter(Boolean) as string[];

  for (const sku of skuCandidates) {
    const { data: cacheHit } = await sb
      .from("ebay_listing_inventory_cache")
      .select("variant_id, product_id")
      .eq("product_id", product.id)
      .eq("ebay_sku", sku.trim())
      .not("variant_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (cacheHit?.variant_id) {
      return { variantId: cacheHit.variant_id, productId: cacheHit.product_id ?? product.id };
    }

    const { data: pvBySku } = await sb
      .from("product_variants")
      .select("id, product_id")
      .eq("product_id", product.id)
      .eq("sku", sku.trim())
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (pvBySku?.id) {
      return { variantId: pvBySku.id, productId: pvBySku.product_id ?? product.id };
    }
  }

  const { data: activeVariants } = await sb
    .from("product_variants")
    .select("id, product_id")
    .eq("product_id", product.id)
    .eq("is_active", true);

  if ((activeVariants || []).length === 1 && activeVariants?.[0]?.id) {
    return {
      variantId: activeVariants[0].id,
      productId: activeVariants[0].product_id ?? product.id,
    };
  }

  return { variantId: null, productId: product.id };
}

async function callReserveRpc(
  sb: SupabaseClient,
  params: {
    channel: MarketplaceSaleChannel;
    sessionId: string;
    lineItemId: string;
    variantId: string | null;
    productId: string | null;
    quantity: number;
    metadata?: Record<string, unknown>;
  },
): Promise<{
  reserved: boolean;
  skippedReason: string | null;
  reservationId: string | null;
  holdActionId: string | null;
}> {
  const idempotencyKey = buildSaleHoldIdempotencyKey(
    params.channel,
    params.sessionId,
    params.lineItemId,
  );

  const { data, error } = await sb.rpc("reserve_inventory_for_marketplace_sale", {
    p_channel: params.channel,
    p_external_order_id: params.sessionId,
    p_external_line_id: params.lineItemId,
    p_variant_id: params.variantId,
    p_quantity: params.quantity,
    p_idempotency_key: idempotencyKey,
    p_product_id: params.productId,
    p_metadata: params.metadata ?? null,
  });

  if (error) {
    console.warn(
      `[sale-hold] RPC failed ${params.channel} ${params.sessionId}/${params.lineItemId}:`,
      error.message,
    );
    return { reserved: false, skippedReason: "sale_hold_failed", reservationId: null, holdActionId: null };
  }

  const row = (data || {}) as Record<string, unknown>;
  return {
    reserved: row.reserved === true,
    skippedReason: row.skipped_reason ? String(row.skipped_reason) : null,
    reservationId: row.reservation_id ? String(row.reservation_id) : null,
    holdActionId: row.audit_id ? String(row.audit_id) : null,
  };
}

/** Process sale holds for all lines on an order session (non-fatal). */
export async function reserveSaleHoldsForOrderSession(
  sb: SupabaseClient,
  ctx: SaleHoldOrderContext,
): Promise<SaleHoldBatchResult> {
  const result: SaleHoldBatchResult = {
    attempted: 0,
    reserved: 0,
    skipped: 0,
    failed: 0,
    lines: [],
  };

  if (ctx.skipOrder) {
    console.log(
      `[sale-hold] Skipping order ${ctx.sessionId} (${ctx.channel}): ${ctx.skipOrder}`,
    );
    return result;
  }

  const { data: lines, error: lineErr } = await sb
    .from("line_items_raw")
    .select(
      "stripe_line_item_id, variant_id, product_id, variant, quantity",
    )
    .eq("stripe_checkout_session_id", ctx.sessionId);

  if (lineErr) {
    console.warn(`[sale-hold] line read failed ${ctx.sessionId}:`, lineErr.message);
    return result;
  }

  const hintByLine = new Map(
    (ctx.lines || []).map((h) => [h.lineItemId, h]),
  );

  for (const line of lines || []) {
    const lineItemId = String(line.stripe_line_item_id || "");
    if (!lineItemId) continue;

    result.attempted++;
    const hint = hintByLine.get(lineItemId);
    const qty = Number(hint?.quantity ?? line.quantity ?? 0) || 0;

    const resolved = await resolveVariantFromLineRow(sb, ctx.channel, line, hint);

    const rpcResult = await callReserveRpc(sb, {
      channel: ctx.channel,
      sessionId: ctx.sessionId,
      lineItemId,
      variantId: resolved.variantId,
      productId: resolved.productId,
      quantity: qty,
      metadata: {
        trigger: "sale_hold_061a",
        product_code: hint?.productCode ?? line.product_id ?? null,
        seller_sku: hint?.sellerSku ?? null,
      },
    });

    const lineResult: SaleHoldLineResult = {
      lineItemId,
      reserved: rpcResult.reserved,
      skippedReason: rpcResult.skippedReason,
      reservationId: rpcResult.reservationId,
      variantId: resolved.variantId,
      productId: resolved.productId,
      holdActionId: rpcResult.holdActionId,
    };
    result.lines.push(lineResult);

    if (rpcResult.reserved) {
      result.reserved++;
      console.log(
        `[sale-hold] Reserved ${ctx.channel} ${ctx.sessionId}/${lineItemId} → ${resolved.variantId}`,
      );
    } else if (rpcResult.skippedReason === "sale_hold_failed") {
      result.failed++;
    } else {
      result.skipped++;
      if (rpcResult.skippedReason === "unmapped_line") {
        console.warn(
          `[sale-hold] Unmapped line ${ctx.sessionId}/${lineItemId} — sale_unmapped_no_hold`,
        );
      }
    }
  }

  return result;
}

/** Derive order-level skip from eBay API order payload. */
export function ebayOrderHoldSkipReason(
  order: Record<string, unknown>,
  isCanceled: boolean,
): "canceled" | "shipped" | null {
  if (isCanceled) return "canceled";
  const status = String(order.orderFulfillmentStatus || "").toUpperCase();
  if (status === "FULFILLED") return "shipped";
  return null;
}

/** Derive order-level skip from Amazon order payload. */
export function amazonOrderHoldSkipReason(
  order: Record<string, unknown>,
  isCanceled: boolean,
): "canceled" | "shipped" | "afn" | null {
  if (isCanceled) return "canceled";
  const channel = String(order.FulfillmentChannel || "").toUpperCase();
  if (channel === "AFN") return "afn";
  const status = String(order.OrderStatus || "").toLowerCase();
  if (status === "shipped" || status === "partiallyshipped") return "shipped";
  return null;
}

export function buildEbayLineHintsFromOrder(
  order: Record<string, unknown>,
  resolveProductCode: (title: string, sellerSku?: string | null) => string | null,
): SaleHoldLineHint[] {
  const lineItems = (order.lineItems as Record<string, unknown>[]) || [];
  return lineItems.map((item) => {
    const title = (item.title as string) || "";
    const sellerSku = (item.sku as string) || (item.legacyVariationId as string) || null;
    return {
      lineItemId: `ebay_li_${String(item.lineItemId || "")}`,
      sellerSku,
      productCode: resolveProductCode(title, sellerSku),
      variantHint: sellerSku,
      quantity: Number(item.quantity ?? 1) || 1,
    };
  }).filter((h) => h.lineItemId !== "ebay_li_");
}

export function buildAmazonLineHintsFromRows(
  lineItemRows: Record<string, unknown>[],
  sellerSkus: string[],
): SaleHoldLineHint[] {
  return lineItemRows.map((row, i) => ({
    lineItemId: String(row.stripe_line_item_id || ""),
    sellerSku: sellerSkus[i] || null,
    productCode: typeof row.product_id === "string" ? row.product_id : null,
    variantHint: typeof row.variant === "string" ? row.variant : null,
    quantity: Number(row.quantity ?? 1) || 1,
  })).filter((h) => h.lineItemId);
}

/** Non-fatal sale hold pass for a newly ingested eBay order. */
export async function applyEbaySaleHoldsAfterIngest(
  sb: SupabaseClient,
  order: Record<string, unknown>,
  sessionId: string,
  isCanceled: boolean,
  resolveProductCode: (title: string, sellerSku?: string | null) => string | null,
): Promise<SaleHoldBatchResult> {
  try {
    const holdResult = await reserveSaleHoldsForOrderSession(sb, {
      channel: "ebay",
      sessionId,
      skipOrder: ebayOrderHoldSkipReason(order, isCanceled),
      lines: buildEbayLineHintsFromOrder(order, resolveProductCode),
    });
    const { enqueueSaleSyncForHoldBatch } = await import("./marketplaceSaleSyncAfterHold.ts");
    const enqueueSummary = await enqueueSaleSyncForHoldBatch(sb, "ebay", sessionId, holdResult);
    console.log(
      `[sale-hold] eBay enqueue ${sessionId}: enqueued=${enqueueSummary.enqueued} idempotent=${enqueueSummary.idempotent} skipped=${enqueueSummary.skipped}`,
    );
    return holdResult;
  } catch (err) {
    console.warn(
      `[sale-hold] eBay hold pass failed ${sessionId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { attempted: 0, reserved: 0, skipped: 0, failed: 0, lines: [] };
  }
}

/** Non-fatal sale hold pass for a synced Amazon order. */
export async function applyAmazonSaleHoldsAfterIngest(
  sb: SupabaseClient,
  order: Record<string, unknown>,
  sessionId: string,
  isCanceled: boolean,
  lineItemRows: Record<string, unknown>[],
  sellerSkus: string[],
): Promise<SaleHoldBatchResult> {
  try {
    const holdResult = await reserveSaleHoldsForOrderSession(sb, {
      channel: "amazon",
      sessionId,
      skipOrder: amazonOrderHoldSkipReason(order, isCanceled),
      lines: buildAmazonLineHintsFromRows(lineItemRows, sellerSkus),
    });
    const { enqueueSaleSyncForHoldBatch } = await import("./marketplaceSaleSyncAfterHold.ts");
    const enqueueSummary = await enqueueSaleSyncForHoldBatch(sb, "amazon", sessionId, holdResult);
    console.log(
      `[sale-hold] Amazon enqueue ${sessionId}: enqueued=${enqueueSummary.enqueued} idempotent=${enqueueSummary.idempotent} skipped=${enqueueSummary.skipped}`,
    );
    return holdResult;
  } catch (err) {
    console.warn(
      `[sale-hold] Amazon hold pass failed ${sessionId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { attempted: 0, reserved: 0, skipped: 0, failed: 0, lines: [] };
  }
}
