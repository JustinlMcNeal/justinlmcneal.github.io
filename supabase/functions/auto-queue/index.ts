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
    .select("id, hashtags, likes, comments, saves, reach, engagement_rate, posted_at, caption, variation_id")
    .eq("status", "posted")
    .eq("platform", "instagram");

  if (error || !posts || posts.length === 0) {
    console.log("[learning] No posted Instagram data to learn from");
    return;
  }

  // ── Build variation → category map (variation_id → social_variations → social_assets → products → categories) ──
  const variationIds = [...new Set(posts.map((p: any) => p.variation_id).filter(Boolean))];
  const variationCategoryMap: Record<string, string> = {};
  if (variationIds.length > 0) {
    const { data: variants } = await supabase
      .from("social_variations")
      .select("id, asset:social_assets(product:products(category:categories(name)))")
      .in("id", variationIds);
    for (const v of (variants || [])) {
      const catName = v.asset?.product?.category?.name?.toLowerCase();
      if (catName) variationCategoryMap[v.id] = catName;
    }
  }
  console.log(`[learning] Category map: ${Object.keys(variationCategoryMap).length} variations mapped`);

  // ── 1. Hashtag Performance ──
  const hashtagStats: Record<string, any> = {};
  for (const post of posts) {
    const postCategory = post.variation_id ? (variationCategoryMap[post.variation_id] || "general") : "general";
    for (const tag of (post.hashtags || [])) {
      const t = tag.toLowerCase().replace("#", "");
      if (!hashtagStats[t]) {
        hashtagStats[t] = { times_used: 0, total_reach: 0, total_likes: 0, total_comments: 0, total_saves: 0, rates: [], bestId: null, bestRate: 0, worstId: null, worstRate: Infinity, categoryCounts: {} };
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
      // Track category frequency for this hashtag
      s.categoryCounts[postCategory] = (s.categoryCounts[postCategory] || 0) + 1;
    }
  }
  for (const [tag, s] of Object.entries(hashtagStats) as [string, any][]) {
    const avg = s.rates.length > 0 ? s.rates.reduce((a: number, b: number) => a + b, 0) / s.rates.length : 0;
    // Determine dominant category (most frequent, not "general" if possible)
    let dominantCategory = "general";
    if (tag === "karrykraze") {
      dominantCategory = "branded";
    } else {
      const cats = Object.entries(s.categoryCounts) as [string, number][];
      // Prefer non-general categories; pick the one with highest count
      const nonGeneral = cats.filter(([c]) => c !== "general");
      const pool = nonGeneral.length > 0 ? nonGeneral : cats;
      pool.sort((a, b) => b[1] - a[1]);
      if (pool.length > 0) dominantCategory = pool[0][0];
    }
    await supabase.from("hashtag_performance").upsert({
      hashtag: tag, times_used: s.times_used, total_reach: s.total_reach,
      total_likes: s.total_likes, total_comments: s.total_comments, total_saves: s.total_saves,
      avg_engagement_rate: parseFloat(avg.toFixed(2)),
      best_performing_post_id: s.bestId, worst_performing_post_id: s.worstRate < Infinity ? s.worstId : null,
      category: dominantCategory,
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

// ── Run settings: request body overrides social_settings.auto_queue ──
const VALID_PLATFORMS = new Set(["instagram", "facebook", "pinterest"]);
const VALID_TONES = new Set([
  "casual", "urgency", "professional", "playful", "value",
  "trending", "inspirational", "minimalist",
]);

function filterStringArray(val: unknown, allowed?: Set<string>): string[] | null {
  if (!Array.isArray(val)) return null;
  const items = val
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!items.length) return null;
  if (allowed) {
    const filtered = items.filter((x) => allowed.has(x));
    return filtered.length ? filtered : null;
  }
  return items;
}

function parsePostingTimes(val: unknown): string[] | null {
  const arr = filterStringArray(val);
  if (!arr) return null;
  const timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const valid = arr.filter((t) => timeRe.test(t));
  return valid.length ? valid : null;
}

function parseCount(val: unknown): number | null {
  const n = typeof val === "number" ? val : parseInt(String(val ?? ""), 10);
  if (!Number.isFinite(n) || n < 1 || n > 20) return null;
  return Math.floor(n);
}

// ── Phase 3b: eligibility, duplicate guards, caption scarcity safety ──
const PENDING_POST_STATUSES = ["queued", "draft", "processing"];
const IMAGE_REUSE_LOOKBACK_DAYS = 14;

const SCARCITY_PHRASE_RE =
  /limited stock|last chance|selling (fast|out)|almost (gone|sold out)|low stock|won't last|flying off|few left|running out|won't be restocked|don't miss out|going,? going|almost sold|time's running out|act fast|hurry/i;

type ProductStockInfo = {
  totalStock: number | null;
  hasActiveVariants: boolean;
};

type EligibilityAssessment = {
  passed: boolean;
  warnings: string[];
  skip_reason: string | null;
  inventory_status: "in_stock" | "low_stock" | "out_of_stock" | "unknown";
  backorder_status: "mto" | "backorder_unknown" | "in_stock" | "not_applicable";
};

function assessProductEligibility(
  product: Record<string, unknown>,
  stockInfo: ProductStockInfo
): EligibilityAssessment {
  const warnings: string[] = [];
  const name = String(product.name ?? "").trim();
  const slug = String(product.slug ?? "").trim();
  const image = String(product.catalog_image_url ?? "").trim();

  if (product.is_active === false) {
    return {
      passed: false,
      warnings,
      skip_reason: "inactive",
      inventory_status: "unknown",
      backorder_status: "not_applicable",
    };
  }
  if (!name) {
    return {
      passed: false,
      warnings,
      skip_reason: "missing_name",
      inventory_status: "unknown",
      backorder_status: "not_applicable",
    };
  }
  if (!slug) {
    return {
      passed: false,
      warnings,
      skip_reason: "missing_slug",
      inventory_status: "unknown",
      backorder_status: "not_applicable",
    };
  }
  if (!image) {
    return {
      passed: false,
      warnings,
      skip_reason: "no_usable_image",
      inventory_status: "unknown",
      backorder_status: "not_applicable",
    };
  }

  const isMto = product.shipping_status === "mto";
  const totalStock = stockInfo.totalStock;

  let inventory_status: EligibilityAssessment["inventory_status"] = "unknown";
  if (totalStock !== null) {
    if (totalStock <= 0) inventory_status = "out_of_stock";
    else if (totalStock <= 3) inventory_status = "low_stock";
    else inventory_status = "in_stock";
  }

  let backorder_status: EligibilityAssessment["backorder_status"] = "not_applicable";
  if (isMto) {
    backorder_status = "mto";
    warnings.push("made_to_order");
  } else if (inventory_status === "out_of_stock") {
    backorder_status = "backorder_unknown";
    warnings.push("zero_stock_no_mto_flag");
  }
  if (inventory_status === "low_stock") warnings.push("low_stock");
  if (totalStock === null && !stockInfo.hasActiveVariants) {
    warnings.push("no_variant_stock_data");
  }

  return {
    passed: true,
    warnings,
    skip_reason: null,
    inventory_status,
    backorder_status,
  };
}

function isScarcityCopySafe(eligibility: EligibilityAssessment): boolean {
  return eligibility.inventory_status === "in_stock";
}

function stripScarcityLanguage(caption: string): string {
  if (!caption) return caption;
  const lines = caption.split("\n");
  const filtered = lines.filter((line) => !SCARCITY_PHRASE_RE.test(line));
  let result = (filtered.length ? filtered : lines).join("\n");
  result = result.replace(SCARCITY_PHRASE_RE, "").replace(/\s{2,}/g, " ").trim();
  return result || caption;
}

function pickSafeTones(tones: string[], scarcitySafe: boolean): string[] {
  if (scarcitySafe) return tones.length ? tones : ["casual"];
  const filtered = tones.filter((t) => t !== "urgency");
  return filtered.length ? filtered : ["casual", "value"];
}

function pickSafeTemplate(tone: string, scarcitySafe: boolean): string {
  if (scarcitySafe && CAPTION_TEMPLATES[tone as keyof typeof CAPTION_TEMPLATES]) {
    return pickRandom(CAPTION_TEMPLATES[tone as keyof typeof CAPTION_TEMPLATES]);
  }
  if (tone === "urgency" || !scarcitySafe) {
    return pickRandom(CAPTION_TEMPLATES.casual);
  }
  return pickRandom(CAPTION_TEMPLATES[tone as keyof typeof CAPTION_TEMPLATES] || CAPTION_TEMPLATES.casual);
}

function guardCaptionScarcity(caption: string, scarcitySafe: boolean): { caption: string; guarded: boolean } {
  if (scarcitySafe || !SCARCITY_PHRASE_RE.test(caption)) {
    return { caption, guarded: false };
  }
  return { caption: stripScarcityLanguage(caption), guarded: true };
}

// ── Phase 3c: configurable scoring weights + transparency ──
const SCORING_VERSION = "3c-v1";

type ScoringWeights = {
  recency: number;
  category: number;
  image_freshness: number;
  inventory_health: number;
  penalties_enabled: boolean;
};

const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  recency: 40,
  category: 25,
  image_freshness: 25,
  inventory_health: 10,
  penalties_enabled: true,
};

function clampWeight(val: unknown, fallback: number): number {
  const n = typeof val === "number" ? val : parseInt(String(val ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(0, Math.floor(n)));
}

function resolveScoringWeights(dbRow: Record<string, unknown> | null): ScoringWeights {
  const raw = dbRow?.scoring_weights;
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SCORING_WEIGHTS };
  }
  const w = raw as Record<string, unknown>;
  return {
    recency: clampWeight(w.recency, DEFAULT_SCORING_WEIGHTS.recency),
    category: clampWeight(w.category, DEFAULT_SCORING_WEIGHTS.category),
    image_freshness: clampWeight(w.image_freshness, DEFAULT_SCORING_WEIGHTS.image_freshness),
    inventory_health: clampWeight(w.inventory_health, DEFAULT_SCORING_WEIGHTS.inventory_health),
    penalties_enabled: w.penalties_enabled !== false,
  };
}

type ProductScoreResult = {
  total: number;
  recency: number;
  category_perf: number;
  image_freshness: number;
  inventory_health: number;
  inventory_penalty: number;
  image_reuse_penalty: number;
  penalties_applied: Record<string, number>;
  boosts_applied: Record<string, number>;
  penalties: string[];
  boosts: string[];
  category_sample_size: number;
  top_boost: string | null;
  top_penalty: string | null;
  final_reason_summary: string;
};

function computeProductPriorityScore(
  product: Record<string, unknown>,
  eligibility: EligibilityAssessment,
  ctx: {
    now: number;
    weights: ScoringWeights;
    categoryEngMap: Record<string, number>;
    categorySampleMap: Record<string, number>;
    maxCatEng: number;
    freshImageCount: Record<string, number>;
    poolAssetCount: Record<string, number>;
    aiImageCount: Record<string, number>;
  }
): ProductScoreResult {
  const w = ctx.weights;
  const productId = String(product.id);
  const penalties: string[] = [];
  const boosts: string[] = [];
  const penaltiesApplied: Record<string, number> = {};
  const boostsApplied: Record<string, number> = {};

  // Recency: longer since last post = higher (up to weight cap)
  let recency = w.recency;
  if (product.last_social_post_at) {
    const daysSince =
      (ctx.now - new Date(String(product.last_social_post_at)).getTime()) / (1000 * 60 * 60 * 24);
    recency = Math.min(w.recency, (daysSince / 30) * w.recency);
  } else {
    boosts.push("never_posted");
    boostsApplied.never_posted = 2;
  }

  // Category: meaningful only when sample_size >= 3
  const catName = (product.category as { name?: string } | null)?.name || "";
  const categorySampleSize = ctx.categorySampleMap[catName] || 0;
  const catEng = ctx.categoryEngMap[catName] || 0;
  let category_perf = w.category * 0.35;
  if (categorySampleSize >= 3 && ctx.maxCatEng > 0) {
    category_perf = (catEng / ctx.maxCatEng) * w.category;
    if (categorySampleSize >= 5 && catEng / ctx.maxCatEng >= 0.55) {
      boosts.push("strong_category_performance");
      boostsApplied.category_performance = Math.min(4, w.category * 0.15);
      category_perf = Math.min(w.category, category_perf + boostsApplied.category_performance);
    }
  } else if (categorySampleSize > 0) {
    penalties.push("category_low_sample");
    penaltiesApplied.category_low_sample = 2;
  }

  // Image pool freshness
  const freshCount = ctx.freshImageCount[productId] || 0;
  const poolCount = ctx.poolAssetCount[productId] || 0;
  const aiCount = ctx.aiImageCount[productId] || 0;
  let image_freshness = Math.min(w.image_freshness, freshCount * (w.image_freshness / 4));
  if (freshCount >= 3) {
    boosts.push("strong_fresh_pool");
    boostsApplied.strong_fresh_pool = 3;
    image_freshness = Math.min(w.image_freshness, image_freshness + boostsApplied.strong_fresh_pool);
  }
  if (poolCount === 0) {
    penalties.push("no_image_pool");
    penaltiesApplied.no_image_pool = Math.min(6, w.image_freshness * 0.35);
    image_freshness = Math.max(0, image_freshness - penaltiesApplied.no_image_pool);
  }

  // Inventory health component (positive, not exclusion)
  let inventory_health = w.inventory_health;
  if (eligibility.inventory_status === "in_stock") {
    boostsApplied.in_stock = 1;
  } else if (eligibility.inventory_status === "low_stock") {
    inventory_health = w.inventory_health * 0.65;
  } else if (eligibility.inventory_status === "out_of_stock") {
    inventory_health = w.inventory_health * 0.3;
  } else {
    inventory_health = w.inventory_health * 0.5;
  }
  if (eligibility.backorder_status === "mto") {
    inventory_health = Math.min(w.inventory_health, inventory_health * 0.85 + 1);
  }

  let inventory_penalty = 0;
  if (w.penalties_enabled) {
    if (eligibility.warnings.includes("zero_stock_no_mto_flag")) {
      inventory_penalty += 8;
      penalties.push("zero_stock_non_mto");
      penaltiesApplied.zero_stock_non_mto = 8;
    }
    if (eligibility.warnings.includes("low_stock")) {
      inventory_penalty += 3;
      penalties.push("low_stock");
      penaltiesApplied.low_stock = 3;
    }
    if (eligibility.warnings.includes("no_variant_stock_data")) {
      inventory_penalty += 4;
      penalties.push("missing_stock_data");
      penaltiesApplied.missing_stock_data = 4;
    }
    if (poolCount === 0 && aiCount === 0) {
      inventory_penalty += 5;
      penalties.push("weak_image_pipeline");
      penaltiesApplied.weak_image_pipeline = 5;
    }
  }

  const subtotal = recency + category_perf + image_freshness + inventory_health;
  const total = Math.max(0, subtotal - inventory_penalty);

  const top_boost = boosts[0] || null;
  const top_penalty = penalties[0] || null;
  const parts: string[] = [`score ${total.toFixed(1)}`];
  if (top_boost) parts.push(`boost: ${top_boost.replace(/_/g, " ")}`);
  if (top_penalty) parts.push(`penalty: ${top_penalty.replace(/_/g, " ")}`);
  const final_reason_summary = parts.join(" · ");

  return {
    total,
    recency,
    category_perf,
    image_freshness,
    inventory_health,
    inventory_penalty,
    image_reuse_penalty: 0,
    penalties_applied: penaltiesApplied,
    boosts_applied: boostsApplied,
    penalties,
    boosts,
    category_sample_size: categorySampleSize,
    top_boost,
    top_penalty,
    final_reason_summary,
  };
}

// ── Phase 3d: legacy scoring approximation (preview comparison only) ──
const LEGACY_SCORING_LABEL = "legacy-pre-3c";

type LegacyScoreResult = {
  total: number;
  recency: number;
  category_perf: number;
  image_freshness: number;
  reserved: number;
};

function computeLegacyPriorityScore(
  product: Record<string, unknown>,
  ctx: {
    now: number;
    categoryEngMap: Record<string, number>;
    maxCatEng: number;
    freshImageCount: Record<string, number>;
  }
): LegacyScoreResult {
  let recency = 40;
  if (product.last_social_post_at) {
    const daysSince =
      (ctx.now - new Date(String(product.last_social_post_at)).getTime()) / (1000 * 60 * 60 * 24);
    recency = Math.min(40, (daysSince / 30) * 40);
  }
  const catName = (product.category as { name?: string } | null)?.name || "";
  const catEng = ctx.categoryEngMap[catName] || 0;
  const category_perf = ctx.maxCatEng > 0 ? (catEng / ctx.maxCatEng) * 30 : 15;
  const freshCount = ctx.freshImageCount[String(product.id)] || 0;
  const image_freshness = Math.min(20, freshCount * 5);
  const reserved = 10;
  return {
    total: recency + category_perf + image_freshness + reserved,
    recency,
    category_perf,
    image_freshness,
    reserved,
  };
}

type ScoringComparisonCandidate = {
  product_id: string;
  product_name: string;
  current_score: number;
  legacy_score: number;
  score_delta: number;
  current_rank: number;
  legacy_rank: number;
  rank_delta: number;
  why_current_rank_changed: string;
  penalties_applied: Record<string, number>;
  boosts_applied: Record<string, number>;
  warnings: string[];
  selected_in_current_top: boolean;
  selected_in_legacy_top: boolean;
};

function explainRankChange(
  score: ProductScoreResult,
  legacy: LegacyScoreResult,
  currentRank: number,
  legacyRank: number,
  rankDelta: number
): string {
  const scoreDelta = Number((score.total - legacy.total).toFixed(1));
  if (rankDelta === 0) {
    return `Same rank (#${currentRank}); 3c score ${score.total.toFixed(1)} vs legacy ${legacy.total.toFixed(1)} (Δ ${scoreDelta >= 0 ? "+" : ""}${scoreDelta})`;
  }
  const dir = rankDelta > 0 ? `Up ${rankDelta}` : `Down ${Math.abs(rankDelta)}`;
  const parts = [
    `${dir} under 3c (now #${currentRank}, legacy #${legacyRank})`,
    `score Δ ${scoreDelta >= 0 ? "+" : ""}${scoreDelta}`,
  ];
  if (score.penalties.length) parts.push(`penalties: ${score.penalties.join(", ")}`);
  if (score.boosts.length) parts.push(`boosts: ${score.boosts.join(", ")}`);
  if (score.inventory_penalty > 0) parts.push(`inventory penalty −${score.inventory_penalty}`);
  return parts.join("; ");
}

function buildScoringComparison(
  scoredProducts: Array<Record<string, unknown>>,
  selectionCount: number,
  skippedByGuards: number,
  scoreCtx: {
    now: number;
    categoryEngMap: Record<string, number>;
    maxCatEng: number;
    freshImageCount: Record<string, number>;
  }
): { candidates: ScoringComparisonCandidate[]; summary: Record<string, unknown> } {
  const withLegacy = scoredProducts.map((p: any) => ({
    ...p,
    _legacyScore: computeLegacyPriorityScore(p, scoreCtx),
  }));

  const byCurrent = [...withLegacy].sort((a: any, b: any) => b._priority - a._priority);
  const byLegacy = [...withLegacy].sort(
    (a: any, b: any) => b._legacyScore.total - a._legacyScore.total
  );

  const currentRankMap = new Map<string, number>();
  const legacyRankMap = new Map<string, number>();
  byCurrent.forEach((p: any, i: number) => currentRankMap.set(p.id, i + 1));
  byLegacy.forEach((p: any, i: number) => legacyRankMap.set(p.id, i + 1));

  const compareLimit = Math.min(byCurrent.length, Math.max(selectionCount * 3, 25));
  const reasonCounts: Record<string, number> = {};
  let movedUp = 0;
  let movedDown = 0;
  let rankUnchanged = 0;

  const candidates: ScoringComparisonCandidate[] = byCurrent
    .slice(0, compareLimit)
    .map((p: any) => {
      const score: ProductScoreResult = p._score;
      const leg: LegacyScoreResult = p._legacyScore;
      const currentRank = currentRankMap.get(p.id) ?? 0;
      const legacyRank = legacyRankMap.get(p.id) ?? 0;
      const rankDelta = legacyRank - currentRank;
      const scoreDelta = Number((score.total - leg.total).toFixed(2));

      if (rankDelta > 0) movedUp++;
      else if (rankDelta < 0) movedDown++;
      else rankUnchanged++;

      for (const pen of score.penalties) {
        const key = `penalty:${pen}`;
        reasonCounts[key] = (reasonCounts[key] || 0) + 1;
      }
      for (const boost of score.boosts) {
        const key = `boost:${boost}`;
        reasonCounts[key] = (reasonCounts[key] || 0) + 1;
      }

      return {
        product_id: p.id,
        product_name: p.name,
        current_score: Number(score.total.toFixed(2)),
        legacy_score: Number(leg.total.toFixed(2)),
        score_delta: scoreDelta,
        current_rank: currentRank,
        legacy_rank: legacyRank,
        rank_delta: rankDelta,
        why_current_rank_changed: explainRankChange(score, leg, currentRank, legacyRank, rankDelta),
        penalties_applied: { ...score.penalties_applied },
        boosts_applied: { ...score.boosts_applied },
        warnings: (p._eligibility as EligibilityAssessment)?.warnings || [],
        selected_in_current_top: currentRank > 0 && currentRank <= selectionCount,
        selected_in_legacy_top: legacyRank > 0 && legacyRank <= selectionCount,
      };
    });

  const topReasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([reason, count]) => ({ reason, count }));

  return {
    candidates,
    summary: {
      candidates_compared: candidates.length,
      queue_ready_total: scoredProducts.length,
      selection_count: selectionCount,
      moved_up_by_new_scoring: movedUp,
      moved_down_by_new_scoring: movedDown,
      rank_unchanged: rankUnchanged,
      skipped_by_guards: skippedByGuards,
      top_reasons_for_rank_movement: topReasons,
      legacy_scoring_label: LEGACY_SCORING_LABEL,
      current_scoring_version: SCORING_VERSION,
      legacy_formula: "recency 40 + category 30 (or 15 default) + images 20 + reserved 10",
    },
  };
}

