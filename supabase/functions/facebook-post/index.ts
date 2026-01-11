// Facebook Page Post Function
// Posts images to your Facebook Page using the same token as Instagram
// (Instagram Business accounts are linked to Facebook Pages)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { postId, imageUrl, caption, linkUrl } = await req.json();
    console.log("Facebook post request:", { postId, imageUrl: imageUrl?.substring(0, 50), captionLength: caption?.length });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Facebook Page access token and Page ID from settings
    // We store these when connecting Instagram (they come from the same OAuth flow)
    const { data: settings } = await supabase
      .from("social_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["facebook_page_id", "facebook_page_token", "instagram_access_token"]);

    let pageId = settings?.find(s => s.setting_key === "facebook_page_id")?.setting_value?.page_id;
    let pageToken = settings?.find(s => s.setting_key === "facebook_page_token")?.setting_value?.token;
    
    // Fallback: Use Instagram token (works if user granted page permissions)
    const instagramToken = settings?.find(s => s.setting_key === "instagram_access_token")?.setting_value?.token;

    if (!pageId || !pageToken) {
      // Try to get Facebook Page info using Instagram token
      if (instagramToken) {
        console.log("Attempting to get Facebook Page from Instagram token...");
        
        // Get accounts (Facebook Pages) linked to this token
        const accountsResp = await fetch(
          `https://graph.facebook.com/v18.0/me/accounts?access_token=${instagramToken}`
        );
        const accountsData = await accountsResp.json();
        
        if (accountsData.data && accountsData.data.length > 0) {
          const page = accountsData.data[0]; // Use first page
          pageId = page.id;
          pageToken = page.access_token;
          
          // Save for future use
          await supabase.from("social_settings").upsert([
            { setting_key: "facebook_page_id", setting_value: { page_id: pageId, page_name: page.name } },
            { setting_key: "facebook_page_token", setting_value: { token: pageToken } }
          ], { onConflict: "setting_key" });
          
          console.log("Saved Facebook Page:", page.name);
        }
      }
    }

    if (!pageId || !pageToken) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Facebook Page not connected. Please ensure your Instagram Business account is linked to a Facebook Page." 
        }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Facebook Graph API - Post photo to page
    // This is simpler than Instagram - no container needed
    const postUrl = `https://graph.facebook.com/v18.0/${pageId}/photos`;
    
    const postBody: Record<string, string> = {
      url: imageUrl,
      access_token: pageToken
    };

    // Build caption with optional link
    let fullCaption = caption || "";
    if (linkUrl) {
      fullCaption += `\n\n🛒 Shop now: ${linkUrl}`;
    }
    if (fullCaption) {
      postBody.caption = fullCaption;
    }

    const postResp = await fetch(postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postBody)
    });

    const postResult = await postResp.json();

    if (postResult.error) {
      console.error("Facebook API error:", postResult.error);
      
      // Update post status to failed
      if (postId) {
        await supabase
          .from("social_posts")
          .update({
            status: "failed",
            error_message: postResult.error.message || "Facebook API error",
            updated_at: new Date().toISOString()
          })
          .eq("id", postId);
      }

      return new Response(
        JSON.stringify({ success: false, error: postResult.error.message || "Failed to post to Facebook" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    console.log("Facebook post created:", postResult);

    // Update post status to posted
    if (postId) {
      await supabase
        .from("social_posts")
        .update({
          status: "posted",
          external_id: postResult.post_id || postResult.id,
          posted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", postId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        post_id: postResult.post_id || postResult.id,
        photo_id: postResult.id
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error("Facebook post error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Failed to post to Facebook" }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
