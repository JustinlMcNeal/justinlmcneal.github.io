import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Instagram Insights Edge Function
 * Fetches engagement metrics (likes, comments, shares, saves, impressions, reach)
 * from the Instagram Graph API for posted content.
 * 
 * Can be called manually or via cron job to update engagement stats.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Content-Type": "application/json"
};

interface InsightsMetric {
  name: string;
  period: string;
  values: { value: number }[];
  title: string;
  description: string;
  id: string;
}

interface MediaInsightsResponse {
  data: InsightsMetric[];
  error?: { message: string; code: number };
}

interface MediaBasicResponse {
  like_count?: number;
  comments_count?: number;
  permalink?: string;
  id: string;
  error?: { message: string; code: number };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { postId, syncAll, daysBack = 7 } = body;
    
    console.log("Instagram insights request:", { postId, syncAll, daysBack });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Instagram access token
    const { data: settings } = await supabase
      .from("social_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["instagram_access_token", "instagram_token_expires_at"]);

    const tokenSetting = settings?.find(s => s.setting_key === "instagram_access_token");
    const expiresSetting = settings?.find(s => s.setting_key === "instagram_token_expires_at");

    if (!tokenSetting?.setting_value?.token) {
      return new Response(
        JSON.stringify({ success: false, error: "Instagram not connected" }),
        { headers: corsHeaders, status: 400 }
      );
    }

    // Check if token is expired
    if (expiresSetting?.setting_value?.expires_at) {
      const expiresAt = new Date(expiresSetting.setting_value.expires_at);
      if (expiresAt < new Date()) {
        return new Response(
          JSON.stringify({ success: false, error: "Instagram token expired" }),
          { headers: corsHeaders, status: 401 }
        );
      }
    }

    const accessToken = tokenSetting.setting_value.token;

    // Build query to get posts that need insights updated
    let query = supabase
      .from("social_posts")
      .select("id, external_id, hashtags, posted_at")
      .eq("platform", "instagram")
      .eq("status", "posted")
      .not("external_id", "is", null);

    if (postId) {
      // Fetch specific post
      query = query.eq("id", postId);
    } else if (syncAll) {
      // Fetch all posts from last N days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      query = query.gte("posted_at", cutoffDate.toISOString());
    } else {
      // Default: fetch posts that haven't been updated in 6 hours
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      query = query.or(`engagement_updated_at.is.null,engagement_updated_at.lt.${sixHoursAgo}`);
      
      // Only look at posts from the last 30 days (engagement drops after that)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      query = query.gte("posted_at", thirtyDaysAgo.toISOString());
    }

    const { data: posts, error: postsError } = await query.limit(50);

    if (postsError) {
      console.error("Error fetching posts:", postsError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch posts" }),
        { headers: corsHeaders, status: 500 }
      );
    }

    if (!posts || posts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No posts to update", updated: 0 }),
        { headers: corsHeaders }
      );
    }

    console.log(`Found ${posts.length} posts to update`);

    const results = {
      updated: 0,
      failed: 0,
      deleted: 0,
      errors: [] as string[]
    };

