// Shared helpers for Amazon auth edge functions (admin guard, state hash, safe redirects).

export const SITE_URL = "https://karrykraze.com";
export const DEFAULT_ADMIN_PATH = "/pages/admin/amazon.html";
export const VALID_REGIONS = new Set(["na", "eu", "fe"]);

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function maskSellerId(sellerId: string): string {
  const trimmed = sellerId.trim();
  if (trimmed.length <= 5) return trimmed;
  const first = trimmed[0];
  const last4 = trimmed.slice(-4);
  const middleLen = Math.max(trimmed.length - 5, 3);
  return `${first}${"*".repeat(middleLen)}${last4}`;
}

export const corsHeadersJson = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const consentBaseByRegion: Record<string, string> = {
  na: "https://sellercentral.amazon.com/apps/authorize/consent",
  eu: "https://sellercentral-europe.amazon.com/apps/authorize/consent",
  fe: "https://sellercentral.amazon.co.jp/apps/authorize/consent",
};

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersJson, "Content-Type": "application/json", ...extraHeaders },
  });
}

export function decodeJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const jsonPayload = atob(padded);
    const parsed = JSON.parse(jsonPayload) as { role?: string };
    return parsed.role || null;
  } catch {
    return null;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isSafeLocalPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes(":") || path.includes("\\")) return false;
  if (!/^\/[A-Za-z0-9/_.-]+$/.test(path)) return false;
  return path.startsWith("/pages/admin/");
}

export function resolveRedirectPath(redirectAfter: string | null | undefined): string {
  if (redirectAfter && isSafeLocalPath(redirectAfter)) return redirectAfter;
  return DEFAULT_ADMIN_PATH;
}

export function buildAdminRedirect(
  redirectPath: string,
  outcome: "success" | "error",
  reason?: string,
): string {
  const path = resolveRedirectPath(redirectPath);
  const url = new URL(path, SITE_URL);
  url.searchParams.set("amazon_auth", outcome);
  if (outcome === "error" && reason) {
    url.searchParams.set("reason", reason);
  }
  return url.toString();
}

export function redirectToAdmin(
  redirectPath: string,
  outcome: "success" | "error",
  reason?: string,
): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: buildAdminRedirect(redirectPath, outcome, reason) },
  });
}

export type AdminGuardResult =
  | { ok: true; userId: string | null }
  | { ok: false; response: Response };

export async function requireAdminJson(
  createClient: typeof import("https://esm.sh/@supabase/supabase-js@2").createClient,
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
  logPrefix: string,
): Promise<AdminGuardResult> {
  if (decodeJwtRole(authHeader) === "service_role") {
    return { ok: true, userId: null };
  }

  const caller = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) {
    console.log(`${logPrefix} unauthorized`);
    return { ok: false, response: json({ ok: false, error: "unauthorized" }, 401) };
  }

  const { data: isAdmin, error: adminErr } = await caller.rpc("is_admin");
  if (adminErr || !isAdmin) {
    console.log(`${logPrefix} forbidden`);
    return { ok: false, response: json({ ok: false, error: "forbidden" }, 403) };
  }

  return { ok: true, userId: userData.user.id };
}
