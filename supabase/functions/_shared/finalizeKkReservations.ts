// Phase 6E — KK reservation finalization on shipment (shared helper).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type FinalizeKkResult = {
  finalized_count?: number;
  finalized_units?: number;
  skipped_already_finalized?: number;
  missing_reservations?: number;
  note?: string;
};

/** True for Stripe KK store sessions (not eBay/Amazon prefixes). */
export function isKkStoreSession(sessionId: string): boolean {
  return !!sessionId && !sessionId.startsWith("ebay") && !sessionId.startsWith("amazon");
}

/** Call finalize_kk_order_reservations RPC (idempotent). */
export async function finalizeKkOrderReservations(
  sb: SupabaseClient,
  orderId: string,
  referenceId: string,
  source = "fulfillment",
): Promise<FinalizeKkResult | null> {
  if (!isKkStoreSession(orderId)) return null;

  const { data, error } = await sb.rpc("finalize_kk_order_reservations", {
    p_order_id: orderId,
    p_reference_id: referenceId,
    p_source: source,
  });

  if (error) throw error;
  return data as FinalizeKkResult;
}

/** Shippo tracking statuses that mean the package has left / been delivered. */
export function shouldFinalizeOnShippoTracking(
  currentStatus: string,
  previousLabelStatus: string,
): boolean {
  if (currentStatus === "TRANSIT") {
    return !["shipped", "delivered"].includes(previousLabelStatus);
  }
  if (currentStatus === "DELIVERED") {
    return !["delivered"].includes(previousLabelStatus);
  }
  return false;
}

/** Admin/manual label_status values that trigger finalization. */
export function shouldFinalizeOnLabelStatus(
  nextStatus: string,
  previousStatus: string,
): boolean {
  const finalizeStatuses = ["shipped", "delivered"];
  return finalizeStatuses.includes(nextStatus) && !finalizeStatuses.includes(previousStatus || "pending");
}
