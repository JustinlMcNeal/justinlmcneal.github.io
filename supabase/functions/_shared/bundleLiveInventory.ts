// Phase 10F — Live virtual bundle component reservations (paid checkout + refund).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type LiveBundleReserveResult = {
  ok: boolean;
  reservedComponents?: number;
  skippedDuplicate?: number;
  failedComponents?: number;
  issues?: unknown[];
  reason?: string;
};

/** Check if live component deduction is enabled for a bundle variant. */
export async function isBundleLiveDeductionEnabled(
  sb: SupabaseClient,
  bundleVariantId: string,
): Promise<boolean> {
  const { data, error } = await sb.rpc("is_bundle_live_deduction_enabled", {
    p_bundle_variant_id: bundleVariantId,
  });
  if (error) {
    console.warn("[bundle-live] live guard check failed:", error.message);
    return false;
  }
  return Boolean(data);
}

/** Reserve component inventory for a live virtual bundle line (idempotent). */
export async function reserveLiveBundleComponents(
  sb: SupabaseClient,
  input: {
    orderId: string;
    orderItemId: string;
    bundleVariantId: string;
    quantity: number;
  },
): Promise<LiveBundleReserveResult> {
  const { data, error } = await sb.rpc("reserve_live_bundle_components", {
    p_order_id: input.orderId,
    p_order_item_id: input.orderItemId,
    p_bundle_variant_id: input.bundleVariantId,
    p_quantity: input.quantity,
  });

  if (error) {
    console.error("[bundle-live] component reserve RPC error:", error.message);
    return { ok: false, reason: error.message };
  }

  const payload = data as Record<string, unknown> | null;
  return {
    ok: Boolean(payload?.ok),
    reservedComponents: Number(payload?.reserved_components ?? 0),
    skippedDuplicate: Number(payload?.skipped_duplicate ?? 0),
    failedComponents: Number(payload?.failed_components ?? 0),
    issues: Array.isArray(payload?.issues) ? payload.issues : [],
    reason: payload?.reason ? String(payload.reason) : undefined,
  };
}

/** Release component reservations on full refund before finalization. */
export async function releaseLiveBundleComponentReservations(
  sb: SupabaseClient,
  orderSessionId: string,
  orderItemId?: string | null,
): Promise<number> {
  const { data, error } = await sb.rpc("release_live_bundle_component_reservations", {
    p_order_id: orderSessionId,
    p_order_item_id: orderItemId ?? null,
  });

  if (error) {
    console.error("[bundle-live] component release RPC error:", error.message);
    return 0;
  }

  const payload = data as { released_count?: number } | null;
  return Number(payload?.released_count ?? 0);
}
