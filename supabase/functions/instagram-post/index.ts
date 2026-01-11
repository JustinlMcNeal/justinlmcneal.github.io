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
    const { postId, imageUrl, caption } = await req.json();
    console.log("Instagram post request:", { postId, imageUrl: imageUrl?.substring(0, 50), captionLength: caption?.length });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Instagram access token and user ID from settings
    const { data: settings } = await supabase
      .from("social_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["instagram_access_token", "instagram_user_id", "instagram_token_expires_at"]);

    const tokenSetting = settings?.find(s => s.setting_key === "instagram_access_token");
    const userIdSetting = settings?.find(s => s.setting_key === "instagram_user_id");
    const expiresSetting = settings?.find(s => s.setting_key === "instagram_token_expires_at");

    if (!tokenSetting?.setting_value?.token || !userIdSetting?.setting_value?.user_id) {
      return new Response(
        JSON.stringify({ success: false, error: "Instagram not connected. Please connect Instagram first." }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Check if token is expired
    if (expiresSetting?.setting_value?.expires_at) {
      const expiresAt = new Date(expiresSetting.setting_value.expires_at);
      if (expiresAt < new Date()) {
        return new Response(
          JSON.stringify({ success: false, error: "Instagram token expired. Please reconnect Instagram." }),
          { headers: corsHeaders, status: 401 }
        );
      }
    }

    const accessToken = tokenSetting.setting_value.token;
    const userId = userIdSetting.setting_value.user_id;

    // Instagram Content Publishing API - Step 1: Create media container
    // For Business accounts, use graph.facebook.com
    const createMediaUrl = `https://graph.facebook.com/v18.0/${userId}/media`;
    
    const createMediaResp = await fetch(createMediaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption || "",
        access_token: accessToken
      })
    });

    const mediaResult = await createMediaResp.json();

    if (mediaResult.error) {
      // Update post status to failed
      if (postId) {
        await supabase
          .from("social_posts")
          .update({
            status: "failed",
            error_message: mediaResult.error.message || "Instagram API error",
            updated_at: new Date().toISOString()
          })
          .eq("id", postId);
      }

      return new Response(
        JSON.stringify({ success: false, error: mediaResult.error.message || "Failed to create media container" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    const containerId = mediaResult.id;

    // Step 2: Poll for container status (Instagram processes the image)
    let containerStatus = "IN_PROGRESS";
    let attempts = 0;
    const maxAttempts = 30; // Wait up to ~30 seconds

    while (containerStatus === "IN_PROGRESS" && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const statusResp = await fetch(
        `https://graph.facebook.com/v18.0/${containerId}?fields=status_code&access_token=${accessToken}`
      );
      const statusData = await statusResp.json();
      
      containerStatus = statusData.status_code;
      attempts++;
    }

    if (containerStatus !== "FINISHED") {
      if (postId) {
        await supabase
          .from("social_posts")
          .update({
            status: "failed",
            error_message: `Container processing failed: ${containerStatus}`,
            updated_at: new Date().toISOString()
          })
          .eq("id", postId);
      }

      return new Response(
        JSON.stringify({ success: false, error: `Media processing failed: ${containerStatus}` }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Step 3: Publish the container
    const publishParams = new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken
    });

    const publishResp = await fetch(
      `https://graph.facebook.com/v18.0/${userId}/media_publish?${publishParams.toString()}`,
      { method: "POST" }
    );

    const publishResult = await publishResp.json();

    if (publishResult.error) {
      if (postId) {
        await supabase
          .from("social_posts")
          .update({
            status: "failed",
            error_message: publishResult.error.message || "Failed to publish",
            updated_at: new Date().toISOString()
          })
          .eq("id", postId);
      }

      return new Response(
        JSON.stringify({ success: false, error: publishResult.error.message || "Failed to publish media" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Update post status to posted
    if (postId) {
      console.log("Updating post status for postId:", postId);
      const updateResult = await supabase
        .from("social_posts")
        .update({
          status: "posted",
          external_id: publishResult.id,
          posted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", postId)
        .select();
      console.log("Post status update result:", JSON.stringify({ 
        postId, 
        updatedData: updateResult.data, 
        error: updateResult.error 
      }));
    } else {
      console.log("No postId provided, skipping status update");
    }

    return new Response(
      JSON.stringify({
        success: true,
        media_id: publishResult.id,
        container_id: containerId
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error("Instagram post error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Failed to post to Instagram" }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
