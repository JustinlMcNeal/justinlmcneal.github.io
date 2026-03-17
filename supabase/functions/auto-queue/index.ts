// Auto-Queue Generator - Automatically creates scheduled posts from product catalog
// This function picks products that haven't been posted recently and schedules them

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============================================
// ENHANCED CAPTION TEMPLATES (50+)
// ============================================

const CAPTION_TEMPLATES = {
  // CASUAL / FRIENDLY TONE (15 templates)
  casual: [
    "Check out this {category} 🔥 {product_name} - perfect for any occasion!\n\nShop now: {link}",
    "{product_name} just dropped! 💫 Add this {category} to your collection today.\n\n🛒 {link}",
    "Your new favorite {category} is here! ✨ {product_name}\n\nLink in bio or shop direct: {link}",
    "Obsessed with this {product_name}! 😍 A must-have {category} for your wardrobe.\n\n{link}",
    "New in! 🛍️ {product_name} - the {category} you didn't know you needed.\n\nGet yours: {link}",
    "POV: You just found your next favorite {category} 👀 {product_name}\n\n{link}",
    "That feeling when you find the perfect {category}... 💕 Meet {product_name}!\n\n{link}",
    "Adding this {product_name} to cart immediately! 🛒 Anyone else?\n\nShop: {link}",
    "Main character energy with this {category} ✨ {product_name}\n\n{link}",
    "Raise your hand if you need this {product_name} in your life! 🙋‍♀️\n\n{link}",
    "This {category} hits different 🔥 {product_name} is IT!\n\nLink in bio: {link}",
    "Stop scrolling! You need to see this {product_name} 👀✨\n\n{link}",
    "Adding some ✨ to your feed with {product_name}!\n\nShop this {category}: {link}",
    "Ok but how cute is this {category}?! 😍 {product_name}\n\n{link}",
    "Just dropped and already obsessed! {product_name} 💫\n\nGet it: {link}",
  ],

  // URGENCY / SCARCITY TONE (12 templates)
  urgency: [
    "🚨 Don't miss out! {product_name} is selling fast!\n\nGrab yours now: {link}",
    "⚡ Limited stock alert! This {category} won't last long - {product_name}\n\nShop now: {link}",
    "🔥 Hot item! {product_name} - get it before it's gone!\n\n{link}",
    "⏰ Last chance! {product_name} is almost sold out!\n\nOrder now: {link}",
    "🚨 SELLING FAST 🚨 {product_name} - limited quantities!\n\nDon't wait: {link}",
    "⚡ Going, going... almost gone! {product_name}\n\nSecure yours: {link}",
    "Only a few left! 😱 {product_name} - act fast!\n\n{link}",
    "🔥 This {category} is flying off the shelves! {product_name}\n\nHurry: {link}",
    "⏳ Time's running out! Get {product_name} while you can!\n\n{link}",
    "🏃‍♀️ RUN don't walk! {product_name} is almost sold out!\n\n{link}",
    "⚠️ Low stock warning! {product_name} - get it now!\n\n{link}",
    "This won't be restocked! 😬 {product_name}\n\nShop now: {link}",
  ],

  // PROFESSIONAL / ELEGANT TONE (10 templates)
  professional: [
    "Introducing {product_name} - quality {category} for the discerning shopper.\n\nExplore: {link}",
    "Elevate your style with {product_name}. Premium {category} now available.\n\nShop: {link}",
    "{product_name} - where style meets quality. Discover our {category} collection.\n\n{link}",
    "Discover {product_name}. Crafted for those who appreciate fine {category}.\n\n{link}",
    "The {product_name} - a sophisticated addition to any collection.\n\nView: {link}",
    "Quality meets design. Presenting {product_name}.\n\nExplore: {link}",
    "For the modern trendsetter: {product_name}.\n\nShop the collection: {link}",
    "Timeless style, modern appeal. {product_name}.\n\n{link}",
    "Curated for you: {product_name} - premium {category}.\n\nDiscover: {link}",
    "Excellence in every detail. {product_name}.\n\n{link}",
  ],

  // PLAYFUL / FUN TONE (8 templates)
  playful: [
    "Treat yourself! 🎉 {product_name} is calling your name!\n\n{link}",
    "You + {product_name} = a match made in heaven 💕\n\n{link}",
    "Plot twist: You need this {category} 😂 {product_name}\n\n{link}",
    "Tag someone who needs this {product_name}! 👇\n\n{link}",
    "Adding this to my cart faster than... well, everything 😅 {product_name}\n\n{link}",
    "Me: I don't need it.\nAlso me: *adds to cart* 🛒 {product_name}\n\n{link}",
    "Serotonin boost incoming! 🌈 {product_name}\n\nShop: {link}",
    "Current mood: obsessed with this {category} 💅 {product_name}\n\n{link}",
  ],

  // VALUE / DEAL-FOCUSED TONE (8 templates)
  value: [
    "Quality {category} at an unbeatable price! 💰 {product_name}\n\nShop: {link}",
    "Why pay more? Get {product_name} at the best price!\n\n{link}",
    "Budget-friendly AND stylish? Yes please! 🙌 {product_name}\n\n{link}",
    "Great style doesn't have to break the bank 💸 {product_name}\n\n{link}",
    "Affordable luxury is real 💎 {product_name}\n\nShop now: {link}",
    "Your wallet will thank you 😉 {product_name} - amazing value!\n\n{link}",
    "Premium look, smart price 💰 {product_name}\n\n{link}",
    "The best deal you'll find today! {product_name}\n\n{link}",
  ],

  // SEASONAL / TRENDING TONE (8 templates)
  trending: [
    "Trending NOW 📈 {product_name} - everyone's talking about it!\n\n{link}",
    "The {category} everyone is wearing right now! {product_name}\n\n{link}",
    "As seen on your feed: {product_name} 📱\n\nGet the look: {link}",
    "This season's must-have! {product_name} 🌟\n\n{link}",
    "Influencer-approved ✓ {product_name}\n\nShop: {link}",
    "What's trending? {product_name}! Join the hype!\n\n{link}",
    "Everyone needs this {category} this season! {product_name}\n\n{link}",
    "2026's hottest {category} 🔥 {product_name}\n\n{link}",
  ],

  // INSPIRATIONAL / MOTIVATIONAL TONE (6 templates)
  inspirational: [
    "Be bold. Be you. Be wearing {product_name} 💪\n\n{link}",
    "Confidence looks good on you 👑 {product_name}\n\n{link}",
    "Express yourself with {product_name} ✨\n\nYou deserve it: {link}",
    "Dress for the life you want 🌟 {product_name}\n\n{link}",
    "Your style, your rules 💫 {product_name}\n\n{link}",
    "Level up your look with {product_name} 🚀\n\n{link}",
  ],

  // MINIMALIST / CLEAN TONE (5 templates)
  minimalist: [
    "{product_name}.\n\n{link}",
    "Simple. Clean. {product_name}.\n\n{link}",
    "{category}. Perfected.\n\n{product_name} → {link}",
    "Less is more. {product_name}\n\n{link}",
    "Effortless style: {product_name}\n\n{link}",
  ],
};

