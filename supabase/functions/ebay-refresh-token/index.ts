// ebay-refresh-token — Refresh eBay access token (access_token expires every 2h)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get stored refresh token
    const { data: tokenRow, error: fetchErr } = await supabase
      .from("marketplace_tokens")
      .select("*")
      .eq("platform", "ebay")
      .single();

    if (fetchErr || !tokenRow?.refresh_token) {
      return new Response(
        JSON.stringify({ success: false, error: "eBay not connected" }),
        { status: 400, headers: corsHeaders }
      );
    }

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
      "https://api.ebay.com/oauth/api_scope/sell.marketing",
    ].join(" ");

    const tokenResp = await fetch(
      "https://api.ebay.com/identity/v1/oauth2/token",
      {
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
      }
    );

    const tokenData = await tokenResp.json();

    if (!tokenResp.ok || tokenData.error) {
      console.error("[ebay-refresh] Refresh failed:", JSON.stringify(tokenData));
      return new Response(
        JSON.stringify({
          success: false,
          error: tokenData.error_description || "Refresh failed",
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Update access token (refresh token doesn't change on refresh)
    const expiresAt = new Date(
      Date.now() + (tokenData.expires_in || 7200) * 1000
    ).toISOString();

    const { error: updateErr } = await supabase
      .from("marketplace_tokens")
      .update({
        access_token: tokenData.access_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("platform", "ebay");

    if (updateErr) {
      console.error("[ebay-refresh] DB update error:", updateErr.message);
    }

    console.log("[ebay-refresh] Token refreshed, expires at", expiresAt);

    return new Response(
      JSON.stringify({
        success: true,
        access_token: tokenData.access_token,
        expires_at: expiresAt,
      }),
      { headers: corsHeaders }
    );
  } catch (err: unknown) {
    console.error("[ebay-refresh] Error:", err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
