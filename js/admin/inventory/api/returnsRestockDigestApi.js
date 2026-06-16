/**
 * Returns/restock digest API (Phase 10W — preview/send via edge function; read-only).
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { getSupabaseClient } from "/js/shared/supabaseClient.js";
import { requireAuthenticatedSession } from "./inventoryApi.js";

/** @param {Object} body */
async function invokeDigestFunction(body) {
  await requireAuthenticatedSession();
  const {
    data: { session },
  } = await getSupabaseClient().auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/inventory-returns-restock-digest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  if (!res.ok || result.error) {
    throw new Error(result.error || result.message || `Digest request failed (${res.status})`);
  }
  return result;
}

/** @param {"daily"|"weekly"|"manual"} [runType] */
export async function previewReturnsRestockDigest(runType = "daily") {
  return invokeDigestFunction({ mode: "preview", run_type: runType });
}

/** @param {"daily"|"weekly"|"manual"} [runType] */
export async function sendReturnsRestockDigest(runType = "manual") {
  return invokeDigestFunction({ mode: "send", run_type: runType, confirm: true });
}

/** @param {number} [limit] */
export async function fetchDigestRunHistory(limit = 10) {
  await requireAuthenticatedSession();
  const { data, error } = await getSupabaseClient()
    .from("inventory_returns_restock_digest_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message || "Failed to load digest run history");
  return data ?? [];
}
