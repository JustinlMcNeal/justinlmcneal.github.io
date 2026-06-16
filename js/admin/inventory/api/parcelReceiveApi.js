/**
 * Read-only parcel receive summary API (Phase 5).
 */

import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";
import { mapParcelSummaryRow } from "../services/mapParcelSummary.js";

/** @returns {Promise<import('../services/mapParcelSummary.js').ParcelReceiveSummary>} */
export async function fetchParcelReceiveSummary() {
  await requireAuthenticatedSession();
  const sb = getSupabaseClient();

  const { data, error } = await sb
    .from("v_inventory_parcel_receive_summary")
    .select(
      "awaiting_mapping, ready_to_receive, recently_received, last_parcel_receive_at, parcel_ledger_entries",
    )
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to load parcel receive summary");
  if (!data) throw new Error("Parcel receive summary view returned no data");

  return mapParcelSummaryRow(data);
}
