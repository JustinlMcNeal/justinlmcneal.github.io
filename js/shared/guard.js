import { getSupabaseClient } from "/js/shared/supabaseClient.js";

/**
 * Wait for Supabase to hydrate session from magic-link hash / PKCE code.
 * @param {number} [maxWaitMs]
 */
export async function ensureSupabaseSessionReady(maxWaitMs = 8000) {
  const sb = getSupabaseClient();
  if (!sb) return false;

  const hash = window.location.hash || "";
  const search = window.location.search || "";
  const pendingAuth =
    hash.includes("access_token") ||
    hash.includes("refresh_token") ||
    search.includes("code=");

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (session) return true;
    if (!pendingAuth) return false;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const {
    data: { session },
  } = await sb.auth.getSession();
  return Boolean(session);
}

/**
 * Admin guard:
 * - Uses sb.rpc("is_admin") (same as pCalc)
 * - Returns { ok, reason }
 */
export async function requireAdmin() {
  const sb = getSupabaseClient();
  if (!sb) return { ok: false, reason: "Supabase client not initialized." };

  await ensureSupabaseSessionReady();

  const { data, error } = await sb.rpc("is_admin");

  if (error) {
    console.error("[guard] is_admin error", error);
    return { ok: false, reason: `Admin check failed: ${error.message}` };
  }

  if (!data) return { ok: false, reason: "Not authorized (admin only)." };

  return { ok: true, reason: "" };
}
