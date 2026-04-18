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

  // ── PHASE 1C: UTM TRACKING ON ALL SOCIAL LINKS ──
  const utmLink = `https://karrykraze.com/pages/product.html?slug=${product.slug}`
    + `&utm_source=${platform}`
    + `&utm_medium=social`
    + `&utm_campaign=autopilot`
    + `&utm_content=${product.slug}`;

  if (platform === "instagram") {
    // Instagram doesn't hyperlink body text — replace {link} lines with CTA
    caption = caption
      .replace(/\n*.*\{link\}.*/g, "")
      .trim();
    // Clean CTA (Comment KK removed — no DM coupon system yet)
    caption += "\n\n🔗 Link in bio!";
  } else {
    // Facebook, Pinterest etc. — keep the actual URL with UTM
    caption = caption.replace(/{link}/g, utmLink);
  }

  return caption;
}

// ── SPRINT 3: CAPTION CONFIDENCE SCORING ──
// Score a caption on length (30%), CTA presence (40%), structure (30%)
// Returns 0-100
function scoreCaptionConfidence(caption: string): number {
  let score = 0;

  // Length check (30%): ideal 80-300 chars for IG
  const len = caption.length;
  if (len >= 80 && len <= 300) score += 30;
  else if (len >= 50 && len <= 400) score += 20;
  else if (len >= 30) score += 10;

  // CTA presence (40%): look for action words
  const ctaPatterns = /shop|buy|get|grab|order|link|comment|tag|check out|tap|click|discover|explore/i;
  if (ctaPatterns.test(caption)) score += 40;
  else score += 5; // minimal credit for having text at all

  // Structure (30%): has emoji, has line breaks, doesn't repeat itself
  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(caption);
  const hasLineBreaks = caption.includes("\n");
  const words = caption.toLowerCase().split(/\s+/);
  const uniqueRatio = new Set(words).size / (words.length || 1);
  
  if (hasEmoji) score += 10;
  if (hasLineBreaks) score += 10;
  if (uniqueRatio > 0.6) score += 10;

  return score;
}

