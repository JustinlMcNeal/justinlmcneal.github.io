import { getSupabaseClient } from "/js/shared/supabaseClient.js";

export async function requireAdminOrShowError(els) {
  const sb = getSupabaseClient();

  const { data, error } = await sb.rpc("is_admin");

  if (error) {
    console.error("[guard] is_admin error", error);
    els.status.textContent = `Admin check failed: ${error.message}`;
    return false;
  }

  if (!data) {
    els.status.textContent = "Not authorized (admin only).";
    return false;
  }

  return true;
}
