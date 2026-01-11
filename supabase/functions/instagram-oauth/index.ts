import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code } = await req.json();
    
    const appId = Deno.env.get("INSTAGRAM_APP_ID") || "";
    const appSecret = Deno.env.get("INSTAGRAM_APP_SECRET") || "";
    const redirectUri = "https://karrykraze.com/pages/admin/social.html";

    // Step 1: Exchange code for Facebook access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`;
    
    const tokenResp = await fetch(tokenUrl);
    const tokenData = await tokenResp.json();

    if (tokenData.error) {
      console.error("Token exchange error:", tokenData.error);
      return new Response(
        JSON.stringify({ error: tokenData.error.message }),
        { headers: corsHeaders, status: 400 }
      );
    }

    const accessToken = tokenData.access_token;

    // Step 2: Get long-lived token (60 days)
    const longTokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${accessToken}`;
    
    const longTokenResp = await fetch(longTokenUrl);
    const longTokenData = await longTokenResp.json();
    
    const longLivedToken = longTokenData.access_token || accessToken;
    const expiresIn = longTokenData.expires_in || 5184000; // Default 60 days

    // Step 3: Get Facebook Pages the user manages
    const pagesResp = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${longLivedToken}`
    );
    const pagesData = await pagesResp.json();

    console.log("Pages API response:", JSON.stringify(pagesData));

    // If no pages in /me/accounts, try getting pages via permissions debug
    if (!pagesData.data || pagesData.data.length === 0) {
      // Check what permissions we actually have
      const debugResp = await fetch(
        `https://graph.facebook.com/v18.0/me/permissions?access_token=${longLivedToken}`
      );
      const debugData = await debugResp.json();
      console.log("Permissions debug:", JSON.stringify(debugData));

      return new Response(
        JSON.stringify({ 
          error: "No Facebook Pages found. Please make sure your Instagram is linked to a Facebook Page.",
          debug: {
            permissions: debugData.data,
            pagesResponse: pagesData
          }
        }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Step 4: Get Instagram Business Account ID for each page
    let instagramAccountId = null;
    let instagramUsername = null;
    let pageAccessToken = null;
    let pageName = null;

    for (const page of pagesData.data) {
      const igResp = await fetch(
        `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account{id,username}&access_token=${page.access_token}`
      );
      const igData = await igResp.json();

      if (igData.instagram_business_account) {
        instagramAccountId = igData.instagram_business_account.id;
        instagramUsername = igData.instagram_business_account.username;
        pageAccessToken = page.access_token; // Use Page token for Instagram API
        pageName = page.name;
        break;
      }
    }

    if (!instagramAccountId) {
      return new Response(
        JSON.stringify({ error: "No Instagram Business Account found linked to your Facebook Pages." }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Get the Facebook Page info for Facebook posting
    const facebookPage = pagesData.data[0]; // Use first page (same as Instagram's page)
    const facebookPageId = facebookPage.id;
    const facebookPageToken = facebookPage.access_token;
    const facebookPageName = facebookPage.name;

    // Store tokens in Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate expiry
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Store all Instagram and Facebook settings
    const settings = [
      { setting_key: "instagram_access_token", setting_value: { token: pageAccessToken } },
      { setting_key: "instagram_user_id", setting_value: { user_id: instagramAccountId } },
      { setting_key: "instagram_username", setting_value: { username: instagramUsername } },
      { setting_key: "instagram_page_name", setting_value: { page_name: pageName } },
      { setting_key: "instagram_token_expires_at", setting_value: { expires_at: expiresAt } },
      { setting_key: "instagram_connected", setting_value: { connected: true } },
      // Facebook Page info for Facebook posting
      { setting_key: "facebook_page_id", setting_value: { page_id: facebookPageId, page_name: facebookPageName } },
      { setting_key: "facebook_page_token", setting_value: { token: facebookPageToken } },
      { setting_key: "facebook_connected", setting_value: { connected: true } }
    ];

    let saveErrors: unknown[] = [];
    for (const setting of settings) {
      const { error } = await supabase
        .from("social_settings")
        .upsert(setting, { onConflict: "setting_key" });
      if (error) saveErrors.push(error);
    }

    return new Response(
      JSON.stringify({
        success: true,
        instagram_account_id: instagramAccountId,
        username: instagramUsername,
        page_name: pageName,
        expires_in: expiresIn,
        saved: saveErrors.length === 0,
        save_errors: saveErrors.length > 0 ? saveErrors : undefined
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error("Instagram OAuth error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "OAuth failed" }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
