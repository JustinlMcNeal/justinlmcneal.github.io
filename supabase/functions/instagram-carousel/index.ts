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
    const { postId, imageUrls, caption } = await req.json();
    console.log("Instagram carousel request:", { 
      postId, 
      imageCount: imageUrls?.length,
      captionLength: caption?.length 
    });

    // Validate inputs
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length < 2) {
      return new Response(
        JSON.stringify({ success: false, error: "Carousel requires at least 2 images (max 10)" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    if (imageUrls.length > 10) {
      return new Response(
        JSON.stringify({ success: false, error: "Carousel can have maximum 10 images" }),
        { headers: corsHeaders, status: 400 }
      );
    }

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

    // STEP 1: Create individual media containers for each image
    console.log("Creating media containers for carousel items...");
    const containerIds: string[] = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i];
      console.log(`Creating container ${i + 1}/${imageUrls.length}: ${imageUrl.substring(0, 50)}...`);

      const createMediaUrl = `https://graph.facebook.com/v18.0/${userId}/media`;
      
      const createMediaResp = await fetch(createMediaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          is_carousel_item: true,  // Mark as carousel item
          access_token: accessToken
        })
      });

      const mediaResult = await createMediaResp.json();

      if (mediaResult.error) {
        console.error(`Failed to create container for image ${i + 1}:`, mediaResult.error);
        
        // Update post status to failed
        if (postId) {
          await supabase
            .from("social_posts")
            .update({
              status: "failed",
              error_message: `Failed on image ${i + 1}: ${mediaResult.error.message}`,
              updated_at: new Date().toISOString()
            })
            .eq("id", postId);
        }

        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Failed to create container for image ${i + 1}: ${mediaResult.error.message}` 
          }),
          { headers: corsHeaders, status: 400 }
        );
      }

      containerIds.push(mediaResult.id);
      console.log(`Container ${i + 1} created: ${mediaResult.id}`);
    }

    // STEP 2: Wait for all containers to be ready
    console.log("Waiting for all containers to be ready...");
    
    for (let i = 0; i < containerIds.length; i++) {
      const containerId = containerIds[i];
      let containerStatus = "IN_PROGRESS";
      let attempts = 0;
      const maxAttempts = 30;

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
        console.error(`Container ${i + 1} failed to process: ${containerStatus}`);
        
        if (postId) {
          await supabase
            .from("social_posts")
            .update({
              status: "failed",
              error_message: `Image ${i + 1} processing failed: ${containerStatus}`,
              updated_at: new Date().toISOString()
            })
            .eq("id", postId);
        }

        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Image ${i + 1} processing failed: ${containerStatus}` 
          }),
          { headers: corsHeaders, status: 400 }
        );
      }

      console.log(`Container ${i + 1} ready`);
    }

    // STEP 3: Create the carousel container
    console.log("Creating carousel container...");
    
    const carouselResp = await fetch(`https://graph.facebook.com/v18.0/${userId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "CAROUSEL",
        children: containerIds.join(","),
        caption: caption || "",
        access_token: accessToken
      })
    });

    const carouselResult = await carouselResp.json();

    if (carouselResult.error) {
      console.error("Failed to create carousel container:", carouselResult.error);
      
      if (postId) {
        await supabase
          .from("social_posts")
          .update({
            status: "failed",
            error_message: `Carousel creation failed: ${carouselResult.error.message}`,
            updated_at: new Date().toISOString()
          })
          .eq("id", postId);
      }

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Carousel creation failed: ${carouselResult.error.message}` 
        }),
        { headers: corsHeaders, status: 400 }
      );
    }

    const carouselContainerId = carouselResult.id;
    console.log("Carousel container created:", carouselContainerId);

    // STEP 4: Wait for carousel container to be ready
    let carouselStatus = "IN_PROGRESS";
    let carouselAttempts = 0;
    const maxCarouselAttempts = 30;

    while (carouselStatus === "IN_PROGRESS" && carouselAttempts < maxCarouselAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const statusResp = await fetch(
        `https://graph.facebook.com/v18.0/${carouselContainerId}?fields=status_code&access_token=${accessToken}`
      );
      const statusData = await statusResp.json();
      
      carouselStatus = statusData.status_code;
      carouselAttempts++;
    }

    if (carouselStatus !== "FINISHED") {
      console.error("Carousel container failed to process:", carouselStatus);
      
      if (postId) {
        await supabase
          .from("social_posts")
          .update({
            status: "failed",
            error_message: `Carousel processing failed: ${carouselStatus}`,
            updated_at: new Date().toISOString()
          })
          .eq("id", postId);
      }

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Carousel processing failed: ${carouselStatus}` 
        }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // STEP 5: Publish the carousel
    console.log("Publishing carousel...");
    
    const publishParams = new URLSearchParams({
      creation_id: carouselContainerId,
      access_token: accessToken
    });

    const publishResp = await fetch(
      `https://graph.facebook.com/v18.0/${userId}/media_publish?${publishParams.toString()}`,
      { method: "POST" }
    );

    const publishResult = await publishResp.json();

    if (publishResult.error) {
      console.error("Failed to publish carousel:", publishResult.error);
      
      if (postId) {
        await supabase
          .from("social_posts")
          .update({
            status: "failed",
            error_message: `Publish failed: ${publishResult.error.message}`,
            updated_at: new Date().toISOString()
          })
          .eq("id", postId);
      }

      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Publish failed: ${publishResult.error.message}` 
        }),
        { headers: corsHeaders, status: 400 }
      );
    }

    console.log("Carousel published successfully:", publishResult.id);

    // Update post status to posted
    if (postId) {
      await supabase
        .from("social_posts")
        .update({
          status: "posted",
          external_id: publishResult.id,
          posted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", postId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        media_id: publishResult.id,
        carousel_container_id: carouselContainerId,
        item_count: imageUrls.length
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error("Instagram carousel error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Failed to post carousel to Instagram" }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
