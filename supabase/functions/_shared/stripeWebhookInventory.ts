// Phase 6C+ — Stripe webhook idempotency + KK reservations (shadow → reserve-only cutover).



import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";



export const DEDUP_CHECKOUT_STOCK_DEDUCT = "checkout_stock_deduct";

export const DEDUP_CHECKOUT_RESERVE = "checkout_reserve";

export const DEDUP_REFUND_STOCK_RESTORE = "refund_stock_restore";



export type KkReservationMode = "legacy_direct_deduct" | "shadow" | "reserve_only";



export type VariantStockRow = {

  id: string;

  stock: number;

  product_id: string;

};



export type SkuLookup = {

  product_uuid: string;

};



/** Read KK reservation mode from cutover settings (defaults to shadow). */

export async function getKkReservationMode(sb: SupabaseClient): Promise<KkReservationMode> {

  const { data, error } = await sb

    .from("inventory_cutover_settings")

    .select("kk_reservation_mode")

    .eq("id", 1)

    .maybeSingle();



  if (error) {

    console.warn("[stripe-webhook] cutover settings read failed, defaulting to shadow:", error.message);

    return "shadow";

  }



  const mode = data?.kk_reservation_mode;

  if (mode === "legacy_direct_deduct" || mode === "shadow" || mode === "reserve_only") {

    return mode;

  }

  return "shadow";

}



/** Claim a Stripe-event dedup slot. Returns claimed=false when already processed. */

export async function claimStripeInventoryDedup(

  sb: SupabaseClient,

  stripeEventId: string,

  actionType: string,

  referenceId?: string | null,

): Promise<{ claimed: boolean }> {

  const { error } = await sb.from("inventory_event_dedup").insert({

    stripe_event_id: stripeEventId,

    action_type: actionType,

    reference_id: referenceId ?? null,

  });



  if (error) {

    if (error.code === "23505") return { claimed: false };

    throw error;

  }

  return { claimed: true };

}



/** Resolve variant for a checkout line row (variant_id first, then SKU + option_value). */

export async function resolveCheckoutLineVariant(

  sb: SupabaseClient,

  row: {

    variant_id?: string | null;

    product_id?: string | null;

    variant?: string | null;

  },

  skuMap: Map<string, SkuLookup>,

): Promise<VariantStockRow | null> {

  const sku = row.product_id;

  const variantName = row.variant;



  if (row.variant_id) {

    const { data: byId, error: idErr } = await sb

      .from("product_variants")

      .select("id, stock, product_id")

      .eq("id", row.variant_id)

      .limit(1);



    if (!idErr && byId?.length) return byId[0] as VariantStockRow;

    if (idErr) {

      console.warn(`[stripe-webhook] variant_id lookup failed for ${row.variant_id}:`, idErr.message);

    }

  }



  if (!sku) return null;



  const lookup = skuMap.get(sku);

  if (!lookup?.product_uuid) return null;



  const variantQuery = sb

    .from("product_variants")

    .select("id, stock, product_id")

    .eq("product_id", lookup.product_uuid);



  if (variantName) variantQuery.eq("option_value", variantName);



  const { data: byText, error: tErr } = await variantQuery.limit(1);

  if (tErr || !byText?.length) return null;

  return byText[0] as VariantStockRow;

}



/** Resolve variant for a DB line_items_raw row (refund path). */

export async function resolveDbLineVariant(

  sb: SupabaseClient,

  li: {

    product_id?: string | null;

    variant?: string | null;

    variant_id?: string | null;

  },

): Promise<VariantStockRow | null> {

  if (li.variant_id) {

    const { data: byId } = await sb

      .from("product_variants")

      .select("id, stock, product_id")

      .eq("id", li.variant_id)

      .limit(1);

    if (byId?.length) return byId[0] as VariantStockRow;

  }



  if (!li.product_id) return null;



  const { data: prodRow } = await sb

    .from("products")

    .select("id")

    .eq("code", li.product_id)

    .single();



  if (!prodRow?.id) return null;



  const vQuery = sb

    .from("product_variants")

    .select("id, stock, product_id")

    .eq("product_id", prodRow.id);



  if (li.variant) vQuery.eq("option_value", li.variant);



  const { data: vRows } = await vQuery.limit(1);

  if (!vRows?.length) return null;

  return vRows[0] as VariantStockRow;

}



export type ReservationInput = {

  orderId: string;

  orderItemId: string;

  variantId: string;

  productId: string;

  quantity: number;

  sourceReference: string;

  isShadow: boolean;

  notes?: string;

};



