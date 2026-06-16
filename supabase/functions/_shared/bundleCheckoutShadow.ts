// Phase 10D — Virtual bundle checkout/fulfillment shadow logging (no inventory mutation).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type BundleShadowHookResult = {
  attempted: number;
  inserted: number;
  skipped: number;
  errors: number;
};

type CheckoutLine = {
  stripe_line_item_id?: string | null;
  variant_id?: string | null;
  quantity?: number | null;
  product_id?: string | null;
  variant?: string | null;
};

type VariantResolver = (
  sb: SupabaseClient,
  row: CheckoutLine,
) => Promise<{ id: string } | null>;

/** Log reservation_shadow for paid checkout lines with virtual bundle rules in shadow mode. */
export async function recordBundleReservationShadowsForCheckout(
  sb: SupabaseClient,
  input: {
    sessionId: string;
    kkOrderId?: string | null;
    lineRows: CheckoutLine[];
    resolveVariant: VariantResolver;
  },
): Promise<BundleShadowHookResult> {
  const result: BundleShadowHookResult = { attempted: 0, inserted: 0, skipped: 0, errors: 0 };

  for (const row of input.lineRows) {
    const lineItemId = String(row.stripe_line_item_id ?? "").trim();
    const qty = Math.max(1, Number(row.quantity) || 1);

    let variantId = String(row.variant_id ?? "").trim();
    if (!variantId) {
      const resolved = await input.resolveVariant(sb, row);
      if (!resolved?.id) continue;
      variantId = resolved.id;
    }

    if (!lineItemId) continue;

    result.attempted += 1;
    const idempotencyKey = `bundle_shadow:reservation:${input.sessionId}:${lineItemId}`;

    try {
      const { data, error } = await sb.rpc("try_record_inventory_bundle_shadow_event", {
        p_event_type: "reservation_shadow",
        p_bundle_variant_id: variantId,
        p_quantity: qty,
        p_idempotency_key: idempotencyKey,
        p_source_order_id: input.sessionId,
        p_source_order_item_id: lineItemId,
        p_metadata: {
          hook: "stripe_checkout_completed",
          kk_order_id: input.kkOrderId ?? null,
          no_inventory_side_effects: true,
        },
      });

      if (error) {
        result.errors += 1;
        console.error("[bundle-shadow] reservation shadow RPC error:", error.message);
        continue;
      }

      const payload = data as { inserted?: boolean; reason?: string } | null;
      if (payload?.inserted) {
        result.inserted += 1;
        console.log(
          `[bundle-shadow] reservation_shadow inserted session=${input.sessionId} line=${lineItemId} variant=${variantId}`,
        );
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      result.errors += 1;
      console.error("[bundle-shadow] reservation shadow failed (non-fatal):", err);
    }
  }

  return result;
}

/** Log finalize_shadow when order ships — one event per line with bundle rules in shadow mode. */
export async function recordBundleFinalizeShadowsForOrder(
  sb: SupabaseClient,
  input: {
    orderId: string;
    referenceId: string;
    source?: string;
  },
): Promise<BundleShadowHookResult> {
  const result: BundleShadowHookResult = { attempted: 0, inserted: 0, skipped: 0, errors: 0 };

  const { data: lines, error: lineErr } = await sb
    .from("line_items_raw")
    .select("stripe_line_item_id, variant_id, quantity")
    .eq("stripe_checkout_session_id", input.orderId);

  if (lineErr) {
    console.error("[bundle-shadow] line_items_raw read failed:", lineErr.message);
    result.errors += 1;
    return result;
  }

  for (const row of lines ?? []) {
    const lineItemId = String(row.stripe_line_item_id ?? "").trim();
    const variantId = String(row.variant_id ?? "").trim();
    const qty = Math.max(1, Number(row.quantity) || 1);
    if (!lineItemId || !variantId) continue;

    result.attempted += 1;
    const idempotencyKey =
      `bundle_shadow:finalize:${input.orderId}:${lineItemId}:${input.referenceId}`;

    try {
      const { data, error } = await sb.rpc("try_record_inventory_bundle_shadow_event", {
        p_event_type: "finalize_shadow",
        p_bundle_variant_id: variantId,
        p_quantity: qty,
        p_idempotency_key: idempotencyKey,
        p_source_order_id: input.orderId,
        p_source_order_item_id: lineItemId,
        p_metadata: {
          hook: input.source ?? "fulfillment_finalize",
          reference_id: input.referenceId,
          no_inventory_side_effects: true,
        },
      });

      if (error) {
        result.errors += 1;
        console.error("[bundle-shadow] finalize shadow RPC error:", error.message);
        continue;
      }

      const payload = data as { inserted?: boolean } | null;
      if (payload?.inserted) {
        result.inserted += 1;
        console.log(
          `[bundle-shadow] finalize_shadow inserted order=${input.orderId} line=${lineItemId}`,
        );
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      result.errors += 1;
      console.error("[bundle-shadow] finalize shadow failed (non-fatal):", err);
    }
  }

  return result;
}