function buildSelectionScoreMetadata(
  score: ProductScoreResult,
  weights: ScoringWeights,
  imageReuseGuard?: string
): Record<string, unknown> {
  let image_reuse_penalty = score.image_reuse_penalty;
  const penalties_applied = { ...score.penalties_applied };
  if (imageReuseGuard === "reused_no_alternative") {
    image_reuse_penalty = 3;
    penalties_applied.image_reuse = 3;
  }
  const priority_score = Math.max(0, score.total - image_reuse_penalty);

  return {
    scoring_version: SCORING_VERSION,
    priority_score,
    score_breakdown: {
      recency: score.recency,
      category_perf: score.category_perf,
      image_freshness: score.image_freshness,
      inventory_health: score.inventory_health,
      inventory_penalty: score.inventory_penalty,
      image_reuse_penalty,
      subtotal: score.total,
    },
    scoring_weights_used: { ...weights },
    penalties_applied,
    boosts_applied: score.boosts_applied,
    inventory_penalty: score.inventory_penalty,
    image_reuse_penalty,
    category_sample_size: score.category_sample_size,
    top_boost: score.top_boost,
    top_penalty: score.top_penalty,
    final_reason_summary: score.final_reason_summary,
    selected_reason: "priority_score_top",
  };
}

type AutoQueueRunSettings = {
  count: number;
  platforms: string[];
  caption_tones: string[];
  posting_times: string[];
};

