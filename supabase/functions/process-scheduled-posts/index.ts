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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("[process-scheduled-posts] Starting scheduled post check...");
    
    // Check for reset request
    const body = await req.json().catch(() => ({}));
    if (body.resetPostId) {
      // Reset a failed post for testing
      await supabase
        .from("social_posts")
        .update({ status: "queued", error_message: null, updated_at: new Date().toISOString() })
        .eq("id", body.resetPostId);
      console.log(`[process-scheduled-posts] Reset post ${body.resetPostId} to queued`);
    }

    // Get posts that are due (queued and scheduled_for <= now)
    const now = new Date().toISOString();
    console.log("[process-scheduled-posts] Current time:", now);
    
    // First, let's see ALL posts in the table for debugging
    const { data: allPosts, error: allPostsError } = await supabase
      .from("social_posts")
      .select("id, status, scheduled_for, platform, error_message, variation_id");
    
    console.log("[process-scheduled-posts] All posts in table:", JSON.stringify(allPosts), "Error:", allPostsError?.message);
    
    const { data: duePosts, error: fetchError } = await supabase
      .from("social_posts")
      .select(`
        *,
        variation:social_variations(
          *,
          asset:social_assets(*, product:products(id, name, slug, catalog_image_url))
        )
      `)
      .eq("status", "queued")
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true });

    if (fetchError) {
      console.error("[process-scheduled-posts] Error fetching posts:", fetchError);
      return new Response(
        JSON.stringify({ success: false, error: fetchError.message, allPosts, now }),
        { headers: corsHeaders, status: 500 }
      );
    }

    if (!duePosts || duePosts.length === 0) {
      console.log("[process-scheduled-posts] No posts due for processing");
      
      // Also get variations for debugging
      const { data: variations } = await supabase
        .from("social_variations")
        .select("id, image_path, asset_id");
      
      const { data: assets } = await supabase
        .from("social_assets")
        .select("id, original_image_path");
      
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "No posts due", allPosts, variations, assets, now }),
        { headers: corsHeaders }
      );
    }

    console.log(`[process-scheduled-posts] Found ${duePosts.length} posts to process`);

    const results: { postId: string; platform: string; success: boolean; error?: string }[] = [];

    for (const post of duePosts) {
      let imageUrl: string | null = null;
      let igRawResponse: string = "";
      try {
        console.log(`[process-scheduled-posts] Processing post ${post.id} for ${post.platform}`);
        console.log(`[process-scheduled-posts] Post data: variation_id=${post.variation_id}, variation=`, JSON.stringify(post.variation));

        // Mark as processing to prevent duplicate runs
        await supabase
          .from("social_posts")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", post.id);

        const variation = post.variation;
        const asset = variation?.asset;
        const product = asset?.product;
        
        console.log(`[process-scheduled-posts] Variation: image_path=${variation?.image_path}`);
        console.log(`[process-scheduled-posts] Asset: original_image_path=${asset?.original_image_path}`);
        console.log(`[process-scheduled-posts] Product: catalog_image_url=${product?.catalog_image_url}`);

        // Get image URL - convert storage paths to full public URLs
        // Priority: variation image_path > asset original_image_path > product catalog_image_url
        if (variation?.image_path) {
          // Check if it's already a full URL or a storage path
          if (variation.image_path.startsWith('http://') || variation.image_path.startsWith('https://')) {
            imageUrl = variation.image_path;
          } else {
            // Storage path - convert to public URL
            imageUrl = `${supabaseUrl}/storage/v1/object/public/social-media/${variation.image_path}`;
          }
        } else if (asset?.original_image_path) {
          // Check if it's already a full URL or a storage path
          if (asset.original_image_path.startsWith('http://') || asset.original_image_path.startsWith('https://')) {
            imageUrl = asset.original_image_path;
          } else {
            // Storage path - convert to public URL
            imageUrl = `${supabaseUrl}/storage/v1/object/public/social-media/${asset.original_image_path}`;
          }
        } else if (product?.catalog_image_url) {
          // Already a full URL
          imageUrl = product.catalog_image_url;
        }
        
        console.log(`[process-scheduled-posts] Image URL for post ${post.id}: ${imageUrl}`);
        
        if (!imageUrl) {
          throw new Error("No image URL found for post");
        }

        // Build post data
        const title = post.title || variation?.caption?.substring(0, 100) || product?.name || "";
        const captionText = post.caption || variation?.caption || "";
        
        // Combine caption with hashtags for Instagram
        const hashtags = post.hashtags || [];
        const hashtagString = hashtags.length > 0 ? "\n\n" + hashtags.join(" ") : "";
        const description = captionText + hashtagString;
        
        const link = product?.slug ? `https://karry-kraze.com/pages/product.html?slug=${product.slug}` : "";

        if (post.platform === "pinterest") {
          // Call Pinterest post function
          const pinterestResp = await fetch(`${supabaseUrl}/functions/v1/pinterest-post`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              postId: post.id,
              imageUrl,
              title,
              description,
              link,
              boardId: post.board_id
            })
          });

          const pinterestResult = await pinterestResp.json();

          if (!pinterestResult.success) {
            throw new Error(pinterestResult.error || "Pinterest post failed");
          }

          results.push({ postId: post.id, platform: "pinterest", success: true });

        } else if (post.platform === "instagram") {
          // Check if this is a carousel post
          const isCarousel = post.media_type === "carousel" && Array.isArray(post.image_urls) && post.image_urls.length >= 2;
          
          if (isCarousel) {
            // Call Instagram carousel function
            console.log(`[process-scheduled-posts] Calling instagram-carousel with ${post.image_urls.length} images`);
            const igResp = await fetch(`${supabaseUrl}/functions/v1/instagram-carousel`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify({
                postId: post.id,
                imageUrls: post.image_urls,
                caption: description
              })
            });

            console.log(`[process-scheduled-posts] Instagram carousel response status: ${igResp.status}`);
            const igResultText = await igResp.text();
            igRawResponse = igResultText;
            console.log(`[process-scheduled-posts] Instagram carousel raw response: ${igResultText}`);
            
            let igResult;
            try {
              igResult = JSON.parse(igResultText);
            } catch (parseErr) {
              throw new Error(`Failed to parse Instagram carousel response: ${igResultText}`);
            }
            
            console.log(`[process-scheduled-posts] Instagram carousel result:`, JSON.stringify(igResult));

            if (!igResult.success) {
              throw new Error(igResult.error || "Instagram carousel post failed");
            }

            results.push({ postId: post.id, platform: "instagram", success: true, type: "carousel" });
            
          } else {
            // Single image post - Call Instagram post function
            console.log(`[process-scheduled-posts] Calling instagram-post with imageUrl=${imageUrl}`);
            const igResp = await fetch(`${supabaseUrl}/functions/v1/instagram-post`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify({
                postId: post.id,
                imageUrl,
                caption: description
              })
            });

            console.log(`[process-scheduled-posts] Instagram response status: ${igResp.status}`);
            const igResultText = await igResp.text();
            igRawResponse = igResultText;
            console.log(`[process-scheduled-posts] Instagram raw response: ${igResultText}`);
            
            let igResult;
            try {
              igResult = JSON.parse(igResultText);
            } catch (parseErr) {
              throw new Error(`Failed to parse Instagram response: ${igResultText}`);
            }
            
            console.log(`[process-scheduled-posts] Instagram result:`, JSON.stringify(igResult));

            if (!igResult.success) {
              throw new Error(igResult.error || "Instagram post failed");
            }

            results.push({ postId: post.id, platform: "instagram", success: true });
          }

        } else if (post.platform === "facebook") {
          // Call Facebook post function
          console.log(`[process-scheduled-posts] Calling facebook-post with imageUrl=${imageUrl}`);
          const fbResp = await fetch(`${supabaseUrl}/functions/v1/facebook-post`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              postId: post.id,
              imageUrl,
              caption: description,
              linkUrl: link
            })
          });

          console.log(`[process-scheduled-posts] Facebook response status: ${fbResp.status}`);
          const fbResultText = await fbResp.text();
          console.log(`[process-scheduled-posts] Facebook raw response: ${fbResultText}`);
          
          let fbResult;
          try {
            fbResult = JSON.parse(fbResultText);
          } catch (parseErr) {
            throw new Error(`Failed to parse Facebook response: ${fbResultText}`);
          }

          if (!fbResult.success) {
            throw new Error(fbResult.error || "Facebook post failed");
          }

          results.push({ postId: post.id, platform: "facebook", success: true });

        } else {
          throw new Error(`Unknown platform: ${post.platform}`);
        }

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error(`[process-scheduled-posts] Failed to process post ${post.id}:`, errorMessage);

        // Mark as failed
        await supabase
          .from("social_posts")
          .update({ 
            status: "failed", 
            error_message: errorMessage,
            updated_at: new Date().toISOString() 
          })
          .eq("id", post.id);

        results.push({ 
          postId: post.id, 
          platform: post.platform, 
          success: false, 
          error: errorMessage,
          debug: {
            variation_id: post.variation_id,
            variation: post.variation,
            imageUrlUsed: imageUrl,
            postCaption: post.caption,
            variationCaption: post.variation?.caption,
            rawResponse: igRawResponse
          }
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`[process-scheduled-posts] Completed: ${successCount} success, ${failCount} failed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: duePosts.length,
        successCount,
        failCount,
        results 
      }),
      { headers: corsHeaders }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[process-scheduled-posts] Fatal error:", errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