/** Insert KK reservation (idempotent via idempotency_key). */

export async function upsertKkReservation(

  sb: SupabaseClient,

  input: ReservationInput,

): Promise<{ inserted: boolean; skipped: boolean }> {

  const idempotencyKey = `kk:${input.orderId}:${input.orderItemId}:reserve`;



  const { error } = await sb.from("inventory_reservations").insert({

    channel: "kk",

    order_id: input.orderId,

    order_item_id: input.orderItemId,

    variant_id: input.variantId,

    product_id: input.productId,

    quantity: input.quantity,

    status: "reserved",

    is_shadow: input.isShadow,

    idempotency_key: idempotencyKey,

    source_reference: input.sourceReference,

    notes: input.notes ?? (

      input.isShadow

        ? "Shadow reservation recorded while Stripe webhook still deducts stock directly"

        : "Active reservation on checkout (reserve-only mode)"

    ),

  });



  if (error) {

    if (error.code === "23505") return { inserted: false, skipped: true };

    throw error;

  }

  return { inserted: true, skipped: false };

}



/** @deprecated use upsertKkReservation with isShadow=true */

export async function upsertShadowReservation(

  sb: SupabaseClient,

  input: Omit<ReservationInput, "isShadow" | "notes">,

): Promise<{ inserted: boolean; skipped: boolean }> {

  return upsertKkReservation(sb, { ...input, isShadow: true });

}



/** Mark KK shadow reservations released on full refund (idempotent — only status=reserved). */

export async function releaseKkShadowReservations(

  sb: SupabaseClient,

  orderSessionId: string,

  stripeRefundId: string | null,

): Promise<number> {

  const note = stripeRefundId

    ? `Shadow released on full refund (${stripeRefundId})`

    : "Shadow released on full refund";



  const { data, error } = await sb

    .from("inventory_reservations")

    .update({

      status: "released",

      notes: note,

    })

    .eq("channel", "kk")

    .eq("order_id", orderSessionId)

    .eq("is_shadow", true)

    .eq("status", "reserved")

    .select("id");



  if (error) throw error;

  return data?.length ?? 0;

}



/** Release active (non-shadow) KK reservations on full refund in reserve-only mode. */

export async function releaseKkActiveReservations(

  sb: SupabaseClient,

  orderSessionId: string,

  stripeRefundId: string | null,

): Promise<number> {

  const note = stripeRefundId

    ? `Active reservation released on full refund (${stripeRefundId})`

    : "Active reservation released on full refund";



  const { data, error } = await sb

    .from("inventory_reservations")

    .update({

      status: "released",

      notes: note,

    })

    .eq("channel", "kk")

    .eq("order_id", orderSessionId)

    .eq("is_shadow", false)

    .eq("status", "reserved")

    .select("id");



  if (error) throw error;

  return data?.length ?? 0;

}



/** Decrement variant stock + order ledger row (legacy/shadow modes). */

export async function decrementVariantStockForOrder(

  sb: SupabaseClient,

  variantRow: VariantStockRow,

  qty: number,

  referenceId: string,

  productUuid: string,

): Promise<void> {

  const stockBefore = variantRow.stock ?? 0;

  const stockAfter = Math.max(0, stockBefore - qty);



  const { error: updateErr } = await sb

    .from("product_variants")

    .update({ stock: stockAfter })

    .eq("id", variantRow.id);



  if (updateErr) throw updateErr;



  await sb.from("stock_ledger").insert({

    variant_id: variantRow.id,

    product_id: productUuid || variantRow.product_id,

    change: -qty,

    reason: "order",

    reference_id: referenceId,

    stock_before: stockBefore,

    stock_after: stockAfter,

  });

}



/** Restore variant stock on refund (legacy/shadow modes). */

export async function restoreVariantStockForRefund(

  sb: SupabaseClient,

  variantRow: VariantStockRow,

  qty: number,

  orderSessionId: string,

): Promise<void> {

  const stockBefore = variantRow.stock ?? 0;

  const stockAfter = stockBefore + qty;



  await sb

    .from("product_variants")

    .update({ stock: stockAfter })

    .eq("id", variantRow.id);



  await sb.from("stock_ledger").insert({

    variant_id: variantRow.id,

    product_id: variantRow.product_id,

    change: qty,

    reason: "refund",

    reference_id: orderSessionId,

    stock_before: stockBefore,

    stock_after: stockAfter,

  });

}


