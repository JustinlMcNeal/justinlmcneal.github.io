// refresh-tokens/index.ts
// Automatically refreshes Instagram/Facebook and Pinterest tokens before they expire.
// Designed to run daily via pg_cron.
//
// Instagram/Facebook: Long-lived tokens last 60 days.
//   - A long-lived token can be refreshed for a NEW 60-day token as long as it hasn't expired.
//   - We refresh when within 7 days of expiry.
//
// Pinterest: Access tokens expire (usually 30 days).
//   - Uses refresh_token grant to get a new access token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const results: { platform: string; status: string; detail?: string }[] = [];

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── Helper: get a setting ───
    async function getSetting(key: string) {
      const { data } = await supabase
        .from("social_settings")
        .select("setting_value")
        .eq("setting_key", key)
        .single();
      return data?.setting_value ?? null;
    }

    // ─── Helper: upsert a setting ───
    async function setSetting(key: string, value: unknown) {
      await supabase
        .from("social_settings")
        .upsert(
          { setting_key: key, setting_value: value },
          { onConflict: "setting_key" }
        );
    }

    // ═══════════════════════════════════════════
    // 1. Instagram / Facebook token refresh
    // ═══════════════════════════════════════════
    try {
      const connected = await getSetting("instagram_connected");
      if (connected?.connected) {
        const expiryData = await getSetting("instagram_token_expires_at");
        const tokenData = await getSetting("instagram_access_token");

        if (expiryData?.expires_at && tokenData?.token) {
          const expiresAt = new Date(expiryData.expires_at);
          const now = new Date();
          const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

          console.log(`[refresh-tokens] Instagram token expires in ${daysUntilExpiry.toFixed(1)} days (${expiresAt.toISOString()})`);

          if (daysUntilExpiry <= 7) {
            // Refresh the long-lived token
            // Facebook Graph API: exchange a valid long-lived token for a new one
            const appSecret = Deno.env.get("INSTAGRAM_APP_SECRET") || "";
            const currentToken = tokenData.token;

            const refreshUrl = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${Deno.env.get("INSTAGRAM_APP_ID") || ""}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`;
            
            const resp = await fetch(refreshUrl);
            const data = await resp.json();

            if (data.access_token) {
              const newExpiresIn = data.expires_in || 5184000; // 60 days default
              const newExpiresAt = new Date(Date.now() + newExpiresIn * 1000).toISOString();

              // The new user token — but we need the PAGE token for Instagram API.
              // Exchange the refreshed user token for a new page token.
              const pagesResp = await fetch(
                `https://graph.facebook.com/v18.0/me/accounts?access_token=${data.access_token}`
              );
              const pagesData = await pagesResp.json();

              if (pagesData.data && pagesData.data.length > 0) {
                const page = pagesData.data[0];

                // Update Instagram token (page access token)
                await setSetting("instagram_access_token", { token: page.access_token });
                await setSetting("instagram_token_expires_at", { expires_at: newExpiresAt });

                // Update Facebook page token too
                await setSetting("facebook_page_token", { token: page.access_token });

                // Log the refresh
                await setSetting("instagram_last_token_refresh", {
                  refreshed_at: new Date().toISOString(),
                  new_expires_at: newExpiresAt,
                  days_remaining_before_refresh: daysUntilExpiry.toFixed(1),
                });

                results.push({
                  platform: "instagram/facebook",
                  status: "refreshed",
                  detail: `New expiry: ${newExpiresAt} (was ${daysUntilExpiry.toFixed(1)} days away)`,
                });

                console.log(`[refresh-tokens] ✅ Instagram/Facebook token refreshed. New expiry: ${newExpiresAt}`);
              } else {
                throw new Error("Refreshed user token but could not retrieve page token from /me/accounts");
              }
            } else {
              throw new Error(data.error?.message || "Token refresh returned no access_token");
            }
          } else {
            results.push({
              platform: "instagram/facebook",
              status: "skipped",
              detail: `${daysUntilExpiry.toFixed(1)} days remaining — no refresh needed`,
            });
          }
        } else {
          results.push({
            platform: "instagram/facebook",
            status: "skipped",
            detail: "No token or expiry data found",
          });
        }
      } else {
        results.push({
          platform: "instagram/facebook",
          status: "skipped",
          detail: "Not connected",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[refresh-tokens] Instagram/Facebook refresh error:", msg);
      results.push({ platform: "instagram/facebook", status: "error", detail: msg });
    }

    // ═══════════════════════════════════════════
    // 2. Pinterest token refresh
    // ═══════════════════════════════════════════
    try {
      const connected = await getSetting("pinterest_connected");
      if (connected?.connected) {
        const tokenData = await getSetting("pinterest_access_token");
        const refreshTokenData = await getSetting("pinterest_refresh_token");

        if (refreshTokenData?.token) {
          // Pinterest tokens are shorter-lived — always try to refresh if we have a refresh token
          const appId = Deno.env.get("PINTEREST_APP_ID") || "";
          const appSecret = Deno.env.get("PINTEREST_APP_SECRET") || "";
          const basicAuth = btoa(`${appId}:${appSecret}`);

          // Use production API if available, fall back to sandbox
          const apiBase = "https://api.pinterest.com"; 

          const resp = await fetch(`${apiBase}/v5/oauth/token`, {
            method: "POST",
            headers: {
              "Authorization": `Basic ${basicAuth}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: refreshTokenData.token,
            }),
          });

          const data = await resp.json();

          if (data.access_token) {
            await setSetting("pinterest_access_token", { token: data.access_token });

            // Pinterest may return a new refresh token
            if (data.refresh_token) {
              await setSetting("pinterest_refresh_token", { token: data.refresh_token });
            }

            await setSetting("pinterest_last_token_refresh", {
              refreshed_at: new Date().toISOString(),
            });

            results.push({
              platform: "pinterest",
              status: "refreshed",
              detail: "Token refreshed successfully",
            });

            console.log("[refresh-tokens] ✅ Pinterest token refreshed");
          } else {
            throw new Error(data.message || "Pinterest token refresh failed");
          }
        } else {
          results.push({
            platform: "pinterest",
            status: "skipped",
            detail: "No refresh token available",
          });
        }
      } else {
        results.push({
          platform: "pinterest",
          status: "skipped",
          detail: "Not connected",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[refresh-tokens] Pinterest refresh error:", msg);
      results.push({ platform: "pinterest", status: "error", detail: msg });
    }

    // ─── Log overall run ───
    await setSetting("token_refresh_last_run", {
      ran_at: new Date().toISOString(),
      results,
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: corsHeaders,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[refresh-tokens] Fatal error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
