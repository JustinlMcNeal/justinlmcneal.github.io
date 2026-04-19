// ebay-oauth-callback — Exchange eBay auth code for access + refresh tokens
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
    const { code } = await req.json();
    if (!code) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing auth code" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const clientId = Deno.env.get("EBAY_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET") || "";
    const redirectUri = Deno.env.get("EBAY_REDIRECT_URI") || "https://karrykraze.com/pages/admin/settings.html";

    // eBay uses Basic Auth: Base64(clientId:clientSecret)
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    // Exchange authorization code for tokens
    const tokenResp = await fetch(
      "https://api.ebay.com/identity/v1/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      }
    );

    const tokenData = await tokenResp.json();

    if (!tokenResp.ok || tokenData.error) {
      console.error("[ebay-oauth] Token exchange failed:", JSON.stringify(tokenData));
      return new Response(
        JSON.stringify({
          success: false,
          error: tokenData.error_description || tokenData.error || "Token exchange failed",
        }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Store tokens in marketplace_tokens table
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, serviceKey);

    const expiresAt = new Date(
      Date.now() + (tokenData.expires_in || 7200) * 1000
    ).toISOString();

    // Calculate refresh token expiry (eBay refresh = 18 months)
    const refreshExpiresAt = new Date(
      Date.now() + (tokenData.refresh_token_expires_in || 47304000) * 1000
    ).toISOString();

    const { error: upsertErr } = await supabase
      .from("marketplace_tokens")
      .upsert(
        {
          platform: "ebay",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: expiresAt,
          scopes: tokenData.token_type || "User Access Token",
          extra: {
            refresh_token_expires_at: refreshExpiresAt,
            connected: true,
            connected_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "platform" }
      );

    if (upsertErr) {
      console.error("[ebay-oauth] DB save error:", upsertErr.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to save tokens" }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.log("[ebay-oauth] eBay connected successfully, tokens saved");

    return new Response(
      JSON.stringify({
        success: true,
        connected: true,
        expires_in: tokenData.expires_in,
      }),
      { headers: corsHeaders }
    );
  } catch (err: unknown) {
    console.error("[ebay-oauth] Error:", err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
