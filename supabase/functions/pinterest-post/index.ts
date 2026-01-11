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
    const { postId, imageUrl, title, description, link, boardId } = await req.json();

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Pinterest access token from settings (using correct column names)
    const { data: settings } = await supabase
      .from("social_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["pinterest_access_token", "pinterest_token_expires_at"]);

    const tokenSetting = settings?.find(s => s.setting_key === "pinterest_access_token");
    const expiresSetting = settings?.find(s => s.setting_key === "pinterest_token_expires_at");

    if (!tokenSetting?.setting_value?.token) {
      return new Response(
        JSON.stringify({ success: false, error: "Pinterest not connected. Please connect Pinterest first." }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Check if token is expired
    if (expiresSetting?.setting_value?.expires_at) {
      const expiresAt = new Date(expiresSetting.setting_value.expires_at);
      if (expiresAt < new Date()) {
        // TODO: Implement token refresh
        return new Response(
          JSON.stringify({ success: false, error: "Pinterest token expired. Please reconnect Pinterest." }),
          { headers: corsHeaders, status: 401 }
        );
      }
    }

    const accessToken = tokenSetting.setting_value.token;

    // Create pin on Pinterest
    const pinData: Record<string, unknown> = {
      board_id: boardId,
      media_source: {
        source_type: "image_url",
        url: imageUrl
      }
    };

    if (title) pinData.title = title;
    if (description) pinData.description = description;
    if (link) pinData.link = link;

    // Use sandbox API for Trial access apps
    const pinterestResp = await fetch("https://api-sandbox.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(pinData)
    });

    const pinterestResult = await pinterestResp.json();

    if (!pinterestResp.ok) {
      // Update post status to failed
      if (postId) {
        await supabase
          .from("social_posts")
          .update({ 
            status: "failed", 
            error_message: pinterestResult.message || "Pinterest API error",
            updated_at: new Date().toISOString()
          })
          .eq("id", postId);
      }

      return new Response(
        JSON.stringify({ success: false, error: pinterestResult.message || "Failed to create pin" }),
        { headers: corsHeaders, status: pinterestResp.status }
      );
    }

    // Update post status to posted
    if (postId) {
      await supabase
        .from("social_posts")
        .update({ 
          status: "posted", 
          posted_at: new Date().toISOString(),
          platform_post_id: pinterestResult.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", postId);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        pin: pinterestResult,
        message: "Pin created successfully!"
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error("Pinterest post error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Unknown error" }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
