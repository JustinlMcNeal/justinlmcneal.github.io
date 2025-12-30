import { getSupabaseClient } from "/js/shared/supabaseClient.js";

/**
 * Admin guard:
 * - Uses sb.rpc("is_admin") (same as pCalc)
 * - Returns { ok, reason }
 */
export async function requireAdmin() {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, reason: "Supabase client not initialized." };

  const { data, error } = await sb.rpc("is_admin");

  if (error) {
    console.error("[guard] is_admin error", error);
    return { ok: false, reason: `Admin check failed: ${error.message}` };
  }

  if (!data) return { ok: false, reason: "Not authorized (admin only)." };

  return { ok: true, reason: "" };
}