// Get next available posting times — data-driven when possible
function getNextPostingTimes(
  peakHours: number[],
  fallbackTimes: string[],
  startDate: Date,
  count: number,
  useDataDriven: boolean
): Date[] {
  const result: Date[] = [];
  
  let currentDate = new Date(startDate);
  currentDate.setSeconds(0, 0);

  /**
   * Convert an Eastern Time hour on a given date to a UTC Date.
   * Uses Intl to correctly handle EST/EDT transitions.
   */
  function easternHourToUtc(baseDate: Date, estHour: number): Date {
    // Build a date string in Eastern time
    const yyyy = baseDate.getUTCFullYear();
    const mm = String(baseDate.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(baseDate.getUTCDate()).padStart(2, "0");
    const hh = String(estHour).padStart(2, "0");
    // Parse as Eastern time by computing the offset dynamically
    // Create a reference, get its Eastern representation, compute delta
    const ref = new Date(`${yyyy}-${mm}-${dd}T${hh}:00:00`);
    const eastStr = ref.toLocaleString("en-US", { timeZone: "America/New_York" });
    const eastDate = new Date(eastStr);
    const offsetMs = ref.getTime() - eastDate.getTime();
    return new Date(ref.getTime() + offsetMs);
  }
  
  if (useDataDriven) {
    // Peak hours are in Eastern Time (from learning aggregation)
    const sortedHours = [...peakHours].sort((a, b) => a - b);
    while (result.length < count) {
      for (const hour of sortedHours) {
        if (result.length >= count) break;
        const postTime = easternHourToUtc(currentDate, hour);
        if (postTime > startDate) {
          result.push(postTime);
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
    }
  } else {
    // Fallback times are in Eastern Time (from UI settings)
    const times = fallbackTimes.map(t => {
      const [h, m] = t.split(":").map(Number);
      return { hours: h, minutes: m };
    });
    while (result.length < count) {
      for (const time of times) {
        if (result.length >= count) break;
        const postTime = easternHourToUtc(currentDate, time.hours);
        // Add minutes
        postTime.setMinutes(postTime.getMinutes() + (time.minutes || 0));
        if (postTime > startDate) {
          result.push(postTime);
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(0, 0, 0, 0);
    }
  }
  
  return result;
}

// ── PHASE 1A: MERGE HASHTAG HELPER ──
function mergeHashtags(
  branded: string,
  learnedForCat: string[],
  learnedGeneral: string[],
  categoryHashtags: string[],
  max = 5
): string[] {
  const merged: string[] = [branded];

  for (const tag of learnedForCat) {
    if (merged.length >= 3) break;
    if (!merged.includes(tag)) merged.push(tag);
  }

  for (const tag of learnedGeneral) {
    if (merged.length >= 4) break;
    if (!merged.includes(tag)) merged.push(tag);
  }

  for (const tag of categoryHashtags) {
    if (merged.length >= max) break;
    if (!merged.includes(tag)) merged.push(tag);
  }

  return merged;
}

// ============================================
// LEARNING AGGREGATION (runs after post creation)
// Updates hashtag, timing, and caption performance tables
// so autopilot always uses fresh data on the next cycle
// ============================================

/** Convert UTC Date to EST/EDT hour (handles daylight saving) */
function toEasternHour(utcDate: Date): number {
  const eastern = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(utcDate);
  return parseInt(eastern, 10);
}

/** Convert UTC Date to EST/EDT day of week (0=Sun) */
function toEasternDay(utcDate: Date): number {
  const eastern = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(utcDate);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[eastern] ?? utcDate.getDay();
}

async function runLearningAggregation(supabase: any): Promise<void> {
  // Fetch all posted IG posts with engagement data
  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("id, hashtags, likes, comments, saves, reach, engagement_rate, posted_at, caption")
    .eq("status", "posted")
    .eq("platform", "instagram");

  if (error || !posts || posts.length === 0) {
    console.log("[learning] No posted Instagram data to learn from");
    return;
  }

  // ── 1. Hashtag Performance ──
  const hashtagStats: Record<string, any> = {};
  for (const post of posts) {
    for (const tag of (post.hashtags || [])) {
      const t = tag.toLowerCase().replace("#", "");
      if (!hashtagStats[t]) {
        hashtagStats[t] = { times_used: 0, total_reach: 0, total_likes: 0, total_comments: 0, total_saves: 0, rates: [], bestId: null, bestRate: 0, worstId: null, worstRate: Infinity };
      }
      const s = hashtagStats[t];
      s.times_used++;
      s.total_reach += post.reach || 0;
      s.total_likes += post.likes || 0;
      s.total_comments += post.comments || 0;
      s.total_saves += post.saves || 0;
      s.rates.push(post.engagement_rate || 0);
      if ((post.engagement_rate || 0) > s.bestRate) { s.bestId = post.id; s.bestRate = post.engagement_rate || 0; }
      if ((post.engagement_rate || 0) < s.worstRate) { s.worstId = post.id; s.worstRate = post.engagement_rate || 0; }
    }
  }
  for (const [tag, s] of Object.entries(hashtagStats) as [string, any][]) {
    const avg = s.rates.length > 0 ? s.rates.reduce((a: number, b: number) => a + b, 0) / s.rates.length : 0;
    await supabase.from("hashtag_performance").upsert({
      hashtag: tag, times_used: s.times_used, total_reach: s.total_reach,
      total_likes: s.total_likes, total_comments: s.total_comments, total_saves: s.total_saves,
      avg_engagement_rate: parseFloat(avg.toFixed(2)),
      best_performing_post_id: s.bestId, worst_performing_post_id: s.worstRate < Infinity ? s.worstId : null,
      category: tag === "karrykraze" ? "branded" : "general",
      is_recommended: avg >= 2.0 && s.times_used >= 3,
      updated_at: new Date().toISOString(),
    }, { onConflict: "hashtag" });
  }
  console.log(`[learning] Updated ${Object.keys(hashtagStats).length} hashtags`);

  // ── 2. Timing Performance (Eastern Time) ──
  const timeStats: Record<string, any> = {};
  for (const post of posts) {
    if (!post.posted_at) continue;
    const d = new Date(post.posted_at);
    const hour = toEasternHour(d);
    const day = toEasternDay(d);
    const key = `${hour}-${day}`;
    if (!timeStats[key]) {
      timeStats[key] = { hour_of_day: hour, day_of_week: day, total_posts: 0, total_reach: 0, total_engagement: 0, rates: [] };
    }
    const s = timeStats[key];
    s.total_posts++;
    s.total_reach += post.reach || 0;
    s.total_engagement += (post.likes || 0) + (post.comments || 0) + (post.saves || 0);
    s.rates.push(post.engagement_rate || 0);
  }
  const allAvgs = Object.values(timeStats).map((s: any) => s.rates.length > 0 ? s.rates.reduce((a: number, b: number) => a + b, 0) / s.rates.length : 0);
  const overallAvg = allAvgs.length > 0 ? allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length : 0;
  for (const s of Object.values(timeStats) as any[]) {
    const avg = s.rates.length > 0 ? s.rates.reduce((a: number, b: number) => a + b, 0) / s.rates.length : 0;
    await supabase.from("posting_time_performance").upsert({
      hour_of_day: s.hour_of_day, day_of_week: s.day_of_week,
      total_posts: s.total_posts, total_reach: s.total_reach, total_engagement: s.total_engagement,
      avg_engagement_rate: parseFloat(avg.toFixed(2)),
      is_peak_time: avg > overallAvg * 1.2,
    }, { onConflict: "hour_of_day,day_of_week" });
  }
  console.log(`[learning] Updated ${Object.keys(timeStats).length} time slots`);

  // ── 3. Caption Element Performance ──
  const captionElements: Record<string, { type: string; value: string; count: number; rates: number[] }> = {};
  for (const post of posts) {
    if (!post.caption || !post.engagement_rate) continue;
    const rate = post.engagement_rate;
    const len = post.caption.length;
    const lengthRange = len > 300 ? "long" : len > 125 ? "medium" : "short";
    const hasCta = /shop now|link in bio|tap|click|get yours|buy now|order now|limited/i.test(post.caption);
    const hasQuestion = /\?/.test(post.caption);
    const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(post.caption);

    const elements = [
      { type: "length_range", value: lengthRange, match: true },
      { type: "cta", value: "has_cta", match: hasCta },
      { type: "question", value: "has_question", match: hasQuestion },
      { type: "emoji", value: "has_emoji", match: hasEmoji },
    ];
    for (const el of elements) {
      if (!el.match) continue;
      const key = `${el.type}:${el.value}`;
      if (!captionElements[key]) captionElements[key] = { type: el.type, value: el.value, count: 0, rates: [] };
      captionElements[key].count++;
      captionElements[key].rates.push(rate);
    }
  }
  for (const el of Object.values(captionElements)) {
    const avg = el.rates.reduce((a, b) => a + b, 0) / el.rates.length;
    await supabase.from("caption_element_performance").upsert({
      element_type: el.type, element_value: el.value,
      times_used: el.count, avg_engagement_rate: parseFloat(avg.toFixed(2)),
      is_recommended: avg >= 2.0 && el.count >= 3,
    }, { onConflict: "element_type,element_value" });
  }
  console.log(`[learning] Updated ${Object.keys(captionElements).length} caption elements`);
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
      learning_only = false, // If true, just run learning aggregation and return
    } = body;

    // ── PHASE 1B: LEARNING-ONLY MODE (called by instagram-insights) ──
    if (learning_only) {
      await runLearningAggregation(supabase);
      return new Response(
        JSON.stringify({ success: true, message: "Learning aggregation complete" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Support legacy single platform param
    const platformList = Array.isArray(platforms) ? platforms : [platforms];

    console.log(`[auto-queue] Generating ${count} posts for ${platformList.join(", ")}, preview=${preview}`);

    // 2. Get auto_queue settings
    const { data: settingsRow } = await supabase
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "auto_queue")
      .single();
    
    const settings = settingsRow?.setting_value || {
      posting_times: ["10:00", "18:00"],
      caption_tones: ["casual", "urgency"],
    };

    // ── SPRINT 3: DATA-DRIVEN POSTING TIMES ──
    const { data: timeData } = await supabase
      .from("posting_time_performance")
      .select("hour_of_day, day_of_week, avg_engagement_rate, total_posts")
      .gt("total_posts", 0)
      .order("avg_engagement_rate", { ascending: false });

    const totalTimeSamples = (timeData || []).reduce((sum: number, r: any) => sum + (r.total_posts || 0), 0);
    const useDataDrivenTimes = totalTimeSamples >= 10;
    const peakHours = useDataDrivenTimes
      ? [...new Set((timeData || []).slice(0, 6).map((r: any) => r.hour_of_day as number))]
      : [10, 14, 18]; // Default peak hours in Eastern Time

    // ── PHASE 1A: LEARNED TIMING FALLBACK FOR SPARSE DATA ──
    let peakHoursFinal = peakHours;
    if (!useDataDrivenTimes) {
      const { data: timingPatterns } = await supabase
        .from("post_learning_patterns")
        .select("pattern_key, pattern_value")
        .eq("pattern_type", "timing")
        .in("pattern_key", ["best_general_time", "best_day"]);

      const bestHourPattern = (timingPatterns || []).find(
        (p: any) => p.pattern_key === "best_general_time"
      );
      if (bestHourPattern?.pattern_value?.hour !== undefined) {
        const bestHour = bestHourPattern.pattern_value.hour;
        peakHoursFinal = [bestHour, bestHour + 5 > 23 ? bestHour - 5 : bestHour + 5];
        console.log(`[auto-queue] Using learned timing priors: ${peakHoursFinal.join(",")} ET`);
      }
    }

    console.log(`[auto-queue] Posting times: ${useDataDrivenTimes ? "data-driven" : "default"} (${totalTimeSamples} samples), peak hours (ET): ${peakHoursFinal.join(",")}`);

    // ── SPRINT 3: PRODUCT PRIORITY SCORING + COOLDOWN ──
    // Fetch ALL active products
    const { data: allProducts, error: prodError } = await supabase
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
      .not("catalog_image_url", "is", null);

    if (prodError) {
      console.error("[auto-queue] Error fetching products:", prodError);
      throw prodError;
    }

    if (!allProducts?.length) {
      return new Response(JSON.stringify({
        success: true,
        message: "No products available for posting",
        generated: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3-day cooldown: exclude recently posted products
    const cooldownMs = 3 * 24 * 60 * 60 * 1000;
    const cooldownCutoff = new Date(Date.now() - cooldownMs).toISOString();
    const cooledProducts = allProducts.filter((p: any) =>
      !p.last_social_post_at || p.last_social_post_at < cooldownCutoff
    );

    console.log(`[auto-queue] Products: ${allProducts.length} total, ${allProducts.length - cooledProducts.length} on cooldown, ${cooledProducts.length} eligible`);

    if (!cooledProducts.length) {
      return new Response(JSON.stringify({
        success: true,
        message: "All products are on cooldown (posted within 3 days)",
        generated: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load category engagement data for scoring
    const { data: categoryPerf } = await supabase
      .from("post_learning_patterns")
      .select("pattern_key, pattern_value, sample_size")
      .eq("pattern_type", "category_performance");

    const categoryEngMap: Record<string, number> = {};
    let maxCatEng = 0;
    (categoryPerf || []).forEach((row: any) => {
      if (row.sample_size >= 3 && row.pattern_value?.avg_engagement_rate) {
        const rate = Number(row.pattern_value.avg_engagement_rate) || 0;
        categoryEngMap[row.pattern_key] = rate;
        if (rate > maxCatEng) maxCatEng = rate;
      }
    });

    // Load ready pool assets per product for image freshness scoring
    const allProductIds = cooledProducts.map((p: any) => p.id);

    const { data: allPoolAssets } = await supabase
      .from("social_assets")
      .select("id, product_id, used_count")
      .eq("is_active", true)
      .not("product_id", "is", null)
      .not("shot_type", "is", null)
      .in("product_id", allProductIds);

    const freshImageCount: Record<string, number> = {};
    (allPoolAssets || []).forEach((a: any) => {
      if ((a.used_count || 0) === 0) {
        freshImageCount[a.product_id] = (freshImageCount[a.product_id] || 0) + 1;
      }
    });

    // ── Compute priority score for each product ──
    // Recency 40% + Category performance 30% + Fresh images 20% + Reserved 10%
    const now = Date.now();
    const scoredProducts = cooledProducts.map((p: any) => {
      // Recency score (40%): how long since last post — longer = higher
      let recencyScore = 40; // max if never posted
      if (p.last_social_post_at) {
        const daysSincePost = (now - new Date(p.last_social_post_at).getTime()) / (1000 * 60 * 60 * 24);
        recencyScore = Math.min(40, (daysSincePost / 30) * 40); // 30+ days = full 40
      }

      // Category performance score (30%): how well this category performs
      const catName = p.category?.name || "";
      const catEng = categoryEngMap[catName] || 0;
      const categoryScore = maxCatEng > 0 ? (catEng / maxCatEng) * 30 : 15; // default to mid if no data

      // Fresh images score (20%): unused pool images available
      const freshCount = freshImageCount[p.id] || 0;
      const imageScore = Math.min(20, freshCount * 5); // each fresh image = 5 pts, cap at 20

      // Reserved (10%): flat bonus — future use for manual boost / seasonal priority
      const reservedScore = 10;

      const totalScore = recencyScore + categoryScore + imageScore + reservedScore;

      return { ...p, _priority: totalScore, _recency: recencyScore, _catPerf: categoryScore, _imgFresh: imageScore };
    });

    // Sort by priority descending, take top `count`
    scoredProducts.sort((a: any, b: any) => b._priority - a._priority);
    const products = scoredProducts.slice(0, count);

    console.log(`[auto-queue] Top ${products.length} products by priority:`);
    products.forEach((p: any) => {
      console.log(`  ${p.name}: score=${p._priority.toFixed(1)} (recency=${p._recency.toFixed(1)} cat=${p._catPerf.toFixed(1)} img=${p._imgFresh.toFixed(1)})`);
    });

    // ── IMAGE POOL: Load ready assets (must have product_id AND shot_type) ──
    const productIds = products.map((p: any) => p.id);

    // Only "ready" assets qualify for autopilot — both product_id and shot_type required
    const { data: poolAssets } = await supabase
      .from("social_assets")
      .select("id, product_id, original_image_path, shot_type, used_count, last_used_at, quality_score")
      .eq("is_active", true)
      .not("product_id", "is", null)
      .not("shot_type", "is", null)
      .in("product_id", productIds)
      .order("used_count", { ascending: true })
      .order("last_used_at", { ascending: true, nullsFirst: true });

    const poolMap: Record<string, any[]> = {};
    (poolAssets || []).forEach((row: any) => {
      if (!poolMap[row.product_id]) poolMap[row.product_id] = [];
      poolMap[row.product_id].push(row);
    });

    // Count total ready assets across all products
    const totalTaggedAssets = (poolAssets || []).length;
    console.log(`[auto-queue] Image Pool: ${totalTaggedAssets} ready assets (product+shot_type) across ${Object.keys(poolMap).length} products`);

    // ── IMAGE PIPELINE: Load blacklist + approved AI images + gallery images ──

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
      poolAssetId: string | null;
    } {
      const blacklisted = blacklistMap[productId] || new Set();

      // Priority 0 (Sprint 2): Image Pool — tagged assets, unused-first
      const poolImages = poolMap[productId];
      if (poolImages?.length) {
        // Already sorted by used_count ASC, last_used_at ASC NULLS FIRST
        const pick = poolImages[0];
        return {
          imageUrl: pick.original_image_path,
          imageSource: "image_pool",
          generatedImageId: null,
          needsGeneration: false,
          poolAssetId: pick.id,
        };
      }

      // Priority 1: Approved AI-generated image (ALWAYS preferred for social)
      const aiImages = aiImageMap[productId];
      if (aiImages?.length) {
        const pick = aiImages[Math.floor(Math.random() * aiImages.length)];
        return {
          imageUrl: pick.public_url,
          imageSource: "ai_generated",
          generatedImageId: pick.id,
          needsGeneration: false,
          poolAssetId: null,
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
          poolAssetId: null,
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
          poolAssetId: null,
        };
      }

      return {
        imageUrl: catalogUrl,
        imageSource: "catalog",
        generatedImageId: null,
        needsGeneration: false,
        poolAssetId: null,
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

    // ── PHASE 1A: SMART HASHTAG INJECTION ──
    // Query learned top-performing hashtags (explicit thresholds, not boolean flag)
    const { data: topHashtags } = await supabase
      .from("hashtag_performance")
      .select("hashtag, avg_engagement_rate, times_used, category")
      .gte("times_used", 2)
      .gte("avg_engagement_rate", 2)
      .order("avg_engagement_rate", { ascending: false })
      .limit(15);

    const topHashtagsByCategory: Record<string, string[]> = {};
    const topHashtagsGeneral: string[] = [];
    (topHashtags || []).forEach((h: any) => {
      const raw = String(h.hashtag || "").trim().toLowerCase();
      if (!raw) return;
      const tag = raw.startsWith("#") ? raw : `#${raw}`;
      if (h.category && h.category !== "branded" && h.category !== "general") {
        const catKey = String(h.category).trim().toLowerCase();
        if (!topHashtagsByCategory[catKey]) topHashtagsByCategory[catKey] = [];
        topHashtagsByCategory[catKey].push(tag);
      } else {
        topHashtagsGeneral.push(tag);
      }
    });
    console.log(`[auto-queue] Learned hashtags: ${(topHashtags || []).length} qualifying (times_used>=2, avg_eng>=2)`);

    // 4. Get posting times (Sprint 3: data-driven when enough data)
    const postingTimes = getNextPostingTimes(
      peakHoursFinal,
      settings.posting_times || ["10:00", "18:00"],
      new Date(),
      products.length,
      useDataDrivenTimes
    );

    // 5. Generate posts for each product
    const generatedPosts: any[] = [];
    const tones = settings.caption_tones || ["casual", "urgency"];
    const recentShotTypes: string[] = []; // Track for diversity guard

    // ── SPRINT 3: Load last 2 queued posts' shot_types for diversity guard ──
    const { data: recentQueuedPosts } = await supabase
      .from("social_posts")
      .select("source_asset_id")
      .in("status", ["queued", "posted"])
      .order("scheduled_for", { ascending: false })
      .limit(2);

    if (recentQueuedPosts?.length) {
      const recentAssetIds = recentQueuedPosts
        .map((p: any) => p.source_asset_id)
        .filter(Boolean);
      if (recentAssetIds.length) {
        const { data: recentAssets } = await supabase
          .from("social_assets")
          .select("shot_type")
          .in("id", recentAssetIds);
        (recentAssets || []).forEach((a: any) => {
          if (a.shot_type) recentShotTypes.push(a.shot_type);
        });
      }
    }

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const categoryName = product.category?.name || "item";
      const categoryKey = String(categoryName || "").trim().toLowerCase();
      
      // ── PHASE 1A: SMART HASHTAG MERGE ──
      const categoryHashtags = hashtagMap[categoryKey] || globalHashtags;
      const learnedForCat = topHashtagsByCategory[categoryKey] || [];
      const learnedGeneral = topHashtagsGeneral.filter(t => !categoryHashtags.includes(t));
      const hashtags = mergeHashtags("#karrykraze", learnedForCat, learnedGeneral, categoryHashtags);

      console.log("[auto-queue] hashtag selection", {
        product: product.name,
        category: categoryKey,
        learnedForCat,
        learnedGeneral: learnedGeneral.slice(0, 3),
        categoryHashtags,
        final: hashtags,
      });

      // ── PHASE 1B: AI CAPTION WITH TEMPLATE FALLBACK ──
      let bestCaption = "";
      let bestScore = 0;
      let bestTone = pickRandom(tones);
      let captionSource = "template";

      // Step 1: Try AI caption
      try {
        const aiUrl = `${supabaseUrl}/functions/v1/ai-generate`;
        const aiResp = await fetch(aiUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceRoleKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "caption",
            product: {
              name: product.name,
              category: categoryName,
              price: product.price,
            },
            tone: bestTone,
            platform: platformList[0],
          }),
        });
        if (aiResp.ok) {
          const aiResult = await aiResp.json();
          if (aiResult.caption && aiResult.caption.length > 30) {
            bestCaption = aiResult.caption;
            bestScore = scoreCaptionConfidence(bestCaption);
            captionSource = "ai_generated";
            console.log(`[auto-queue] AI caption for "${product.name}": len=${bestCaption.length} score=${bestScore}`);
          }
        }
      } catch (aiErr: unknown) {
        console.log(`[auto-queue] AI caption failed for "${product.name}": ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`);
      }

      // Step 2: Template fallback if AI failed or produced weak caption
      if (!bestCaption || bestScore < 50) {
        captionSource = "template";
        bestScore = 0;
        const MAX_CAPTION_ATTEMPTS = 3;

        for (let attempt = 0; attempt < MAX_CAPTION_ATTEMPTS; attempt++) {
          const tone = pickRandom(tones);
          const template = pickRandom(CAPTION_TEMPLATES[tone] || CAPTION_TEMPLATES.casual);
          const candidate = generateCaption(template, {
            name: product.name,
            category_name: categoryName,
            slug: product.slug,
          }, platformList[0]);

          const score = scoreCaptionConfidence(candidate);
          if (score > bestScore) {
            bestScore = score;
            bestCaption = candidate;
            bestTone = tone;
          }
          if (score >= 70) break;
        }
      }

      const captionStatus = bestScore >= 70 ? "accepted" : bestScore >= 50 ? "flagged" : "fallback";
      if (captionStatus === "fallback") {
        // Use a safe minimalist template
        bestCaption = generateCaption(
          pickRandom(CAPTION_TEMPLATES.minimalist),
          { name: product.name, category_name: categoryName, slug: product.slug },
          platformList[0]
        );
        bestTone = "minimalist";
        captionSource = "template";
      }

      console.log(`[auto-queue] Caption for "${product.name}": source=${captionSource} score=${bestScore} status=${captionStatus} tone=${bestTone}`);

      // ── Resolve best image via pipeline ──
      const imageResult = resolveImage(product.id, product.catalog_image_url);

      // ── SPRINT 3: CONTENT DIVERSITY GUARD ──
      // If we're using a pool asset, check shot_type against last 2
      if (imageResult.poolAssetId && poolMap[product.id]?.length > 1) {
        const chosenAsset = poolMap[product.id].find((a: any) => a.id === imageResult.poolAssetId);
        if (chosenAsset?.shot_type && recentShotTypes.length >= 2) {
          const allSame = recentShotTypes.every((st: string) => st === chosenAsset.shot_type);
          if (allSame) {
            // Try to find a different shot_type
            const alternative = poolMap[product.id].find(
              (a: any) => a.id !== imageResult.poolAssetId && a.shot_type !== chosenAsset.shot_type
            );
            if (alternative) {
              console.log(`[auto-queue] Diversity guard: swapped ${chosenAsset.shot_type} → ${alternative.shot_type} for "${product.name}"`);
              imageResult.imageUrl = alternative.original_image_path;
              imageResult.poolAssetId = alternative.id;
            }
          }
        }
        // Track this shot_type for next iteration
        if (chosenAsset?.shot_type) {
          recentShotTypes.push(chosenAsset.shot_type);
          if (recentShotTypes.length > 2) recentShotTypes.shift();
        }
      }

      // Resolve final shot_type after diversity guard
      const finalAsset = imageResult.poolAssetId
        ? poolMap[product.id]?.find((a: any) => a.id === imageResult.poolAssetId)
        : null;
      const chosenShotType = finalAsset?.shot_type || null;

      // Sprint 2 guardrail: log when no pool images for this product
      if (!poolMap[product.id]?.length) {
        console.log(`[auto-queue] No Image Pool assets for "${product.name}" — using fallback`);
      }

      // Build selection metadata for observability
      const selectionMeta = {
        priority_score: product._priority,
        score_breakdown: {
          recency: product._recency,
          category_perf: product._catPerf,
          image_freshness: product._imgFresh,
          reserved: 10,
        },
        shot_type: chosenShotType,
        is_resurfaced: false,
        caption_source: captionSource,
        caption_confidence: bestScore,
        caption_status: captionStatus,
        caption_tone: bestTone,
      };

      // Create post for EACH selected platform
      for (const plat of platformList) {
        // Re-generate caption for this specific platform if needed (IG vs FB)
        let platformCaption = bestCaption;
        if (plat !== platformList[0]) {
          // Regenerate with platform-specific link handling
          const tone = bestTone;
          const toneTemplates = CAPTION_TEMPLATES[tone] || CAPTION_TEMPLATES.casual;
          const tmpl = pickRandom(toneTemplates);
          platformCaption = generateCaption(tmpl, {
            name: product.name,
            category_name: categoryName,
            slug: product.slug,
          }, plat);
        }

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
          pool_asset_id: imageResult.poolAssetId,
          needs_generation: imageResult.needsGeneration,
          is_carousel: carouselResult.isCarousel,
          carousel_urls: carouselResult.carouselUrls,
          category_name: categoryName,
          platform: plat,
          caption: platformCaption,
          caption_confidence: bestScore,
          caption_status: captionStatus,
          hashtags,
          link_url: `https://karrykraze.com/pages/product.html?slug=${product.slug}&utm_source=${plat}&utm_medium=social&utm_campaign=autopilot&utm_content=${product.slug}`,
          scheduled_for: postingTimes[i].toISOString(),
          tone: bestTone,
          selection_metadata: selectionMeta,
        });
      }
    }

    // ── SPRINT 3: AUTO-RESURFACE OLD HITS ──
    // Every 4th post slot: find old posts (30+ days) with above-median engagement
    if (generatedPosts.length >= 4) {
      // Get median engagement rate
      const { data: engagementData } = await supabase
        .from("social_posts")
        .select("engagement_rate")
        .eq("status", "posted")
        .not("engagement_rate", "is", null)
        .gt("engagement_rate", 0);

      if (engagementData?.length >= 5) {
        const rates = engagementData.map((r: any) => r.engagement_rate).sort((a: number, b: number) => a - b);
        const medianRate = rates[Math.floor(rates.length / 2)];

        // Find old hits: posted 30+ days ago, above-median engagement
        const resurfaceCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: oldHits } = await supabase
          .from("social_posts")
          .select("id, product_id, image_url, platform, engagement_rate, caption, hashtags, link_url")
          .eq("status", "posted")
          .lt("scheduled_for", resurfaceCutoff)
          .gt("engagement_rate", medianRate)
          .order("engagement_rate", { ascending: false })
          .limit(3);

        if (oldHits?.length) {
          // Pick one old hit and make it the 4th slot (replace the last generated post)
          const hit = oldHits[0];
          const resurfaceProduct = allProducts.find((p: any) => p.id === hit.product_id);
          
          if (resurfaceProduct) {
            // Generate a fresh caption for the resurface
            const freshTone = pickRandom(tones);
            const freshTemplate = pickRandom(CAPTION_TEMPLATES[freshTone] || CAPTION_TEMPLATES.casual);
            const freshCaption = generateCaption(freshTemplate, {
              name: resurfaceProduct.name,
              category_name: resurfaceProduct.category?.name || "item",
              slug: resurfaceProduct.slug,
            }, platformList[0]);

            const resurfaceCatKey = String(resurfaceProduct.category?.name || "").trim().toLowerCase();
            const categoryHashtags = hashtagMap[resurfaceCatKey] || globalHashtags;
            const learnedForCat = topHashtagsByCategory[resurfaceCatKey] || [];
            const learnedGeneral = topHashtagsGeneral.filter(t => !categoryHashtags.includes(t));
            const hashtags = mergeHashtags("#karrykraze", learnedForCat, learnedGeneral, categoryHashtags);

            // Replace the last post slot with the resurfaced post
            const lastIdx = generatedPosts.length - 1;
            generatedPosts[lastIdx] = {
              product_id: hit.product_id,
              product_name: resurfaceProduct.name,
              product_slug: resurfaceProduct.slug,
              catalog_image_url: resurfaceProduct.catalog_image_url,
              resolved_image_url: hit.image_url,
              image_source: "resurface",
              generated_image_id: null,
              pool_asset_id: null,
              needs_generation: false,
              is_carousel: false,
              carousel_urls: [],
              category_name: resurfaceProduct.category?.name || "item",
              platform: hit.platform || platformList[0],
              caption: freshCaption,
              caption_confidence: 100,
              caption_status: "accepted",
              hashtags,
              link_url: hit.link_url || `https://karrykraze.com/pages/product.html?slug=${resurfaceProduct.slug}&utm_source=${hit.platform || platformList[0]}&utm_medium=social&utm_campaign=autopilot&utm_content=${resurfaceProduct.slug}`,
              scheduled_for: generatedPosts[lastIdx].scheduled_for,
              tone: freshTone,
              resurfaced_from: hit.id,
              selection_metadata: {
                priority_score: null,
                score_breakdown: null,
                shot_type: null,
                is_resurfaced: true,
                resurfaced_from_post_id: hit.id,
                original_engagement_rate: hit.engagement_rate,
                median_engagement_rate: medianRate,
                caption_attempts: 1,
                caption_confidence: 100,
                caption_status: "accepted",
                caption_tone: freshTone,
              },
            };

            console.log(`[auto-queue] Auto-resurface: "${resurfaceProduct.name}" (original engagement: ${hit.engagement_rate}%, median: ${medianRate}%)`);
          }
        }
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
    const skippedErrors: string[] = [];
    
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
            skippedErrors.push(`asset:${post.product_name}:${assetErr.message}`);
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
            skippedErrors.push(`variation:${post.product_name}:${varErr.message}`);
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
          image_url: resolvedImageUrl,
          source_asset_id: post.pool_asset_id || null,
          selection_metadata: post.selection_metadata || null,
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
          skippedErrors.push(`post:${post.product_name}:${postErr.message}`);
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
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[auto-queue] Error processing ${post.product_name}:`, errMsg);
        skippedErrors.push(`catch:${post.product_name}:${errMsg}`);
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

    // ── LEARNING AGGREGATION ──
    // After queuing posts, run learning so autopilot always uses fresh data
    try {
      console.log("[auto-queue] Running learning aggregation...");
      await runLearningAggregation(supabase);
      console.log("[auto-queue] ✅ Learning aggregation complete");
    } catch (learnErr: unknown) {
      const learnMsg = learnErr instanceof Error ? learnErr.message : String(learnErr);
      console.error("[auto-queue] Learning aggregation failed (non-fatal):", learnMsg);
    }

    // Update autopilot_last_run setting
    await supabase.from("social_settings").upsert({
      setting_key: "autopilot_last_run",
      setting_value: { ran_at: new Date().toISOString(), posts_created: createdPosts.length },
    }, { onConflict: "setting_key" });

    return new Response(JSON.stringify({
      success: true,
      message: `Generated ${createdPosts.length} posts (${platformSummary})`,
      generated: createdPosts.length,
      byPlatform,
      posts: createdPosts,
      skippedErrors: skippedErrors.length ? skippedErrors : undefined,
      generatedCount: generatedPosts.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[auto-queue] Error:", errorMessage);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
});
