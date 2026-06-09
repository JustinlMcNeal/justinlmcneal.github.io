/** Receive parcel import inventory RPC (Phase 11). */

import { requireAuthenticatedSession } from "./parcelImportsApi.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * @param {string} importId
 * @param {{ idempotencyKey?: string | null }} [opts]
 */
export async function receiveParcelImportInventory(importId, opts = {}) {
  await requireAuthenticatedSession();

  if (!importId) {
    throw new Error("Import ID required — open an approved import first.");
  }

  const { data, error } = await supabase.rpc("receive_parcel_import_inventory", {
    p_import_id: importId,
    p_idempotency_key: opts.idempotencyKey ?? null,
  });

  if (error) throw new Error(error.message || "Receive inventory failed");
  return data;
}
