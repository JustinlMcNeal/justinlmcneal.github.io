// amazon-auth-disconnect — Soft-revoke Amazon auth (preserve listing history).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeadersJson,
  json,
  maskSellerId,
  requireAdminJson,
  UUID_RE,
} from "../_shared/amazonAuthUtils.ts";

const LOG_PREFIX = "[amazon-auth-disconnect]";

type SellerAccountRow = {
  id: string;
  seller_id: string;
};

type DisconnectPayload = {
  sellerAccountId?: unknown;
};

async function resolveSellerAccount(
  serviceClient: ReturnType<typeof createClient>,
  sellerAccountId: string | null,
): Promise<SellerAccountRow | null> {
  if (sellerAccountId) {
    const { data, error } = await serviceClient
      .from("amazon_seller_accounts")
      .select("id, seller_id")
      .eq("id", sellerAccountId)
      .maybeSingle();

    if (error) throw new Error("database_error");
    return data as SellerAccountRow | null;
  }

  const { data, error } = await serviceClient
    .from("amazon_seller_accounts")
    .select("id, seller_id")
    .order("is_active", { ascending: false })
    .order("authorized_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw new Error("database_error");
  return (data?.[0] as SellerAccountRow | undefined) ?? null;
}

Deno.serve(async (req) => {
  console.log(`${LOG_PREFIX} start`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeadersJson });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    console.log(`${LOG_PREFIX} server_misconfigured`);
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    console.log(`${LOG_PREFIX} unauthorized`);
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const admin = await requireAdminJson(
    createClient,
    supabaseUrl,
    supabaseAnonKey,
    authHeader,
    LOG_PREFIX,
  );
  if (!admin.ok) return admin.response;

  let body: DisconnectPayload = {};
  try {
    body = (await req.json()) as DisconnectPayload;
  } catch {
    body = {};
  }

  let sellerAccountId: string | null = null;
  if (body.sellerAccountId !== undefined && body.sellerAccountId !== null && body.sellerAccountId !== "") {
    if (typeof body.sellerAccountId !== "string") {
      return json({ ok: false, error: "invalid_request" }, 400);
    }
    sellerAccountId = body.sellerAccountId.trim();
    if (!UUID_RE.test(sellerAccountId)) {
      return json({ ok: false, error: "invalid_request" }, 400);
    }
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const account = await resolveSellerAccount(serviceClient, sellerAccountId);

    if (!account) {
      console.log(`${LOG_PREFIX} success`);
      return json({
        ok: true,
        disconnected: true,
        connected: false,
        tokenStatus: "not_connected",
      });
    }

    const now = new Date().toISOString();

    const { error: accountErr } = await serviceClient
      .from("amazon_seller_accounts")
      .update({
        token_status: "revoked",
        is_active: false,
        updated_at: now,
      })
      .eq("id", account.id);

    if (accountErr) {
      console.log(`${LOG_PREFIX} database_error`);
      return json({ ok: false, error: "database_error" }, 500);
    }

    const { error: tokenErr } = await serviceClient
      .from("amazon_auth_tokens")
      .update({
        token_status: "revoked",
        last_error: "admin_disconnected",
        updated_at: now,
      })
      .eq("seller_account_id", account.id);

    if (tokenErr) {
      console.log(`${LOG_PREFIX} database_error`);
      return json({ ok: false, error: "database_error" }, 500);
    }

    console.log(`${LOG_PREFIX} success`);
    return json({
      ok: true,
      disconnected: true,
      connected: false,
      sellerAccountId: account.id,
      sellerId: maskSellerId(account.seller_id),
      tokenStatus: "revoked",
      isActive: false,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "database_error") {
      console.log(`${LOG_PREFIX} database_error`);
      return json({ ok: false, error: "database_error" }, 500);
    }
    console.log(`${LOG_PREFIX} database_error`);
    return json({ ok: false, error: "database_error" }, 500);
  }
});