    // Process each post
    for (const post of posts) {
      try {
        const mediaId = post.external_id;
        
        // Fetch basic metrics (likes, comments) AND permalink if we don't have it
        const basicFields = "like_count,comments_count,permalink";
        const basicResp = await fetch(
          `https://graph.facebook.com/v18.0/${mediaId}?fields=${basicFields}&access_token=${accessToken}`
        );
        const basicData: MediaBasicResponse = await basicResp.json();

        if (basicData.error) {
          console.error(`Error fetching basic metrics for ${mediaId}:`, basicData.error);
          
          // Check if the post was deleted on Instagram
          // Error codes: 100 = invalid media ID, 190 = expired token
          // OAuthException with "does not exist" or "been deleted" indicates deleted post
          const errorMsg = basicData.error.message?.toLowerCase() || "";
          const isDeleted = 
            basicData.error.code === 100 ||
            errorMsg.includes("does not exist") ||
            errorMsg.includes("been deleted") ||
            errorMsg.includes("unsupported get request") ||
            errorMsg.includes("nonexisting field");
          
          if (isDeleted) {
            // Mark post as deleted in our database and clear engagement metrics
            console.log(`Post ${post.id} (media ${mediaId}) appears to be deleted on Instagram`);
            const { error: deleteError } = await supabase
              .from("social_posts")
              .update({
                status: "deleted",
                error_message: "Post was deleted on Instagram",
                // Clear all engagement metrics so they don't persist
                likes: 0,
                comments: 0,
                shares: 0,
                saves: 0,
                impressions: 0,
                reach: 0,
                clicks: 0,
                engagement_rate: 0,
                engagement_updated_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq("id", post.id);
            
            if (deleteError) {
              console.error(`Failed to mark post ${post.id} as deleted:`, deleteError);
              results.failed++;
              results.errors.push(`${post.id}: Failed to mark as deleted - ${deleteError.message}`);
            } else {
              console.log(`Successfully marked post ${post.id} as deleted`);
              results.deleted++;
            }
            continue;
          }
          
          results.failed++;
          results.errors.push(`${post.id}: ${basicData.error.message}`);
          continue;
        }

        // Fetch insights metrics (impressions, reach, saved)
        // Note: Insights are only available for Business/Creator accounts
        // Note: Reels use different metrics (plays instead of impressions)
        const insightsMetrics = "impressions,reach,saved";
        const insightsResp = await fetch(
          `https://graph.facebook.com/v18.0/${mediaId}/insights?metric=${insightsMetrics}&access_token=${accessToken}`
        );
        const insightsData: MediaInsightsResponse = await insightsResp.json();
        
        // Log insights errors (but don't fail - some media types don't support all metrics)
        if (insightsData.error) {
          console.warn(`Insights API error for ${mediaId}:`, insightsData.error.message);
          // Try fetching Reels metrics if standard insights fail
          const reelsMetrics = "plays,reach,saved,shares";
          const reelsResp = await fetch(
            `https://graph.facebook.com/v18.0/${mediaId}/insights?metric=${reelsMetrics}&access_token=${accessToken}`
          );
          const reelsData: MediaInsightsResponse = await reelsResp.json();
          if (!reelsData.error && reelsData.data) {
            console.log(`Using Reels metrics for ${mediaId}`);
            insightsData.data = reelsData.data;
          }
        }

        // Parse metrics
        const likes = basicData.like_count || 0;
        const comments = basicData.comments_count || 0;
        
        let impressions = 0;
        let reach = 0;
        let saves = 0;
        let shares = 0;
        let plays = 0;

        if (insightsData.data) {
          for (const metric of insightsData.data) {
            const value = metric.values?.[0]?.value || 0;
            switch (metric.name) {
              case "impressions":
                impressions = value;
                break;
              case "reach":
                reach = value;
                break;
              case "saved":
                saves = value;
                break;
              case "shares":
                shares = value;
                break;
              case "plays":
                // For Reels, "plays" is similar to impressions
                plays = value;
                if (impressions === 0) impressions = value;
                break;
            }
          }
        }
        
        console.log(`Metrics for ${mediaId}: likes=${likes}, comments=${comments}, saves=${saves}, impressions=${impressions}, reach=${reach}, plays=${plays}`);

        // Calculate engagement rate
        // Formula: (likes + comments + saves) / reach * 100
        const engagementRate = reach > 0 
          ? Number((((likes + comments + saves) / reach) * 100).toFixed(2))
          : 0;

        // Build update object - include permalink if we got it
        const updateData: any = {
          likes,
          comments,
          saves,
          shares,
          impressions,
          reach,
          engagement_rate: engagementRate,
          engagement_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        // Backfill permalink if available and not already set
        if (basicData.permalink) {
          updateData.permalink = basicData.permalink;
          updateData.instagram_permalink = basicData.permalink;
        }

        // Update post with engagement metrics
        const { error: updateError } = await supabase
          .from("social_posts")
          .update(updateData)
          .eq("id", post.id);

        if (updateError) {
          console.error(`Error updating post ${post.id}:`, updateError);
          results.failed++;
          results.errors.push(`${post.id}: Update failed`);
          continue;
        }

        // Track hashtag performance
        if (post.hashtags && Array.isArray(post.hashtags) && post.hashtags.length > 0) {
          const hashtagRecords = post.hashtags.map((hashtag: string) => ({
            hashtag: hashtag.toLowerCase().replace(/^#/, ""),
            platform: "instagram",
            post_id: post.id,
            likes,
            comments,
            saves,
            impressions,
            reach,
            effectiveness_score: engagementRate,
            tracked_at: new Date().toISOString()
          }));

          const { error: hashtagError } = await supabase
            .from("social_hashtag_analytics")
            .upsert(hashtagRecords, {
              onConflict: "post_id,hashtag",
              ignoreDuplicates: false
            });

          if (hashtagError) {
            console.warn(`Error tracking hashtags for ${post.id}:`, hashtagError);
            // Don't fail the whole update for hashtag tracking errors
          }
        }

        results.updated++;
        console.log(`Updated post ${post.id}: ${likes} likes, ${comments} comments, ${saves} saves, ${impressions} impressions, ${reach} reach`);

      } catch (err) {
        console.error(`Error processing post ${post.id}:`, err);
        results.failed++;
        results.errors.push(`${post.id}: ${err.message || "Unknown error"}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Updated ${results.updated} posts, ${results.deleted} deleted, ${results.failed} failed`,
        ...results
      }),
      { headers: corsHeaders }
    );

  } catch (error) {
    console.error("Instagram insights error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Failed to fetch insights" }),
      { headers: corsHeaders, status: 500 }
    );
  }
});
