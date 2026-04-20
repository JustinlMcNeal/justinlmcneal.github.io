// Shared eBay utilities — used by all ebay-* edge functions
// Single source of truth for token management and product matching

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const EBAY_API = "https://api.ebay.com";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json",
};

/** Create a Supabase service-role client */
export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key);
}

// ── Token Management ────────────────────────────────────────

/** Ensure we have a valid eBay access token, refreshing if expired */
export async function getAccessToken(supabase: SupabaseClient): Promise<string> {
  const { data: tokenRow } = await supabase
    .from("marketplace_tokens")
    .select("*")
    .eq("platform", "ebay")
    .single();

  if (!tokenRow?.access_token) throw new Error("eBay not connected");

  const expiresAt = new Date(tokenRow.token_expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  console.log("[ebay-shared] Access token expired, refreshing...");
  const clientId = Deno.env.get("EBAY_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET") || "";
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const scopes = [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.finances",
    "https://api.ebay.com/oauth/api_scope/sell.account",
    "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
    "https://api.ebay.com/oauth/api_scope/commerce.notification.subscription",
  ].join(" ");

  const resp = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenRow.refresh_token,
      scope: scopes,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  }

  const newExpiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString();

  await supabase
    .from("marketplace_tokens")
    .update({
      access_token: data.access_token,
      token_expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("platform", "ebay");

  console.log("[ebay-shared] Token refreshed, new expiry:", newExpiresAt);
  return data.access_token;
}

/** Get an application token (client credentials) for public APIs like Taxonomy */
export async function getAppToken(): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET") || "";
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const resp = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });

  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(`App token failed: ${data.error_description || data.error}`);
  }
  return data.access_token;
}

// ── Product Matching ────────────────────────────────────────

export interface KKProduct {
  code: string;
  name: string;
}

/** Normalize string for fuzzy matching — lowercase, strip punctuation, collapse whitespace */
export function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Crude stemmer: strip common English suffixes */
export function stem(w: string): string {
  return w.replace(/ies$/, "y").replace(/es$/, "").replace(/s$/, "");
}

/**
 * Match an eBay item title to a KK product.
 * Strategy: exact → bracket-strip → substring → token-overlap (≥2 shared roots)
 */
export function matchProduct(ebayTitle: string, products: KKProduct[]): string | null {
  const t = norm(ebayTitle);
  if (!t) return null;

  const tNoBrackets = norm((ebayTitle || "").replace(/\[[^\]]*\]/g, ""));

  // Pass 1 — exact
  for (const p of products) {
    const n = norm(p.name);
    if (n === t || n === tNoBrackets) return p.code;
  }

  // Pass 2 — substring
  for (const p of products) {
    const n = norm(p.name);
    if (t.includes(n) || n.includes(t)) return p.code;
    if (tNoBrackets && (tNoBrackets.includes(n) || n.includes(tNoBrackets))) return p.code;
  }

  // Pass 3 — token overlap with stemming (≥2 shared tokens)
  const tTokens = new Set(t.split(" ").filter(w => w.length > 2).map(stem));
  let bestCode: string | null = null;
  let bestScore = 1;
  for (const p of products) {
    const pTokens = norm(p.name).split(" ").filter(w => w.length > 2).map(stem);
    let score = 0;
    for (const w of pTokens) if (tTokens.has(w)) score++;
    if (score > bestScore) { bestScore = score; bestCode = p.code; }
  }
  return bestCode;
}
