// amazon-auth-status — Safe Amazon connection metadata for admin UI (no tokens).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SellerAccountRow = {
  id: string;
  seller_id: string;
  account_label: string | null;
  region: string;
  marketplace_ids: string[] | null;
  is_active: boolean;
  authorized_at: string | null;
  last_token_refresh_at: string | null;
  token_status: string;
  created_at: string;
};

type TokenMetaRow = {
  token_status: string;
  last_refresh_at: string | null;
  last_error: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeJwtRole(authHeader: string | null): string | null {
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

function maskSellerId(sellerId: string): string {
  const trimmed = sellerId.trim();
  if (trimmed.length <= 5) return trimmed;
  const first = trimmed[0];
  const last4 = trimmed.slice(-4);
  const middleLen = Math.max(trimmed.length - 5, 3);
  return `${first}${"*".repeat(middleLen)}${last4}`;
}

function resolveTokenStatus(
  accountStatus: string,
  tokenStatus: string | null | undefined,
): string {
  if (!tokenStatus) return accountStatus;
  if (accountStatus === "active" && tokenStatus === "active") return "active";
  if (tokenStatus !== "active") return tokenStatus;
  return accountStatus;
}

function isConnected(accountStatus: string, tokenStatus: string | null | undefined): boolean {
  return accountStatus === "active" && tokenStatus === "active";
}

function pickLastTokenRefreshAt(
  accountRefresh: string | null,
  tokenRefresh: string | null | undefined,
): string | null {
  if (!accountRefresh && !tokenRefresh) return null;
  if (!accountRefresh) return tokenRefresh ?? null;
  if (!tokenRefresh) return accountRefresh;
  return new Date(accountRefresh) >= new Date(tokenRefresh)
    ? accountRefresh
    : tokenRefresh;
}

async function requireAdmin(
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
): Promise<Response | null> {
  if (decodeJwtRole(authHeader) === "service_role") {
    return null;
  }

  const caller = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) {
    console.log("[amazon-auth-status] unauthorized");
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const { data: isAdmin, error: adminErr } = await caller.rpc("is_admin");
  if (adminErr || !isAdmin) {
    console.log("[amazon-auth-status] forbidden");
    return json({ ok: false, error: "forbidden" }, 403);
  }

  return null;
}

async function parseSellerAccountId(req: Request): Promise<string | null | Response> {
  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("sellerAccountId");
    return id?.trim() || null;
  }

  try {
    const body = await req.json();
    if (body && typeof body === "object" && "sellerAccountId" in body) {
      const id = (body as { sellerAccountId?: unknown }).sellerAccountId;
      if (id === null || id === undefined || id === "") return null;
      if (typeof id !== "string") {
        return json({ ok: false, error: "invalid_request" }, 400);
      }
      return id.trim();
    }
    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  console.log("[amazon-auth-status] start");

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    console.log("[amazon-auth-status] server_misconfigured");
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    console.log("[amazon-auth-status] unauthorized");
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const adminErr = await requireAdmin(supabaseUrl, supabaseAnonKey, authHeader);
  if (adminErr) return adminErr;

  const sellerAccountIdParam = await parseSellerAccountId(req);
  if (sellerAccountIdParam instanceof Response) return sellerAccountIdParam;

  if (sellerAccountIdParam && !UUID_RE.test(sellerAccountIdParam)) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    let account: SellerAccountRow | null = null;

    if (sellerAccountIdParam) {
      const { data, error } = await serviceClient
        .from("amazon_seller_accounts")
        .select(
          "id, seller_id, account_label, region, marketplace_ids, is_active, authorized_at, last_token_refresh_at, token_status, created_at",
        )
        .eq("id", sellerAccountIdParam)
        .maybeSingle();

      if (error) {
        console.log("[amazon-auth-status] database_error");
        return json({ ok: false, error: "database_error" }, 500);
      }
      account = data as SellerAccountRow | null;
    } else {
      const { data, error } = await serviceClient
        .from("amazon_seller_accounts")
        .select(
          "id, seller_id, account_label, region, marketplace_ids, is_active, authorized_at, last_token_refresh_at, token_status, created_at",
        )
        .order("is_active", { ascending: false })
        .order("authorized_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        console.log("[amazon-auth-status] database_error");
        return json({ ok: false, error: "database_error" }, 500);
      }
      account = (data?.[0] as SellerAccountRow | undefined) ?? null;
    }

    if (!account) {
      console.log("[amazon-auth-status] success connected=false");
      return json({
        ok: true,
        connected: false,
        tokenStatus: "not_connected",
      });
    }

    const { data: tokenMeta, error: tokenErr } = await serviceClient
      .from("amazon_auth_tokens")
      .select("token_status, last_refresh_at, last_error")
      .eq("seller_account_id", account.id)
      .maybeSingle();

    if (tokenErr) {
      console.log("[amazon-auth-status] database_error");
      return json({ ok: false, error: "database_error" }, 500);
    }

    const token = tokenMeta as TokenMetaRow | null;
    const tokenStatus = resolveTokenStatus(account.token_status, token?.token_status);
    const connected = isConnected(account.token_status, token?.token_status);
    const lastTokenRefreshAt = pickLastTokenRefreshAt(
      account.last_token_refresh_at,
      token?.last_refresh_at,
    );

    console.log(`[amazon-auth-status] success connected=${connected}`);

    return json({
      ok: true,
      connected,
      sellerAccountId: account.id,
      sellerId: maskSellerId(account.seller_id),
      region: account.region,
      marketplaceIds: account.marketplace_ids ?? [],
      tokenStatus,
      authorizedAt: account.authorized_at,
      lastTokenRefreshAt,
      accountLabel: account.account_label,
      isActive: account.is_active,
    });
  } catch {
    console.log("[amazon-auth-status] database_error");
    return json({ ok: false, error: "database_error" }, 500);
  }
});
