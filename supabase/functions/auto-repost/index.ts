// Auto-Repost - Resurface successful old posts with fresh captions
// Finds posts that performed well and reschedules them with new captions
//
// Logic:
// 1. Find posts that were posted 30+ days ago
// 2. Optionally filter by engagement metrics (if tracked)
// 3. Generate fresh captions using different tones
// 4. Schedule as new posts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Caption templates for reposts (emphasize "back by demand" etc)
const REPOST_TEMPLATES = {
  casual: [
    "Back by popular demand! 🔥 {product_name} is still a fan favorite!\n\n{link}",
    "Y'all loved this one! 💕 {product_name} is back on the feed!\n\n{link}",
    "Still obsessed with this {category}! 😍 {product_name}\n\n{link}",
    "In case you missed it... {product_name} ✨\n\n{link}",
  ],
  urgency: [
    "🚨 Reminder: {product_name} is still available! Don't sleep on it!\n\n{link}",
    "Still haven't grabbed {product_name}? ⏰ Now's your chance!\n\n{link}",
    "⚡ {product_name} - still here, still selling fast!\n\n{link}",
  ],
  trending: [
    "📈 Still trending! {product_name} continues to be a bestseller!\n\n{link}",
    "The hype is real! {product_name} is still going strong 🔥\n\n{link}",
    "Evergreen favorite: {product_name} ✨\n\n{link}",
  ],
  value: [
    "Great value alert! 💰 {product_name} is still at an amazing price!\n\n{link}",
    "Reminder: {product_name} is still budget-friendly AND stylish! 🙌\n\n{link}",
  ],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRepostCaption(
  tone: string,
  productName: string,
  category: string,
  link: string
): string {
  const templates = REPOST_TEMPLATES[tone] || REPOST_TEMPLATES.casual;
  const template = pickRandom(templates);
  
  return template
    .replace(/{product_name}/g, productName)
    .replace(/{category}/g, category)
    .replace(/{link}/g, link);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request
    const body = await req.json().catch(() => ({}));
    const {
      count = 2,                    // Number of posts to repost
      minDaysOld = 30,              // Minimum age of original post
      platforms = ["instagram"],    // Platforms to repost to
      tones = ["casual", "trending"], // Caption tones to use
      preview = false,              // Preview mode
    } = body;

    console.log(`[auto-repost] Finding ${count} posts older than ${minDaysOld} days`);

    // Calculate date threshold
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - minDaysOld);

    // Find old published posts with their product info
    // Join through variations -> assets -> products
    // Note: Using posted_at (or published_at for backwards compat)
    const { data: oldPosts, error: fetchError } = await supabase
      .from("social_posts")
      .select(`
        id,
        platform,
        caption,
        hashtags,
        link_url,
        posted_at,
        variation:social_variations!inner(
          id,
          image_path,
          asset:social_assets!inner(
            id,
            product_id,
            original_image_path,
            product:products(
              id,
              name,
              slug,
              catalog_image_url,
              category:categories(name)
            )
          )
        )
      `)
      .in("status", ["published", "posted"])
      .lt("posted_at", thresholdDate.toISOString())
      .not("variation.asset.product_id", "is", null)
      .order("posted_at", { ascending: true })
      .limit(count * 3); // Get extra to filter

    if (fetchError) {
      throw new Error(`Failed to fetch old posts: ${fetchError.message}`);
    }

    if (!oldPosts?.length) {
      return new Response(JSON.stringify({
        success: true,
        message: "No old posts found to repost",
        generated: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[auto-repost] Found ${oldPosts.length} candidate posts`);

    // Filter to unique products (don't repost same product twice in one batch)
    const seenProducts = new Set<string>();
    const uniquePosts = oldPosts.filter(post => {
      const productId = post.variation?.asset?.product_id;
      if (!productId || seenProducts.has(productId)) return false;
      seenProducts.add(productId);
      return true;
    }).slice(0, count);

    // Generate new posts
    const generatedPosts: any[] = [];
    const now = new Date();
    
    // Calculate posting times (spread throughout the day)
    const postingTimes = ["10:00", "14:00", "18:00"];
    let timeIndex = 0;
    let dayOffset = 1;

    for (const oldPost of uniquePosts) {
      const product = oldPost.variation?.asset?.product;
      if (!product) continue;

      const categoryName = product.category?.name || "item";
      const tone = pickRandom(tones);
      const link = `https://karrykraze.com/pages/product.html?slug=${product.slug}`;
      
      // Generate fresh caption
      const caption = generateRepostCaption(tone, product.name, categoryName, link);
      
      // Get original hashtags or generate new ones
      const hashtags = oldPost.hashtags || ["#karrykraze", "#fashion"];

      // Create for each platform
      for (const platform of platforms) {
        // Calculate schedule time
        const [hours, minutes] = postingTimes[timeIndex % postingTimes.length].split(":").map(Number);
        const scheduleDate = new Date(now);
        scheduleDate.setDate(scheduleDate.getDate() + dayOffset);
        scheduleDate.setHours(hours, minutes, 0, 0);

        generatedPosts.push({
          original_post_id: oldPost.id,
          variation_id: oldPost.variation.id,
          product_id: product.id,
          product_name: product.name,
          product_slug: product.slug,
          category_name: categoryName,
          platform,
          caption,
          hashtags,
          link_url: link,
          scheduled_for: scheduleDate.toISOString(),
          tone,
          is_repost: true,
        });

        timeIndex++;
        if (timeIndex % postingTimes.length === 0) {
          dayOffset++;
        }
      }
    }

    // Preview mode - return without saving
    if (preview) {
      return new Response(JSON.stringify({
        success: true,
        preview: true,
        posts: generatedPosts,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Create the actual posts
    const createdPosts: any[] = [];

    for (const post of generatedPosts) {
      const { data: newPost, error: insertError } = await supabase
        .from("social_posts")
        .insert({
          variation_id: post.variation_id,
          platform: post.platform,
          caption: post.caption,
          hashtags: post.hashtags,
          link_url: post.link_url,
          scheduled_for: post.scheduled_for,
          status: "queued",
          requires_approval: false,
        })
        .select("id")
        .single();

      if (insertError) {
        console.error(`[auto-repost] Failed to create post:`, insertError);
        continue;
      }

      createdPosts.push({
        ...post,
        post_id: newPost.id,
      });

      console.log(`[auto-repost] Created repost ${newPost.id} for ${post.product_name}`);
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Generated ${createdPosts.length} reposts`,
      generated: createdPosts.length,
      posts: createdPosts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[auto-repost] Error:", err);
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
    }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