function resolveAutoQueueRunSettings(
  body: Record<string, unknown>,
  dbRow: Record<string, unknown> | null
): AutoQueueRunSettings {
  const db = dbRow && typeof dbRow === "object" ? dbRow : {};

  const count =
    parseCount(body.count) ??
    parseCount(db.count) ??
    4;

  const platforms =
    filterStringArray(body.platforms, VALID_PLATFORMS) ??
    filterStringArray(body.platform, VALID_PLATFORMS) ??
    filterStringArray(db.platforms, VALID_PLATFORMS) ??
    ["instagram"];

  const caption_tones =
    filterStringArray(body.captionTones, VALID_TONES) ??
    filterStringArray(body.caption_tones, VALID_TONES) ??
    filterStringArray(body.tones, VALID_TONES) ??
    filterStringArray(db.caption_tones, VALID_TONES) ??
    filterStringArray(db.captionTones, VALID_TONES) ??
    ["casual"];

  const posting_times =
    parsePostingTimes(body.postingTimes) ??
    parsePostingTimes(body.posting_times) ??
    parsePostingTimes(db.posting_times) ??
    parsePostingTimes(db.postingTimes) ??
    ["10:00", "18:00"];

  return { count, platforms, caption_tones, posting_times };
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
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const preview = body.preview === true;
    const learning_only = body.learning_only === true;
    const compareScoring =
      preview &&
      (body.compareScoring === true || body.compare_scoring === true);

    // ── PHASE 1B: LEARNING-ONLY MODE (called by instagram-insights) ──
    if (learning_only) {
      await runLearningAggregation(supabase);
      return new Response(
        JSON.stringify({ success: true, message: "Learning aggregation complete" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // 2. Load persisted auto_queue settings, then merge request overrides
    const { data: settingsRow } = await supabase
      .from("social_settings")
      .select("setting_value")
      .eq("setting_key", "auto_queue")
      .single();

    const dbSettings =
      settingsRow?.setting_value && typeof settingsRow.setting_value === "object"
        ? (settingsRow.setting_value as Record<string, unknown>)
        : null;

    const runSettings = resolveAutoQueueRunSettings(body, dbSettings);
    const { count, platforms: platformList, caption_tones, posting_times } = runSettings;

    const allowMultiPlatformPerProduct =
      dbSettings?.allow_multi_platform_per_product === true ||
      body.allow_multi_platform_per_product === true;

    const scoringWeights = resolveScoringWeights(dbSettings);

    const imageAssetPolicy =
      dbSettings?.image_asset_policy === "legacy_pipeline" ||
      dbSettings?.allow_catalog_fallback === true
        ? "legacy_pipeline"
        : "image_pool_only";

    // Settings object used by caption/timing logic (body overrides DB for this run)
    const settings = {
      ...(dbSettings || {}),
      count,
      platforms: platformList,
      caption_tones,
      posting_times,
      allow_multi_platform_per_product: allowMultiPlatformPerProduct,
    };

    console.log(
      `[auto-queue] Run settings: count=${count} platforms=${platformList.join(",")} ` +
      `tones=${caption_tones.join(",")} times=${posting_times.join(",")} preview=${preview}`
    );

    // Load Pinterest board mapping for auto-assigning boards
    let pinterestBoardMap: Record<string, string> = {};
    let pinterestDefaultBoard = "";
    if (platformList.includes("pinterest")) {
      const { data: boardMapRow } = await supabase
        .from("social_settings")
        .select("setting_value")
        .eq("setting_key", "pinterest_board_map")
        .single();
      if (boardMapRow?.setting_value) {
        pinterestBoardMap = boardMapRow.setting_value.board_map || {};
        pinterestDefaultBoard = boardMapRow.setting_value.default_board_id || "";
        console.log(`[auto-queue] Pinterest board map loaded: ${Object.keys(pinterestBoardMap).length} categories mapped, default=${pinterestDefaultBoard}`);
      } else {
        console.warn("[auto-queue] No Pinterest board map found — run sync-pinterest-boards first");
      }
    }

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
    // Fetch ALL active products (with shipping_status for MTO / backorder context)
    const { data: allProducts, error: prodError } = await supabase
      .from("products")
      .select(`
        id,
        name,
        slug,
        category_id,
        catalog_image_url,
        price,
        is_active,
        shipping_status,
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
        run_summary: { eligible_count: 0, skipped_count: 0 },
        skipped_products: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const allProductIds = allProducts.map((p: any) => p.id);

    // Variant stock totals (sum active variant stock; null if no variants)
    const stockByProduct: Record<string, ProductStockInfo> = {};
    const { data: variantRows } = await supabase
      .from("product_variants")
      .select("product_id, stock")
      .in("product_id", allProductIds)
      .eq("is_active", true);

    (variantRows || []).forEach((row: any) => {
      if (!stockByProduct[row.product_id]) {
        stockByProduct[row.product_id] = { totalStock: 0, hasActiveVariants: true };
      }
      const s = row.stock;
      if (typeof s === "number" && Number.isFinite(s)) {
        stockByProduct[row.product_id].totalStock =
          (stockByProduct[row.product_id].totalStock ?? 0) + s;
      }
    });

    const getStockInfo = (productId: string): ProductStockInfo =>
      stockByProduct[productId] || { totalStock: null, hasActiveVariants: false };

    // ── Phase 3b: pending queue duplicate guard ──
    const { data: pendingPosts } = await supabase
      .from("social_posts")
      .select("product_id, platform, image_url, scheduled_for")
      .in("status", PENDING_POST_STATUSES)
      .not("product_id", "is", null);

    const pendingByProduct = new Map<string, { platforms: Set<string>; count: number }>();
    (pendingPosts || []).forEach((row: any) => {
      if (!row.product_id) return;
      const entry = pendingByProduct.get(row.product_id) || { platforms: new Set(), count: 0 };
      entry.count += 1;
      if (row.platform) entry.platforms.add(row.platform);
      pendingByProduct.set(row.product_id, entry);
    });

    // Recent image URLs per product (avoid stale reuse when alternatives exist)
    const imageReuseCutoff = new Date(
      Date.now() - IMAGE_REUSE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data: recentImagePosts } = await supabase
      .from("social_posts")
      .select("product_id, image_url")
      .in("status", [...PENDING_POST_STATUSES, "posted"])
      .not("product_id", "is", null)
      .not("image_url", "is", null)
      .gte("scheduled_for", imageReuseCutoff);

    const recentImagesByProduct: Record<string, Set<string>> = {};
    (recentImagePosts || []).forEach((row: any) => {
      if (!row.product_id || !row.image_url) return;
      if (!recentImagesByProduct[row.product_id]) {
        recentImagesByProduct[row.product_id] = new Set();
      }
      recentImagesByProduct[row.product_id].add(row.image_url);
    });

    const skippedProducts: Array<Record<string, unknown>> = [];

    // Eligibility pass (inactive/name/image already filtered at query; strict re-check)
    const eligibilityPassed: any[] = [];
    for (const p of allProducts) {
      const stockInfo = getStockInfo(p.id);
      const eligibility = assessProductEligibility(p, stockInfo);
      if (!eligibility.passed) {
        skippedProducts.push({
          product_id: p.id,
          product_name: p.name,
          skipped_reason: eligibility.skip_reason,
          eligibility_warnings: eligibility.warnings,
          inventory_status: eligibility.inventory_status,
          backorder_status: eligibility.backorder_status,
        });
        continue;
      }
      eligibilityPassed.push({ ...p, _eligibility: eligibility, _stockInfo: stockInfo });
    }

    // 3-day cooldown: exclude recently posted products (preserve existing rule)
    const cooldownMs = 3 * 24 * 60 * 60 * 1000;
    const cooldownCutoff = new Date(Date.now() - cooldownMs).toISOString();
    const cooledProducts = eligibilityPassed.filter((p: any) =>
      !p.last_social_post_at || p.last_social_post_at < cooldownCutoff
    );

    const cooldownSkipped = eligibilityPassed.length - cooledProducts.length;
    if (cooldownSkipped > 0) {
      console.log(`[auto-queue] ${cooldownSkipped} products on 3-day last_social_post_at cooldown`);
    }

    // Exclude products already in pending queue
    const queueReadyProducts = cooledProducts.filter((p: any) => {
      if (!pendingByProduct.has(p.id)) return true;
      const pending = pendingByProduct.get(p.id)!;
      skippedProducts.push({
        product_id: p.id,
        product_name: p.name,
        skipped_reason: "pending_queue_post",
        duplicate_guard_result: `already_${pending.count}_queued`,
        pending_platforms: [...pending.platforms],
        eligibility_warnings: p._eligibility?.warnings || [],
      });
      return false;
    });

    console.log(
      `[auto-queue] Products: ${allProducts.length} total, ${eligibilityPassed.length} eligibility-pass, ` +
      `${cooledProducts.length} off cooldown, ${queueReadyProducts.length} queue-ready, ` +
      `${skippedProducts.length} skipped`
    );

    if (!queueReadyProducts.length) {
      return new Response(JSON.stringify({
        success: true,
        message: cooledProducts.length
          ? "All eligible products are on cooldown or already queued"
          : "No products available for posting",
        generated: 0,
        preview: preview || undefined,
        run_summary: {
          eligible_count: 0,
          skipped_count: skippedProducts.length,
          pending_queue_blocked: skippedProducts.filter(
            (s) => s.skipped_reason === "pending_queue_post"
          ).length,
        },
        skipped_products: preview ? skippedProducts : undefined,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Load category engagement data for scoring
    const { data: categoryPerf } = await supabase
      .from("post_learning_patterns")
      .select("pattern_key, pattern_value, sample_size")
      .eq("pattern_type", "category_performance");

    const categoryEngMap: Record<string, number> = {};
    const categorySampleMap: Record<string, number> = {};
    let maxCatEng = 0;
    (categoryPerf || []).forEach((row: any) => {
      const key = row.pattern_key;
      categorySampleMap[key] = Number(row.sample_size) || 0;
      if (row.sample_size >= 3 && row.pattern_value?.avg_engagement_rate) {
        const rate = Number(row.pattern_value.avg_engagement_rate) || 0;
        categoryEngMap[key] = rate;
        if (rate > maxCatEng) maxCatEng = rate;
      }
    });

    // Load ready pool assets per product for image freshness scoring
    const scoredProductIds = queueReadyProducts.map((p: any) => p.id);

    const { data: allPoolAssets } = await supabase
      .from("social_assets")
      .select("id, product_id, used_count")
      .eq("is_active", true)
      .not("product_id", "is", null)
      .not("shot_type", "is", null)
      .in("product_id", scoredProductIds);

    const freshImageCount: Record<string, number> = {};
    const poolAssetCount: Record<string, number> = {};
    (allPoolAssets || []).forEach((a: any) => {
      poolAssetCount[a.product_id] = (poolAssetCount[a.product_id] || 0) + 1;
      if ((a.used_count || 0) === 0) {
        freshImageCount[a.product_id] = (freshImageCount[a.product_id] || 0) + 1;
      }
    });

    const { data: allAiRows } = await supabase
      .from("social_generated_images")
      .select("product_id")
      .in("product_id", scoredProductIds)
      .eq("status", "approved");

    const aiImageCount: Record<string, number> = {};
    (allAiRows || []).forEach((row: any) => {
      aiImageCount[row.product_id] = (aiImageCount[row.product_id] || 0) + 1;
    });

    // ── Phase 3c: priority scoring with penalties/boosts ──
    const now = Date.now();
    const scoreCtx = {
      now,
      weights: scoringWeights,
      categoryEngMap,
      categorySampleMap,
      maxCatEng,
      freshImageCount,
      poolAssetCount,
      aiImageCount,
    };

    const scoredProducts = queueReadyProducts.map((p: any) => {
      const eligibility: EligibilityAssessment = p._eligibility;
      const score = computeProductPriorityScore(p, eligibility, scoreCtx);
      return {
        ...p,
        _priority: score.total,
        _score: score,
        _recency: score.recency,
        _catPerf: score.category_perf,
        _imgFresh: score.image_freshness,
      };
    });

    let scoringComparisonResult: {
      candidates: ScoringComparisonCandidate[];
      summary: Record<string, unknown>;
    } | null = null;
    const scoringComparisonByProduct: Record<string, ScoringComparisonCandidate> = {};

    if (compareScoring) {
      scoringComparisonResult = buildScoringComparison(
        scoredProducts,
        count,
        skippedProducts.length,
        {
          now,
          categoryEngMap,
          maxCatEng,
          freshImageCount,
        }
      );
      for (const c of scoringComparisonResult.candidates) {
        scoringComparisonByProduct[c.product_id] = c;
      }
      console.log(
        `[auto-queue] Scoring comparison: ${scoringComparisonResult.summary.candidates_compared} candidates, ` +
        `up=${scoringComparisonResult.summary.moved_up_by_new_scoring} down=${scoringComparisonResult.summary.moved_down_by_new_scoring}`
      );
    }

    // Sort by priority descending, take top `count`
    scoredProducts.sort((a: any, b: any) => b._priority - a._priority);
    const products = scoredProducts.slice(0, count);

    console.log(
      `[auto-queue] Scoring ${SCORING_VERSION} weights: recency=${scoringWeights.recency} ` +
      `category=${scoringWeights.category} images=${scoringWeights.image_freshness} ` +
      `inventory=${scoringWeights.inventory_health} penalties=${scoringWeights.penalties_enabled}`
    );
    console.log(`[auto-queue] Top ${products.length} products by priority:`);
    products.forEach((p: any) => {
      const s = p._score;
      console.log(
        `  ${p.name}: score=${p._priority.toFixed(1)} (recency=${s.recency.toFixed(1)} ` +
        `cat=${s.category_perf.toFixed(1)} img=${s.image_freshness.toFixed(1)} inv=${s.inventory_health.toFixed(1)} ` +
        `penalty=${s.inventory_penalty}) — ${s.final_reason_summary}`
      );
    });

    // ── IMAGE POOL: Load ready assets (must have product_id AND shot_type) ──
    const productIds = products.map((p: any) => p.id);

    // Only "ready" assets qualify for autopilot — both product_id and shot_type required
    const { data: poolAssets } = await supabase
      .from("social_assets")
      .select("id, product_id, original_image_path, shot_type, used_count, last_used_at, quality_score, content_type")
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

    // ── IMAGE PIPELINE (legacy fallback only) ──
    const useLegacyImageFallback = imageAssetPolicy === "legacy_pipeline";

    const blacklistMap: Record<string, Set<string>> = {};
    const aiImageMap: Record<string, any[]> = {};
    const galleryMap: Record<string, string[]> = {};
    let pipelineSettings: Record<string, unknown> = {
      enabled: false, auto_generate: false, require_review: true, fallback_to_catalog: true,
    };

    if (useLegacyImageFallback) {
      const { data: blacklistRows } = await supabase
        .from("image_blacklist")
        .select("product_id, image_url")
        .in("product_id", productIds);

      (blacklistRows || []).forEach(row => {
        if (!blacklistMap[row.product_id]) blacklistMap[row.product_id] = new Set();
        blacklistMap[row.product_id].add(row.image_url);
      });

      const { data: aiImageRows } = await supabase
        .from("social_generated_images")
        .select("id, product_id, public_url, style")
        .in("product_id", productIds)
        .eq("status", "approved")
        .order("created_at", { ascending: false });

      (aiImageRows || []).forEach(row => {
        if (!aiImageMap[row.product_id]) aiImageMap[row.product_id] = [];
        aiImageMap[row.product_id].push(row);
      });

      const { data: galleryRows } = await supabase
        .from("product_gallery_images")
        .select("product_id, url")
        .in("product_id", productIds)
        .order("position", { ascending: true });

      (galleryRows || []).forEach(row => {
        if (!galleryMap[row.product_id]) galleryMap[row.product_id] = [];
        galleryMap[row.product_id].push(row.url);
      });

      const { data: pipelineRow } = await supabase
        .from("social_settings")
        .select("setting_value")
        .eq("setting_key", "image_pipeline")
        .single();

      pipelineSettings = (pipelineRow?.setting_value as Record<string, unknown>) || pipelineSettings;

      console.log(
        `[auto-queue] Legacy image pipeline: enabled=${pipelineSettings.enabled}, ` +
        `AI approved=${Object.values(aiImageMap).flat().length} images`
      );
    } else {
      console.log(`[auto-queue] Image asset policy: ${imageAssetPolicy} (catalog/gallery/AI fallback disabled)`);
    }

    // ── Helper: resolve storage path to full public URL ──
    function resolveStorageUrl(path: string): string {
      if (path.startsWith("http")) return path;
      // Relative path in the social-media storage bucket
      return `${supabaseUrl}/storage/v1/object/public/social-media/${path}`;
    }

    // ── Helper: decide if this product should get a carousel post ──
    // Carousel if product has 3+ images from pool OR AI and platform supports it
    function shouldUseCarousel(productId: string, platform: string): {
      isCarousel: boolean;
      carouselUrls: string[];
      carouselSource: string;
    } {
      if (platform !== "instagram") return { isCarousel: false, carouselUrls: [], carouselSource: "" };

      // Priority 1: Image Pool — tagged, curated assets
      const poolImages = poolMap[productId];
      if (poolImages && poolImages.length >= 3) {
        // 50% chance of carousel when enough images available (variety of post types)
        if (Math.random() > 0.5) return { isCarousel: false, carouselUrls: [], carouselSource: "" };
        const shuffled = [...poolImages].sort(() => Math.random() - 0.5);
        const carouselCount = Math.min(shuffled.length, Math.floor(Math.random() * 3) + 3); // 3-5
        return {
          isCarousel: true,
          carouselUrls: shuffled.slice(0, carouselCount).map((img: any) => resolveStorageUrl(img.original_image_path)),
          carouselSource: "image_pool",
        };
      }

      // Priority 2: AI-generated images (legacy pipeline only)
      if (imageAssetPolicy !== "legacy_pipeline") {
        return { isCarousel: false, carouselUrls: [], carouselSource: "" };
      }

      const aiImages = aiImageMap[productId];
      if (aiImages && aiImages.length >= 3) {
        if (Math.random() > 0.5) return { isCarousel: false, carouselUrls: [], carouselSource: "" };
        const shuffled = [...aiImages].sort(() => Math.random() - 0.5);
        const carouselCount = Math.min(shuffled.length, Math.floor(Math.random() * 3) + 3);
        return {
          isCarousel: true,
          carouselUrls: shuffled.slice(0, carouselCount).map((img: any) => img.public_url),
          carouselSource: "ai_carousel",
        };
      }

      return { isCarousel: false, carouselUrls: [], carouselSource: "" };
    }

    // ── Helper: resolve best image for a product ──
    function resolveImage(productId: string, catalogUrl: string): {
      imageUrl: string | null;
      imageSource: string;
      generatedImageId: string | null;
      needsGeneration: boolean;
      poolAssetId: string | null;
      imageReuseGuard: string;
      assetContentType: string | null;
      noPoolAsset?: boolean;
    } {
      const blacklisted = blacklistMap[productId] || new Set();
      const recentUrls = recentImagesByProduct[productId] || new Set();

      const isRecentlyUsed = (url: string) => recentUrls.has(url);

      // Priority 0 (Sprint 2): Image Pool — tagged assets, unused-first
      const poolImages = poolMap[productId];
      if (poolImages?.length) {
        const freshPool = poolImages.filter(
          (img: any) => !isRecentlyUsed(resolveStorageUrl(img.original_image_path))
        );
        const pick = (freshPool.length ? freshPool : poolImages)[0];
        const url = resolveStorageUrl(pick.original_image_path);
        return {
          imageUrl: url,
          imageSource: "image_pool",
          generatedImageId: null,
          needsGeneration: false,
          poolAssetId: pick.id,
          imageReuseGuard: freshPool.length ? "passed" : "reused_no_alternative",
          assetContentType: pick.content_type || "product",
        };
      }

      if (imageAssetPolicy === "image_pool_only") {
        return {
          imageUrl: null,
          imageSource: "none",
          generatedImageId: null,
          needsGeneration: false,
          poolAssetId: null,
          imageReuseGuard: "no_pool_asset",
          assetContentType: null,
          noPoolAsset: true,
        };
      }

      // Priority 1: Approved AI-generated image (legacy pipeline)
      const aiImages = aiImageMap[productId];
      if (aiImages?.length) {
        const freshAi = aiImages.filter((img: any) => !isRecentlyUsed(img.public_url));
        const pick = (freshAi.length ? freshAi : aiImages)[
          Math.floor(Math.random() * (freshAi.length || aiImages.length))
        ];
        return {
          imageUrl: pick.public_url,
          imageSource: "ai_generated",
          generatedImageId: pick.id,
          needsGeneration: false,
          poolAssetId: null,
          imageReuseGuard: freshAi.length ? "passed" : "reused_no_alternative",
          assetContentType: null,
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
          imageReuseGuard: isRecentlyUsed(tempUrl) ? "reused_no_alternative" : "passed",
          assetContentType: null,
        };
      }

      // Pipeline disabled — fall through to catalog/gallery
      const galleryUrls = (galleryMap[productId] || []).filter(url => !blacklisted.has(url));
      if (galleryUrls.length) {
        const freshGallery = galleryUrls.filter((url) => !isRecentlyUsed(url));
        const pickUrl = (freshGallery.length ? freshGallery : galleryUrls)[
          Math.floor(Math.random() * (freshGallery.length || galleryUrls.length))
        ];
        return {
          imageUrl: pickUrl,
          imageSource: "gallery",
          generatedImageId: null,
          needsGeneration: false,
          poolAssetId: null,
          imageReuseGuard: freshGallery.length ? "passed" : "reused_no_alternative",
          assetContentType: null,
        };
      }

      return {
        imageUrl: catalogUrl,
        imageSource: "catalog",
        generatedImageId: null,
        needsGeneration: false,
        poolAssetId: null,
        imageReuseGuard: isRecentlyUsed(catalogUrl) ? "reused_no_alternative" : "passed",
        assetContentType: null,
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
    const baseTones = settings.caption_tones || ["casual", "urgency"];
    const platformsForBatch = allowMultiPlatformPerProduct
      ? platformList
      : [platformList[0]];
    if (!allowMultiPlatformPerProduct && platformList.length > 1) {
      console.log(
        `[auto-queue] Multi-platform per product disabled — using ${platformList[0]} only per product this run`
      );
    }
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

      if (imageAssetPolicy === "image_pool_only" && !poolMap[product.id]?.length) {
        skippedProducts.push({
          product_id: product.id,
          product_name: product.name,
          skipped_reason: "no_approved_image_pool_asset",
          asset_policy: imageAssetPolicy,
        });
        console.log(`[auto-queue] Skipping "${product.name}" — no approved Image Pool asset`);
        continue;
      }

      const eligibility: EligibilityAssessment = product._eligibility || assessProductEligibility(
        product,
        product._stockInfo || getStockInfo(product.id)
      );
      const scarcitySafe = isScarcityCopySafe(eligibility);
      const tones = pickSafeTones(baseTones, scarcitySafe);
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
            const guarded = guardCaptionScarcity(aiResult.caption, scarcitySafe);
            bestCaption = guarded.caption;
            bestScore = scoreCaptionConfidence(bestCaption);
            captionSource = guarded.guarded ? "ai_generated_guarded" : "ai_generated";
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
          const template = pickSafeTemplate(tone, scarcitySafe);
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

      const finalGuard = guardCaptionScarcity(bestCaption, scarcitySafe);
      bestCaption = finalGuard.caption;
      const scarcityGuardApplied = finalGuard.guarded || captionSource === "ai_generated_guarded";

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
              imageResult.imageUrl = resolveStorageUrl(alternative.original_image_path);
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

      if (imageResult.noPoolAsset) {
        skippedProducts.push({
          product_id: product.id,
          product_name: product.name,
          skipped_reason: "no_approved_image_pool_asset",
          asset_policy: imageAssetPolicy,
        });
        continue;
      }

      const pendingInfo = pendingByProduct.get(product.id);
      const duplicateGuardResult = pendingInfo
        ? `blocked_pending_${pendingInfo.count}`
        : "passed";

      const scoreMeta = buildSelectionScoreMetadata(
        product._score,
        scoringWeights,
        imageResult.imageReuseGuard
      );

      // Build selection metadata for observability
      const selectionMeta = {
        ...scoreMeta,
        asset_policy: imageAssetPolicy,
        image_source: imageResult.imageSource,
        image_pool_asset_id: imageResult.poolAssetId,
        asset_content_type: imageResult.assetContentType || finalAsset?.content_type || null,
        shot_type: chosenShotType,
        is_resurfaced: false,
        caption_source: captionSource,
        caption_confidence: bestScore,
        caption_status: captionStatus,
        caption_tone: bestTone,
        eligibility_passed: true,
        eligibility_warnings: eligibility.warnings,
        duplicate_guard_result: duplicateGuardResult,
        image_reuse_guard: imageResult.imageReuseGuard,
        inventory_status: eligibility.inventory_status,
        backorder_status: eligibility.backorder_status,
        scarcity_guard_applied: scarcityGuardApplied,
        multi_platform_mode: allowMultiPlatformPerProduct ? "all_platforms" : "primary_only",
      };

      // Create post for selected platform(s) — default: primary platform only per product
      for (const plat of platformsForBatch) {
        // Re-generate caption for this specific platform if needed (IG vs FB)
        let platformCaption = bestCaption;
        if (plat !== platformsForBatch[0]) {
          // Regenerate with platform-specific link handling
          const tone = bestTone;
          const tmpl = pickSafeTemplate(tone, scarcitySafe);
          platformCaption = generateCaption(tmpl, {
            name: product.name,
            category_name: categoryName,
            slug: product.slug,
          }, plat);
          const platGuard = guardCaptionScarcity(platformCaption, scarcitySafe);
          platformCaption = platGuard.caption;
        }

        // Check if this should be a carousel post
        const carouselResult = shouldUseCarousel(product.id, plat);

        generatedPosts.push({
          product_id: product.id,
          product_name: product.name,
          product_slug: product.slug,
          category_id: product.category_id,
          catalog_image_url: product.catalog_image_url,
          last_social_post_at: product.last_social_post_at || null,
          priority_score: scoreMeta.priority_score,
          resolved_image_url: imageResult.imageUrl,
          image_source: carouselResult.isCarousel ? carouselResult.carouselSource : imageResult.imageSource,
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
          scoring_comparison: scoringComparisonByProduct[product.id] || null,
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
            const resurfaceEligibility = assessProductEligibility(
              resurfaceProduct,
              getStockInfo(resurfaceProduct.id)
            );
            const resurfaceScarcitySafe = isScarcityCopySafe(resurfaceEligibility);
            const resurfaceTones = pickSafeTones(baseTones, resurfaceScarcitySafe);
            const freshTone = pickRandom(resurfaceTones);
            const freshTemplate = pickSafeTemplate(freshTone, resurfaceScarcitySafe);
            const freshCaption = guardCaptionScarcity(
              generateCaption(freshTemplate, {
                name: resurfaceProduct.name,
                category_name: resurfaceProduct.category?.name || "item",
                slug: resurfaceProduct.slug,
              }, platformList[0]),
              resurfaceScarcitySafe
            ).caption;

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
                asset_policy: "resurface_exception",
                image_source: "resurface",
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
                eligibility_passed: true,
                eligibility_warnings: resurfaceEligibility.warnings,
                duplicate_guard_result: "resurface",
                inventory_status: resurfaceEligibility.inventory_status,
                backorder_status: resurfaceEligibility.backorder_status,
                selected_reason: "auto_resurface_hit",
                scarcity_guard_applied: !resurfaceScarcitySafe,
              },
            };

            console.log(`[auto-queue] Auto-resurface: "${resurfaceProduct.name}" (original engagement: ${hit.engagement_rate}%, median: ${medianRate}%)`);
          }
        }
      }
    }

    // If preview mode, return without saving
    const runSummary = {
      eligible_count: generatedPosts.length,
      products_selected: products.length,
      skipped_count: skippedProducts.length,
      no_pool_asset_skipped: skippedProducts.filter(
        (s) => s.skipped_reason === "no_approved_image_pool_asset"
      ).length,
      pending_queue_blocked: skippedProducts.filter(
        (s) => s.skipped_reason === "pending_queue_post"
      ).length,
      image_asset_policy: imageAssetPolicy,
      pool_ready_assets: totalTaggedAssets,
      pool_ready_products: Object.keys(poolMap).length,
      multi_platform_per_product: allowMultiPlatformPerProduct,
      platforms_per_product: platformsForBatch.length,
    };

    const lastRunPayload = {
      ran_at: new Date().toISOString(),
      preview: !!preview,
      generated: generatedPosts.length,
      run_summary: runSummary,
    };

    await supabase.from("social_settings").upsert({
      setting_key: "auto_queue_last_run",
      setting_value: lastRunPayload,
    }, { onConflict: "setting_key" });

    if (preview) {
      return new Response(JSON.stringify({
        success: true,
        preview: true,
        compare_scoring: compareScoring,
        posts: generatedPosts,
        skipped_products: skippedProducts,
        run_summary: runSummary,
        scoring_comparison: scoringComparisonResult ?? undefined,
        settings_used: {
          count,
          platforms: platformList,
          caption_tones,
          posting_times,
          allow_multi_platform_per_product: allowMultiPlatformPerProduct,
          scoring_weights: scoringWeights,
          scoring_version: SCORING_VERSION,
          image_asset_policy: imageAssetPolicy,
        },
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

        // Auto-assign Pinterest board based on product category
        if (post.platform === "pinterest") {
          const boardId = (post.category_id && pinterestBoardMap[post.category_id]) || pinterestDefaultBoard;
          if (boardId) {
            postPayload.pinterest_board_id = boardId;
            console.log(`[auto-queue] Pinterest board auto-assigned: ${boardId} for "${post.product_name}"`);
          }
        }

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

    return new Response(JSON.stringify({
      success: true,
      message: `Generated ${createdPosts.length} posts (${platformSummary})`,
      generated: createdPosts.length,
      byPlatform,
      posts: createdPosts,
      skippedErrors: skippedErrors.length ? skippedErrors : undefined,
      generatedCount: generatedPosts.length,
      skipped_products: skippedProducts.length ? skippedProducts : undefined,
      run_summary: runSummary,
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