// Pick a random item from array
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate caption from template — platform-aware
function generateCaption(
  template: string,
  product: { name: string; category_name: string; slug: string },
  platform: string = "instagram"
): string {
  let caption = template
    .replace(/{product_name}/g, product.name)
    .replace(/{category}/g, product.category_name || "item");

  if (platform === "instagram") {
    // Instagram doesn't hyperlink body text — replace {link} lines with CTA
    // Remove entire lines that are just a link or "Shop now: {link}" etc.
    caption = caption
      .replace(/\n*.*\{link\}.*/g, "")
      .trim();
    // Add clean CTA
    caption += "\n\n🔗 Link in bio! Comment KK for a discount! 💕";
  } else {
    // Facebook, Pinterest etc. — keep the actual URL
    caption = caption.replace(
      /{link}/g,
      `https://karrykraze.com/pages/product.html?slug=${product.slug}`
    );
  }

  return caption;
}

// Get next available posting times
function getNextPostingTimes(
  timesPerDay: string[],
  startDate: Date,
  count: number
): Date[] {
  const result: Date[] = [];
  const times = timesPerDay.map(t => {
    const [h, m] = t.split(":").map(Number);
    return { hours: h, minutes: m };
  });
  
  let currentDate = new Date(startDate);
  currentDate.setSeconds(0, 0);
  
  while (result.length < count) {
    for (const time of times) {
      if (result.length >= count) break;
      
      const postTime = new Date(currentDate);
      postTime.setHours(time.hours, time.minutes, 0, 0);
      
      // Only add if in the future
      if (postTime > startDate) {
        result.push(postTime);
      }
    }
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
    currentDate.setHours(0, 0, 0, 0);
  }
  
  return result;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const {
      count = 4,           // How many posts to generate per platform
      platforms = ["instagram"],  // Array of platforms
      preview = false,     // If true, return posts without creating them
    } = body;
    
    // Support legacy single platform param
    const platformList = Array.isArray(platforms) ? platforms : [platforms];

    console.log(`[auto-queue] Generating ${count} posts for ${platformList.join(", ")}, preview=${preview}`);

    // 1. Get auto_queue settings
    const { data: settingsRow } = await supabase
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "auto_queue")
      .single();
    
    const settings = settingsRow?.setting_value || {
      posting_times: ["10:00", "18:00"],
      caption_tones: ["casual", "urgency"],
    };

    // 2. Get products that need posts (ordered by last_social_post_at, nulls first)
    const { data: products, error: prodError } = await supabase
      .from("products")
      .select(`
        id,
        name,
        slug,
        category_id,
        catalog_image_url,
        price,
        last_social_post_at,
        category:categories(id, name)
      `)
      .eq("is_active", true)
      .not("catalog_image_url", "is", null)
      .order("last_social_post_at", { ascending: true, nullsFirst: true })
      .limit(count);

    if (prodError) {
      console.error("[auto-queue] Error fetching products:", prodError);
      throw prodError;
    }

    if (!products?.length) {
      return new Response(JSON.stringify({
        success: true,
        message: "No products available for posting",
        generated: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[auto-queue] Found ${products.length} products to post`);

    // ── IMAGE PIPELINE: Load blacklist + approved AI images + gallery images ──
    const productIds = products.map(p => p.id);

    // Load blacklisted images
    const { data: blacklistRows } = await supabase
      .from("image_blacklist")
      .select("product_id, image_url")
      .in("product_id", productIds);
    
    const blacklistMap: Record<string, Set<string>> = {};
    (blacklistRows || []).forEach(row => {
      if (!blacklistMap[row.product_id]) blacklistMap[row.product_id] = new Set();
      blacklistMap[row.product_id].add(row.image_url);
    });

    // Load approved AI-generated images (prefer most recent)
    const { data: aiImageRows } = await supabase
      .from("social_generated_images")
      .select("id, product_id, public_url, style")
      .in("product_id", productIds)
      .eq("status", "approved")
      .order("created_at", { ascending: false });
    
    const aiImageMap: Record<string, any[]> = {};
    (aiImageRows || []).forEach(row => {
      if (!aiImageMap[row.product_id]) aiImageMap[row.product_id] = [];
      aiImageMap[row.product_id].push(row);
    });

    // Load gallery images as fallback variety
    const { data: galleryRows } = await supabase
      .from("product_gallery_images")
      .select("product_id, url")
      .in("product_id", productIds)
      .order("position", { ascending: true });
    
    const galleryMap: Record<string, string[]> = {};
    (galleryRows || []).forEach(row => {
      if (!galleryMap[row.product_id]) galleryMap[row.product_id] = [];
      galleryMap[row.product_id].push(row.url);
    });

    // Load image pipeline settings
    const { data: pipelineRow } = await supabase
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "image_pipeline")
      .single();
    
    const pipelineSettings = pipelineRow?.setting_value || {
      enabled: false, auto_generate: false, require_review: true, fallback_to_catalog: true
    };

    console.log(`[auto-queue] Image pipeline enabled=${pipelineSettings.enabled}, blacklisted=${blacklistRows?.length || 0} images, AI approved=${aiImageRows?.length || 0} images`);

    // ── Helper: decide if this product should get a carousel post ──
    // Carousel if product has 3+ approved AI images and platform supports it
    function shouldUseCarousel(productId: string, platform: string): {
      isCarousel: boolean;
      carouselUrls: string[];
    } {
      if (platform !== "instagram") return { isCarousel: false, carouselUrls: [] };
      const aiImages = aiImageMap[productId];
      if (!aiImages || aiImages.length < 3) return { isCarousel: false, carouselUrls: [] };
      // 50% chance of carousel when enough images available (variety of post types)
      if (Math.random() > 0.5) return { isCarousel: false, carouselUrls: [] };
      // Pick 3-5 images for the carousel
      const shuffled = [...aiImages].sort(() => Math.random() - 0.5);
      const carouselCount = Math.min(shuffled.length, Math.floor(Math.random() * 3) + 3); // 3-5
      return {
        isCarousel: true,
        carouselUrls: shuffled.slice(0, carouselCount).map((img: any) => img.public_url),
      };
    }

    // ── Helper: resolve best image for a product ──
    function resolveImage(productId: string, catalogUrl: string): {
      imageUrl: string;
      imageSource: string;
      generatedImageId: string | null;
      needsGeneration: boolean;
    } {
      const blacklisted = blacklistMap[productId] || new Set();

      // Priority 1: Approved AI-generated image (ALWAYS preferred for social)
      const aiImages = aiImageMap[productId];
      if (aiImages?.length) {
        const pick = aiImages[Math.floor(Math.random() * aiImages.length)];
        return {
          imageUrl: pick.public_url,
          imageSource: "ai_generated",
          generatedImageId: pick.id,
          needsGeneration: false,
        };
      }

      // No approved AI images — trigger generation if pipeline enabled
      // This ensures every product gets lifestyle images instead of raw catalog photos
      if (pipelineSettings.enabled && pipelineSettings.auto_generate) {
        console.log(`[auto-queue] No AI images for product ${productId} — will trigger generation`);
        // Use catalog as temporary fallback while generation runs
        const galleryUrls = (galleryMap[productId] || []).filter(url => !blacklisted.has(url));
        const tempUrl = galleryUrls.length > 0 ? galleryUrls[0] : catalogUrl;
        return {
          imageUrl: tempUrl,
          imageSource: "catalog",
          generatedImageId: null,
          needsGeneration: true,
        };
      }

      // Pipeline disabled — fall through to catalog/gallery
      const galleryUrls = (galleryMap[productId] || []).filter(url => !blacklisted.has(url));
      if (galleryUrls.length) {
        return {
          imageUrl: galleryUrls[Math.floor(Math.random() * galleryUrls.length)],
          imageSource: "gallery",
          generatedImageId: null,
          needsGeneration: false,
        };
      }

      return {
        imageUrl: catalogUrl,
        imageSource: "catalog",
        generatedImageId: null,
        needsGeneration: false,
      };
    }

    // 3. Get hashtags for categories
    const { data: hashtagRows } = await supabase
      .from("social_category_hashtags")
      .select("category_name, hashtags");
    
    const hashtagMap: Record<string, string[]> = {};
    (hashtagRows || []).forEach(row => {
      hashtagMap[row.category_name?.toLowerCase() || ""] = row.hashtags;
    });
    const globalHashtags = hashtagMap["_global"] || ["#karrykraze"];

    // 4. Get posting times
    const postingTimes = getNextPostingTimes(
      settings.posting_times || ["10:00", "18:00"],
      new Date(),
      products.length
    );

    // 5. Generate posts for each product
    const generatedPosts: any[] = [];
    const tones = settings.caption_tones || ["casual", "urgency"];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const categoryName = product.category?.name || "item";
      const tone = pickRandom(tones);
      const template = pickRandom(CAPTION_TEMPLATES[tone] || CAPTION_TEMPLATES.casual);
      
      // Get hashtags for this category
      const categoryHashtags = hashtagMap[categoryName.toLowerCase()] || globalHashtags;
      
      // Ensure #karrykraze is always included
      const hashtags = categoryHashtags.includes("#karrykraze") 
        ? categoryHashtags 
        : ["#karrykraze", ...categoryHashtags];

      // ── Resolve best image via pipeline ──
      const imageResult = resolveImage(product.id, product.catalog_image_url);

      // Create post for EACH selected platform
      for (const plat of platformList) {
        // Platform-specific caption (IG gets no URLs, FB keeps them)
        const caption = generateCaption(template, {
          name: product.name,
          category_name: categoryName,
          slug: product.slug,
        }, plat);

        // Check if this should be a carousel post
        const carouselResult = shouldUseCarousel(product.id, plat);

        generatedPosts.push({
          product_id: product.id,
          product_name: product.name,
          product_slug: product.slug,
          catalog_image_url: product.catalog_image_url,
          resolved_image_url: imageResult.imageUrl,
          image_source: carouselResult.isCarousel ? "ai_carousel" : imageResult.imageSource,
          generated_image_id: imageResult.generatedImageId,
          needs_generation: imageResult.needsGeneration,
          is_carousel: carouselResult.isCarousel,
          carousel_urls: carouselResult.carouselUrls,
          category_name: categoryName,
          platform: plat,
          caption,
          hashtags,
          link_url: `https://karrykraze.com/pages/product.html?slug=${product.slug}`,
          scheduled_for: postingTimes[i].toISOString(),
          tone,
        });
      }
    }

    // If preview mode, return without saving
    if (preview) {
      return new Response(JSON.stringify({
        success: true,
        preview: true,
        posts: generatedPosts,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 6. Create assets and variations for each product
    const createdPosts: any[] = [];
    
    for (const post of generatedPosts) {
      try {
        // Check if asset already exists for this product
        let assetId: string;
        const { data: existingAsset } = await supabase
          .from("social_assets")
          .select("id")
          .eq("product_id", post.product_id)
          .eq("is_active", true)
          .single();

        if (existingAsset) {
          assetId = existingAsset.id;
          console.log(`[auto-queue] Using existing asset for product ${post.product_id}`);
          // Update existing asset with best available image
          await supabase
            .from("social_assets")
            .update({ original_image_path: post.resolved_image_url })
            .eq("id", assetId);
        } else {
          // Create new asset pointing to resolved image (AI-generated, gallery, or catalog)
          const { data: newAsset, error: assetErr } = await supabase
            .from("social_assets")
            .insert({
              product_id: post.product_id,
              original_image_path: post.resolved_image_url, // Use best available image
              original_filename: `${post.product_slug}.jpg`,
              product_url: post.link_url,
              is_active: true,
            })
            .select("id")
            .single();

          if (assetErr) {
            console.error(`[auto-queue] Failed to create asset for ${post.product_name}:`, assetErr);
            continue;
          }
          assetId = newAsset.id;
          console.log(`[auto-queue] Created new asset ${assetId} for product ${post.product_id}`);
        }

        // Check if variation exists for this platform
        let variationId: string;
        const { data: existingVariation } = await supabase
          .from("social_variations")
          .select("id")
          .eq("asset_id", assetId)
          .eq("platform", post.platform)
          .single();

        if (existingVariation) {
          variationId = existingVariation.id;
          // Update existing variation with best available image
          await supabase
            .from("social_variations")
            .update({ image_path: post.resolved_image_url })
            .eq("id", variationId);
        } else {
          // Create variation pointing to resolved image
          const { data: newVariation, error: varErr } = await supabase
            .from("social_variations")
            .insert({
              asset_id: assetId,
              platform: post.platform,
              variant_type: post.platform === "instagram" ? "square_1x1" : post.platform === "facebook" ? "landscape_16x9" : "vertical_2x3",
              aspect_ratio: post.platform === "instagram" ? "1:1" : post.platform === "facebook" ? "16:9" : "2:3",
              image_path: post.resolved_image_url, // Use best available image
              width: post.platform === "instagram" ? 1080 : post.platform === "facebook" ? 1200 : 1000,
              height: post.platform === "instagram" ? 1080 : post.platform === "facebook" ? 630 : 1500,
            })
            .select("id")
            .single();

          if (varErr) {
            console.error(`[auto-queue] Failed to create variation for ${post.product_name}:`, varErr);
            continue;
          }
          variationId = newVariation.id;
        }

        // ── Trigger AI generation if needed ──
        let finalGeneratedImageId = post.generated_image_id;
        let postStatus = "queued";
        let resolvedImageUrl = post.resolved_image_url;

        if (post.needs_generation && pipelineSettings.enabled && pipelineSettings.auto_generate) {
          console.log(`[auto-queue] Triggering AI image generation for "${post.product_name}"`);
          try {
            const genResp = await fetch(
              `${supabaseUrl}/functions/v1/generate-social-image`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${serviceRoleKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ product_id: post.product_id, count: 1 }),
              }
            );
            const genResult = await genResp.json();
            if (genResult.success && genResult.results?.[0]?.success) {
              const genImg = genResult.results[0];
              finalGeneratedImageId = genImg.generated_image_id;
              // Auto-approve: update variation + asset with the AI image
              postStatus = "queued";
              resolvedImageUrl = genImg.public_url;
              await supabase
                .from("social_variations")
                .update({ image_path: genImg.public_url })
                .eq("id", variationId);
              await supabase
                .from("social_assets")
                .update({ original_image_path: genImg.public_url })
                .eq("id", assetId);
              // Also auto-approve the generated image record
              await supabase
                .from("social_generated_images")
                .update({ status: "approved" })
                .eq("id", genImg.generated_image_id);
              console.log(`[auto-queue] AI image auto-approved for "${post.product_name}": ${genImg.public_url}`);
              // Update image source to reflect AI generation
              post.image_source = "ai_generated";
            } else {
              console.warn(`[auto-queue] AI generation failed for "${post.product_name}": ${genResult.error || 'unknown'}`);
              // Fall through with catalog image as fallback
            }
          } catch (genErr) {
            console.error(`[auto-queue] Generation call failed for "${post.product_name}":`, genErr);
          }
        }

        // Create the post (carousel or single image)
        const postPayload: Record<string, any> = {
          variation_id: variationId,
          platform: post.platform,
          caption: post.caption,
          hashtags: post.hashtags,
          link_url: post.link_url,
          scheduled_for: post.scheduled_for,
          status: postStatus,
          requires_approval: postStatus === "pending_review",
          image_source: post.image_source,
          generated_image_id: finalGeneratedImageId,
          image_url: resolvedImageUrl, // Always set the image URL on the post
        };

        // Add carousel fields if this is a carousel post
        if (post.is_carousel && post.carousel_urls?.length >= 2) {
          postPayload.media_type = "carousel";
          postPayload.image_urls = post.carousel_urls;
          postPayload.image_url = post.carousel_urls[0]; // thumbnail
          console.log(`[auto-queue] Creating carousel post with ${post.carousel_urls.length} images for "${post.product_name}"`);
        }

        const { data: newPost, error: postErr } = await supabase
          .from("social_posts")
          .insert(postPayload)
          .select("id")
          .single();

        if (postErr) {
          console.error(`[auto-queue] Failed to create post for ${post.product_name}:`, postErr);
          continue;
        }

        // Update product's last_social_post_at
        await supabase
          .from("products")
          .update({ last_social_post_at: new Date().toISOString() })
          .eq("id", post.product_id);

        createdPosts.push({
          ...post,
          post_id: newPost.id,
          asset_id: assetId,
          variation_id: variationId,
          image_source: post.image_source,
          status: postStatus,
        });

        console.log(`[auto-queue] Created ${post.platform} post ${newPost.id} for ${post.product_name}`);
      } catch (err) {
        console.error(`[auto-queue] Error processing ${post.product_name}:`, err);
      }
    }

    // Group by platform for summary
    const byPlatform = createdPosts.reduce((acc, p) => {
      acc[p.platform] = (acc[p.platform] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const platformSummary = Object.entries(byPlatform)
      .map(([plat, count]) => `${count} ${plat}`)
      .join(", ");

    return new Response(JSON.stringify({
      success: true,
      message: `Generated ${createdPosts.length} posts (${platformSummary})`,
      generated: createdPosts.length,
      byPlatform,
      posts: createdPosts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[auto-queue] Error:", err);
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
    }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
