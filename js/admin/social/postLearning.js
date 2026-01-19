// /js/admin/social/postLearning.js
// Post Learning Engine - Analyzes posts and learns what works

import { getSupabaseClient } from "../../shared/supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config/env.js";

// ============================================
// AI Configuration
// ============================================

const USE_AI_ANALYSIS = true; // Toggle AI-powered analysis

/**
 * Call AI Edge Function for analysis
 */
async function callAIFunction(type, data) {
  if (!USE_AI_ANALYSIS) return null;
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ type, ...data })
    });
    
    if (!response.ok) {
      console.warn("AI analysis failed:", await response.text());
      return null;
    }
    
    return await response.json();
  } catch (err) {
    console.warn("AI analysis error:", err);
    return null;
  }
}

// ============================================
// Category Intelligence System
// ============================================

const CATEGORY_RESEARCH_THRESHOLD = 3; // Minimum posts needed for research

/**
 * Check if any category needs AI research and trigger it
 * Called after analyzing posts
 */
export async function checkAndResearchCategories() {
  const supabase = getSupabaseClient();
  
  // Get all posted posts with category info
  const { data: posts, error } = await supabase
    .from("social_posts")
    .select(`
      id, caption, hashtags, likes, comments, saves, shares, reach, 
      engagement_rate, posted_at, status,
      variation:social_variations(
        asset:social_assets(
          product:products(name, category_id, categories(id, name))
        )
      )
    `)
    .eq("status", "posted")
    .eq("platform", "instagram")
    .not("engagement_rate", "is", null);
    
  if (error || !posts) {
    console.warn("Could not fetch posts for category research:", error);
    return [];
  }
  
  // Group posts by category
  const categoryPosts = {};
  posts.forEach(post => {
    const category = post.variation?.asset?.product?.categories?.name || "uncategorized";
    if (!categoryPosts[category]) {
      categoryPosts[category] = [];
    }
    categoryPosts[category].push({
      ...post,
      product_name: post.variation?.asset?.product?.name
    });
  });
  
  // Get existing category insights to avoid re-researching
  const { data: existingInsights } = await supabase
    .from("post_learning_patterns")
    .select("pattern_key, last_calculated")
    .eq("pattern_type", "category_insight");
    
  const existingCategories = new Set(
    existingInsights?.map(i => i.pattern_key) || []
  );
  
  const researchedCategories = [];
  
  // Build list of categories to research
  const toResearch = [];
  for (const [categoryName, catPosts] of Object.entries(categoryPosts)) {
    if (catPosts.length < CATEGORY_RESEARCH_THRESHOLD) {
      console.log(`[Category] ${categoryName}: ${catPosts.length} posts (need ${CATEGORY_RESEARCH_THRESHOLD} for research)`);
      continue;
    }
    
    const existing = existingInsights?.find(i => i.pattern_key === categoryName);
    const isStale = existing && existing.last_calculated &&
      new Date(existing.last_calculated) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    if (!existingCategories.has(categoryName) || isStale) {
      toResearch.push({ categoryName, catPosts });
    } else {
      console.log(`[Category] ${categoryName}: Already researched`);
    }
  }
  
  // Research with progress updates
  for (let i = 0; i < toResearch.length; i++) {
    const { categoryName, catPosts } = toResearch[i];
    console.log(`[Category] Researching ${categoryName} (${catPosts.length} posts)... [${i + 1}/${toResearch.length}]`);
    
    // Dispatch progress event for UI
    window.dispatchEvent(new CustomEvent("categoryResearchProgress", {
      detail: { current: i + 1, total: toResearch.length, category: categoryName }
    }));
    
    const insights = await researchCategory(categoryName, catPosts);
    if (insights) {
      researchedCategories.push({ category: categoryName, insights });
    }
  }
  
  return researchedCategories;
}

/**
 * Research a specific category with AI
 */
async function researchCategory(categoryName, posts) {
  const supabase = getSupabaseClient();
  
  try {
    console.log(`[Category] Calling AI for ${categoryName} with ${posts.length} posts...`);
    
    const aiResult = await callAIFunction("category_research", {
      categoryData: {
        categoryName,
        posts: posts.map(p => ({
          caption: p.caption,
          hashtags: p.hashtags || [],
          likes: p.likes || 0,
          comments: p.comments || 0,
          saves: p.saves || 0,
          shares: p.shares || 0,
          engagement_rate: p.engagement_rate || 0,
          posted_at: p.posted_at,
          product_name: p.product_name
        }))
      }
    });
    
    console.log(`[Category] AI result for ${categoryName}:`, aiResult);
    
    if (aiResult && !aiResult.error) {
      // Store category insights
      const { data, error } = await supabase.from("post_learning_patterns").upsert({
        pattern_type: "category_insight",
        pattern_key: categoryName,
        pattern_value: aiResult,
        confidence_score: Math.min(0.9, 0.5 + (posts.length * 0.05)), // More posts = higher confidence
        sample_size: posts.length,
        last_calculated: new Date().toISOString()
      }, { onConflict: "pattern_type,pattern_key" });
      
      if (error) {
        console.error(`[Category] Failed to save insights for ${categoryName}:`, error);
        return null;
      }
      
      console.log(`✅ [Category] Saved insights for ${categoryName}`);
      return aiResult;
    } else {
      console.error(`[Category] AI returned error for ${categoryName}:`, aiResult?.error || "Unknown error");
    }
  } catch (err) {
    console.error(`[Category] Research failed for ${categoryName}:`, err);
  }
  
  return null;
}

/**
 * Get insights for a specific category
 */
export async function getCategoryInsights(categoryName) {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from("post_learning_patterns")
    .select("pattern_value, confidence_score, sample_size, last_calculated")
    .eq("pattern_type", "category_insight")
    .eq("pattern_key", categoryName)
    .single();
    
  if (error || !data) return null;
  
  return {
    ...data.pattern_value,
    confidence: data.confidence_score,
    sample_size: data.sample_size,
    last_updated: data.last_calculated
  };
}

/**
 * Get all category insights (for dashboard)
 */
export async function getAllCategoryInsights() {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from("post_learning_patterns")
    .select("pattern_key, pattern_value, confidence_score, sample_size, last_calculated")
    .eq("pattern_type", "category_insight")
    .order("sample_size", { ascending: false });
    
  if (error || !data) return [];
  
  return data.map(d => ({
    category: d.pattern_key,
    ...d.pattern_value,
    confidence: d.confidence_score,
    sample_size: d.sample_size,
    last_updated: d.last_calculated
  }));
}

// ============================================
// Constants & Best Practices (from research)
// ============================================

export const BEST_PRACTICES = {
  // Hashtag guidelines
  hashtags: {
    optimalCount: { min: 3, max: 5 },
    maxAllowed: 30,
    shouldIncludeBranded: true,
    brandedTag: "karrykraze",
    avoidGeneric: ["love", "instagood", "photooftheday", "follow", "like4like"],
    prioritizeNiche: true
  },
  
  // Caption guidelines
  caption: {
    optimalLength: { min: 100, max: 200 },
    maxLength: 2200,
    useEmojis: true,
    maxEmojis: 5,
    includeCTA: true,
    ctaExamples: [
      "Shop now", "Link in bio", "Tap to shop", "Check it out",
      "Don't miss out", "Grab yours", "Limited time"
    ],
    askQuestions: true,
    questionBoost: 0.15 // 15% boost to comments
  },
  
  // Timing guidelines (research-based, can be overridden by actual data)
  timing: {
    bestHours: [5, 6, 11, 12], // 5 AM, 6 AM, 11 AM, 12 PM
    bestDays: [1, 2, 3], // Monday, Tuesday, Wednesday
    worstDay: 6, // Saturday
    peakEngagementWindows: [
      { day: 1, hours: [5, 23] }, // Monday
      { day: 2, hours: [5] }, // Tuesday
      { day: 3, hours: [3, 4, 5] }, // Wednesday
      { day: 4, hours: [4, 5] }, // Thursday
      { day: 5, hours: [3, 4, 5, 6] }, // Friday
      { day: 6, hours: [5] }, // Saturday
      { day: 0, hours: [0, 5, 23] } // Sunday
    ]
  },
  
  // Engagement benchmarks
  engagement: {
    excellent: 5.0,
    good: 2.0,
    average: 1.0,
    poor: 0.5,
    savesImportance: "high", // Saves are key ranking signal
    sharesImportance: "highest", // Shares are top signal in 2026
    commentsValue: 3, // Comments worth ~3x likes
    savesValue: 5 // Saves worth ~5x likes
  },
  
  // Content type performance
  contentTypes: {
    carousel: { engagementBoost: 1.2, avgRate: 2.4 },
    reel: { reachBoost: 2.0, optimalLength: 90 }, // Under 90 seconds
    image: { baseline: 1.0 },
    story: { reachMultiplier: 0.5, bestForFollowers: true }
  }
};

// ============================================
// Analysis Functions
// ============================================

/**
 * Analyze a single post and generate insights
 */
export async function analyzePost(postId) {
  const supabase = getSupabaseClient();
  
  // Fetch post with all metrics
  const { data: post, error } = await supabase
    .from("social_posts")
    .select(`
      *,
      variation:social_variations(
        aspect_ratio,
        asset:social_assets(
          product:products(name, category_id)
        )
      )
    `)
    .eq("id", postId)
    .single();
    
  if (error || !post) {
    console.error("Failed to fetch post for analysis:", error);
    return null;
  }
  
  // Get all posts for comparison
  const { data: allPosts } = await supabase
    .from("social_posts")
    .select("likes, comments, saves, reach, engagement_rate, hashtags, caption, posted_at")
    .eq("status", "posted")
    .eq("platform", "instagram")
    .not("engagement_rate", "is", null);
    
  const avgMetrics = calculateAverages(allPosts || []);
  
  // Perform analysis
  const analysis = {
    postId,
    overall_score: 0,
    timing_score: analyzeTimingScore(post),
    caption_score: analyzeCaptionScore(post),
    hashtag_score: analyzeHashtagScore(post, allPosts),
    visual_score: 70, // Default, could use AI image analysis
    engagement_velocity_score: 70, // Would need historical tracking
    
    // Timing details
    posted_hour: post.posted_at ? new Date(post.posted_at).getHours() : null,
    posted_day_of_week: post.posted_at ? new Date(post.posted_at).getDay() : null,
    posted_day_name: post.posted_at ? getDayName(new Date(post.posted_at).getDay()) : null,
    is_weekend: post.posted_at ? [0, 6].includes(new Date(post.posted_at).getDay()) : null,
    
    // Caption details
    caption_length: (post.caption || "").length,
    has_cta: detectCTA(post.caption),
    has_emoji: detectEmojis(post.caption).length > 0,
    emoji_count: detectEmojis(post.caption).length,
    has_question: (post.caption || "").includes("?"),
    sentiment: detectSentiment(post.caption),
    
    // Hashtag details
    hashtag_count: (post.hashtags || []).length,
    branded_hashtag_used: (post.hashtags || []).some(h => 
      h.toLowerCase().includes("karrykraze")
    ),
    category_hashtags_used: categorizeHashtags(post.hashtags || []),
    
    // Comparison to average
    vs_avg_engagement_rate: avgMetrics.engagement_rate > 0 
      ? ((post.engagement_rate - avgMetrics.engagement_rate) / avgMetrics.engagement_rate * 100).toFixed(1)
      : 0,
    vs_avg_likes: avgMetrics.likes > 0 
      ? (((post.likes || 0) - avgMetrics.likes) / avgMetrics.likes * 100).toFixed(1)
      : 0,
    vs_avg_comments: avgMetrics.comments > 0
      ? (((post.comments || 0) - avgMetrics.comments) / avgMetrics.comments * 100).toFixed(1)
      : 0,
    vs_avg_saves: avgMetrics.saves > 0
      ? (((post.saves || 0) - avgMetrics.saves) / avgMetrics.saves * 100).toFixed(1)
      : 0,
    
    // Generated insights
    strengths: [],
    weaknesses: [],
    recommendations: []
  };
  
  // Calculate overall score (weighted average)
  analysis.overall_score = Math.round(
    analysis.timing_score * 0.2 +
    analysis.caption_score * 0.25 +
    analysis.hashtag_score * 0.2 +
    analysis.visual_score * 0.2 +
    analysis.engagement_velocity_score * 0.15
  );
  
  // Generate rule-based insights first
  generateInsights(analysis, post, avgMetrics);
  
  // Try AI-powered deep analysis
  if (USE_AI_ANALYSIS) {
    try {
      const aiAnalysis = await callAIFunction("analyze_post", {
        postData: {
          caption: post.caption,
          hashtags: post.hashtags || [],
          likes: post.likes || 0,
          comments: post.comments || 0,
          shares: post.shares || 0,
          saves: post.saves || 0,
          reach: post.reach || 0,
          posted_at: post.posted_at,
          product_name: post.variation?.asset?.product?.name
        },
        learningPatterns: {
          avg_engagement: avgMetrics.engagement_rate,
          best_time: BEST_PRACTICES.timing.bestHours[0],
          top_hashtags: await getTopHashtagsQuick()
        }
      });
      
      if (aiAnalysis && !aiAnalysis.error) {
        // Merge AI insights with rule-based analysis
        analysis.ai_analysis = aiAnalysis.analysis;
        analysis.ai_learnings = aiAnalysis.learnings || [];
        analysis.ai_recommendations = aiAnalysis.specific_recommendations || [];
        analysis.ai_overall_score = aiAnalysis.overall_score;
        analysis.ai_performance_tier = aiAnalysis.performance_tier;
        
        // Store AI learnings for future caption generation
        await storeLearnings(postId, aiAnalysis.learnings || []);
        
        console.log("✅ AI deep analysis completed for post", postId);
      }
    } catch (err) {
      console.warn("AI analysis failed, using rule-based only:", err);
    }
  }
  
  return analysis;
}

/**
 * Get top hashtags quickly (for AI context)
 */
async function getTopHashtagsQuick() {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("hashtag_performance")
    .select("hashtag")
    .order("avg_engagement_rate", { ascending: false })
    .limit(5);
  return data?.map(h => h.hashtag) || [];
}

/**
 * Store AI learnings for future use
 */
async function storeLearnings(postId, learnings) {
  if (!learnings || learnings.length === 0) return;
  
  const supabase = getSupabaseClient();
  
  for (const learning of learnings) {
    await supabase.from("post_learning_patterns").upsert({
      pattern_type: "ai_learning",
      pattern_key: learning.pattern?.substring(0, 100) || "general",
      pattern_value: {
        pattern: learning.pattern,
        evidence: learning.evidence,
        apply_to_future: learning.apply_to_future,
        source_post_id: postId,
        learned_at: new Date().toISOString()
      },
      confidence_score: 0.8,
      sample_size: 1
    }, { onConflict: "pattern_type,pattern_key" });
  }
}

/**
 * Analyze timing score (0-100)
 */
function analyzeTimingScore(post) {
  if (!post.posted_at) return 50;
  
  const date = new Date(post.posted_at);
  const hour = date.getHours();
  const day = date.getDay();
  
  let score = 50; // Base score
  
  // Check if posted during peak hours
  const peakWindow = BEST_PRACTICES.timing.peakEngagementWindows.find(w => w.day === day);
  if (peakWindow && peakWindow.hours.includes(hour)) {
    score += 30;
  } else if (BEST_PRACTICES.timing.bestHours.includes(hour)) {
    score += 20;
  }
  
  // Day of week bonus/penalty
  if (BEST_PRACTICES.timing.bestDays.includes(day)) {
    score += 15;
  } else if (day === BEST_PRACTICES.timing.worstDay) {
    score -= 15;
  }
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Analyze caption score (0-100)
 */
function analyzeCaptionScore(post) {
  const caption = post.caption || "";
  let score = 50;
  
  // Length check
  const len = caption.length;
  if (len >= BEST_PRACTICES.caption.optimalLength.min && 
      len <= BEST_PRACTICES.caption.optimalLength.max) {
    score += 20;
  } else if (len < 50) {
    score -= 10; // Too short
  } else if (len > 500) {
    score -= 5; // Might be too long
  }
  
  // CTA check
  if (detectCTA(caption)) {
    score += 15;
  }
  
  // Emoji check
  const emojis = detectEmojis(caption);
  if (emojis.length > 0 && emojis.length <= BEST_PRACTICES.caption.maxEmojis) {
    score += 10;
  } else if (emojis.length > BEST_PRACTICES.caption.maxEmojis) {
    score -= 5; // Too many emojis
  }
  
  // Question check (boosts comments)
  if (caption.includes("?")) {
    score += 10;
  }
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Analyze hashtag score (0-100)
 */
function analyzeHashtagScore(post, allPosts) {
  const hashtags = post.hashtags || [];
  let score = 50;
  
  // Count check
  const count = hashtags.length;
  if (count >= BEST_PRACTICES.hashtags.optimalCount.min && 
      count <= BEST_PRACTICES.hashtags.optimalCount.max) {
    score += 25;
  } else if (count === 0) {
    score -= 30; // No hashtags is bad
  } else if (count > 10) {
    score -= 10; // Too many can look spammy
  }
  
  // Branded hashtag check
  const hasBranded = hashtags.some(h => 
    h.toLowerCase().includes(BEST_PRACTICES.hashtags.brandedTag)
  );
  if (hasBranded) {
    score += 10;
  }
  
  // Check for generic/overused hashtags
  const genericCount = hashtags.filter(h => 
    BEST_PRACTICES.hashtags.avoidGeneric.includes(h.toLowerCase().replace("#", ""))
  ).length;
  if (genericCount > 0) {
    score -= genericCount * 3;
  }
  
  return Math.min(100, Math.max(0, score));
}

/**
 * Generate human-readable insights
 */
function generateInsights(analysis, post, avgMetrics) {
  const strengths = [];
  const weaknesses = [];
  const recommendations = [];
  
  // Engagement comparison
  const engRate = post.engagement_rate || 0;
  if (engRate >= BEST_PRACTICES.engagement.excellent) {
    strengths.push("🔥 Excellent engagement rate - this content resonated strongly with your audience");
  } else if (engRate >= BEST_PRACTICES.engagement.good) {
    strengths.push("✅ Good engagement rate - performing above average");
  } else if (engRate < BEST_PRACTICES.engagement.average && engRate > 0) {
    weaknesses.push("📉 Below average engagement - content may not be resonating");
    recommendations.push("Try testing different content types like carousels or Reels which typically get higher engagement");
  }
  
  // Timing insights
  if (analysis.timing_score >= 80) {
    strengths.push("⏰ Posted at an optimal time for engagement");
  } else if (analysis.timing_score < 50) {
    weaknesses.push("⏰ Posted at a suboptimal time");
    const bestTimes = BEST_PRACTICES.timing.bestHours.map(h => `${h}:00`).join(", ");
    recommendations.push(`Try posting during peak hours: ${bestTimes} (in your audience's timezone)`);
  }
  
  // Weekend penalty
  if (analysis.is_weekend) {
    weaknesses.push("📅 Posted on weekend - typically lower engagement");
    recommendations.push("Weekdays (especially Monday-Wednesday) tend to have higher engagement");
  }
  
  // Caption insights
  if (analysis.has_cta) {
    strengths.push("👆 Caption includes a call-to-action");
  } else {
    weaknesses.push("❌ No clear call-to-action in caption");
    recommendations.push("Add CTAs like 'Shop now', 'Link in bio', or 'Tap to see more' to drive action");
  }
  
  if (analysis.has_question) {
    strengths.push("❓ Caption asks a question - encourages comments");
  } else if ((post.comments || 0) < avgMetrics.comments) {
    recommendations.push("Try asking questions in your caption to boost comment engagement");
  }
  
  if (analysis.caption_length < 50) {
    weaknesses.push("📝 Caption is very short");
    recommendations.push("Expand your caption to 100-200 characters for optimal engagement");
  } else if (analysis.caption_length > 500) {
    recommendations.push("Consider shorter, punchier captions - users scroll quickly");
  }
  
  // Hashtag insights
  if (analysis.hashtag_count === 0) {
    weaknesses.push("🏷️ No hashtags used - missing discovery opportunity");
    recommendations.push("Add 3-5 relevant hashtags to improve discoverability");
  } else if (analysis.hashtag_count > BEST_PRACTICES.hashtags.optimalCount.max) {
    weaknesses.push(`🏷️ Too many hashtags (${analysis.hashtag_count}) - can appear spammy`);
    recommendations.push("Reduce to 3-5 highly relevant hashtags for better results");
  } else if (analysis.hashtag_count >= BEST_PRACTICES.hashtags.optimalCount.min) {
    strengths.push("🏷️ Optimal number of hashtags used");
  }
  
  if (!analysis.branded_hashtag_used) {
    recommendations.push("Include #KarryKraze in every post to build brand recognition");
  } else {
    strengths.push("🏷️ Branded hashtag included");
  }
  
  // Saves analysis (important signal)
  const saves = post.saves || 0;
  const likes = post.likes || 0;
  if (saves > 0 && likes > 0 && saves / likes >= 0.1) {
    strengths.push("🔖 High save rate - your content has lasting value");
  } else if (saves === 0 && likes > 5) {
    recommendations.push("Focus on creating save-worthy content: tips, tutorials, or valuable info people want to revisit");
  }
  
  // Shares analysis (top signal in 2026)
  const shares = post.shares || 0;
  if (shares > 0) {
    strengths.push(`📤 ${shares} shares - content is being spread! This is Instagram's top ranking signal`);
  } else if (likes > 10) {
    recommendations.push("Create more shareable content: relatable memes, useful tips, or funny posts people want to send to friends");
  }
  
  // Emoji insights
  if (analysis.emoji_count > 0 && analysis.emoji_count <= 5) {
    strengths.push("😊 Good use of emojis - adds personality");
  } else if (analysis.emoji_count > 5) {
    recommendations.push("Reduce emoji usage - 3-5 emojis is optimal");
  } else {
    recommendations.push("Add a few emojis to make your caption more engaging");
  }
  
  analysis.strengths = strengths;
  analysis.weaknesses = weaknesses;
  analysis.recommendations = recommendations;
}

// ============================================
// Learning Functions
// ============================================

/**
 * Update hashtag performance based on post data
 */
export async function updateHashtagPerformance() {
  const supabase = getSupabaseClient();
  
  // Get all posted Instagram posts with metrics
  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("id, hashtags, likes, comments, saves, reach, engagement_rate")
    .eq("status", "posted")
    .eq("platform", "instagram")
    .not("hashtags", "is", null);
    
  if (error || !posts) {
    console.error("Failed to fetch posts for hashtag analysis:", error);
    return;
  }
  
  // Aggregate hashtag performance
  const hashtagStats = {};
  
  posts.forEach(post => {
    (post.hashtags || []).forEach(tag => {
      const normalizedTag = tag.toLowerCase().replace("#", "");
      
      if (!hashtagStats[normalizedTag]) {
        hashtagStats[normalizedTag] = {
          hashtag: normalizedTag,
          times_used: 0,
          total_reach: 0,
          total_likes: 0,
          total_comments: 0,
          total_saves: 0,
          engagement_rates: [],
          best_post: { id: null, rate: 0 },
          worst_post: { id: null, rate: Infinity }
        };
      }
      
      const stats = hashtagStats[normalizedTag];
      stats.times_used++;
      stats.total_reach += post.reach || 0;
      stats.total_likes += post.likes || 0;
      stats.total_comments += post.comments || 0;
      stats.total_saves += post.saves || 0;
      stats.engagement_rates.push(post.engagement_rate || 0);
      
      if ((post.engagement_rate || 0) > stats.best_post.rate) {
        stats.best_post = { id: post.id, rate: post.engagement_rate || 0 };
      }
      if ((post.engagement_rate || 0) < stats.worst_post.rate) {
        stats.worst_post = { id: post.id, rate: post.engagement_rate || 0 };
      }
    });
  });
  
  // Upsert hashtag performance
  for (const [tag, stats] of Object.entries(hashtagStats)) {
    const avgEngRate = stats.engagement_rates.length > 0
      ? stats.engagement_rates.reduce((a, b) => a + b, 0) / stats.engagement_rates.length
      : 0;
    
    // Determine category
    let category = "general";
    if (tag === "karrykraze") category = "branded";
    else if (BEST_PRACTICES.hashtags.avoidGeneric.includes(tag)) category = "generic";
    
    await supabase.from("hashtag_performance").upsert({
      hashtag: tag,
      times_used: stats.times_used,
      total_reach: stats.total_reach,
      total_likes: stats.total_likes,
      total_comments: stats.total_comments,
      total_saves: stats.total_saves,
      avg_engagement_rate: avgEngRate.toFixed(2),
      best_performing_post_id: stats.best_post.id,
      worst_performing_post_id: stats.worst_post.id !== Infinity ? stats.worst_post.id : null,
      category,
      is_recommended: avgEngRate >= 2.0 && stats.times_used >= 3,
      updated_at: new Date().toISOString()
    }, { onConflict: "hashtag" });
  }
  
  console.log(`Updated performance for ${Object.keys(hashtagStats).length} hashtags`);
}

/**
 * Update posting time performance
 */
export async function updateTimingPerformance() {
  const supabase = getSupabaseClient();
  
  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("posted_at, reach, likes, comments, saves, engagement_rate")
    .eq("status", "posted")
    .eq("platform", "instagram")
    .not("posted_at", "is", null);
    
  if (error || !posts) {
    console.error("Failed to fetch posts for timing analysis:", error);
    return;
  }
  
  // Aggregate by hour and day
  const timeStats = {};
  
  posts.forEach(post => {
    const date = new Date(post.posted_at);
    const hour = date.getHours();
    const day = date.getDay();
    const key = `${hour}-${day}`;
    
    if (!timeStats[key]) {
      timeStats[key] = {
        hour_of_day: hour,
        day_of_week: day,
        total_posts: 0,
        total_reach: 0,
        total_engagement: 0,
        engagement_rates: []
      };
    }
    
    timeStats[key].total_posts++;
    timeStats[key].total_reach += post.reach || 0;
    timeStats[key].total_engagement += (post.likes || 0) + (post.comments || 0) + (post.saves || 0);
    timeStats[key].engagement_rates.push(post.engagement_rate || 0);
  });
  
  // Find peak times
  const allAvgRates = Object.values(timeStats).map(s => 
    s.engagement_rates.length > 0 
      ? s.engagement_rates.reduce((a, b) => a + b, 0) / s.engagement_rates.length 
      : 0
  );
  const overallAvg = allAvgRates.length > 0 
    ? allAvgRates.reduce((a, b) => a + b, 0) / allAvgRates.length 
    : 0;
  
  // Upsert timing performance
  for (const stats of Object.values(timeStats)) {
    const avgEngRate = stats.engagement_rates.length > 0
      ? stats.engagement_rates.reduce((a, b) => a + b, 0) / stats.engagement_rates.length
      : 0;
    
    await supabase.from("posting_time_performance").upsert({
      hour_of_day: stats.hour_of_day,
      day_of_week: stats.day_of_week,
      total_posts: stats.total_posts,
      total_reach: stats.total_reach,
      total_engagement: stats.total_engagement,
      avg_engagement_rate: avgEngRate.toFixed(2),
      is_peak_time: avgEngRate > overallAvg * 1.2 // 20% above average
    }, { onConflict: "hour_of_day,day_of_week" });
  }
  
  console.log(`Updated timing performance for ${Object.keys(timeStats).length} time slots`);
}

/**
 * Update caption element performance based on post engagement
 */
export async function updateCaptionPerformance(caption, engagementRate, reach, supabaseClient = null) {
  const supabase = supabaseClient || getSupabaseClient();
  
  if (!caption) return;
  
  // Analyze caption elements
  const captionLength = caption.length;
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]/u.test(caption);
  const hasCta = /shop now|link in bio|tap|click|get yours|buy now|order now|limited/i.test(caption);
  const hasQuestion = /\?/.test(caption);
  
  // Determine length range
  let lengthRange = 'short';
  if (captionLength > 300) lengthRange = 'long';
  else if (captionLength > 125) lengthRange = 'medium';
  
  // Update length range performance
  await supabase.from("caption_element_performance").upsert({
    element_type: 'length_range',
    element_value: lengthRange,
    times_used: 1,
    avg_engagement_rate: engagementRate
  }, { 
    onConflict: "element_type,element_value",
    ignoreDuplicates: false 
  });
  
  // Update CTA performance if present
  if (hasCta) {
    await supabase.from("caption_element_performance").upsert({
      element_type: 'cta',
      element_value: 'has_cta',
      times_used: 1,
      avg_engagement_rate: engagementRate
    }, { 
      onConflict: "element_type,element_value",
      ignoreDuplicates: false 
    });
  }
  
  // Update question performance if present
  if (hasQuestion) {
    await supabase.from("caption_element_performance").upsert({
      element_type: 'question',
      element_value: 'has_question',
      times_used: 1,
      avg_engagement_rate: engagementRate
    }, { 
      onConflict: "element_type,element_value",
      ignoreDuplicates: false 
    });
  }
  
  // Update emoji performance if present
  if (hasEmoji) {
    await supabase.from("caption_element_performance").upsert({
      element_type: 'emoji',
      element_value: 'has_emoji',
      times_used: 1,
      avg_engagement_rate: engagementRate
    }, { 
      onConflict: "element_type,element_value",
      ignoreDuplicates: false 
    });
  }
}

/**
 * Generate content recommendations based on learnings
 */
export async function generateRecommendations() {
  const supabase = getSupabaseClient();
  
  // First, deactivate old recommendations
  await supabase
    .from("content_recommendations")
    .update({ is_active: false })
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  
  // Get recent posts
  const { data: recentPosts } = await supabase
    .from("social_posts")
    .select("*")
    .eq("status", "posted")
    .eq("platform", "instagram")
    .order("posted_at", { ascending: false })
    .limit(30);
    
  if (!recentPosts || recentPosts.length < 3) {
    return []; // Not enough data
  }
  
  const recommendations = [];
  const avgEngRate = recentPosts.reduce((sum, p) => sum + (p.engagement_rate || 0), 0) / recentPosts.length;
  
  // Check hashtag consistency
  const postsWithOptimalHashtags = recentPosts.filter(p => {
    const count = (p.hashtags || []).length;
    return count >= 3 && count <= 5;
  }).length;
  
  if (postsWithOptimalHashtags / recentPosts.length < 0.5) {
    recommendations.push({
      recommendation_type: "weekly",
      category: "hashtags",
      priority: 1,
      title: "Optimize Hashtag Count",
      description: "Most of your recent posts don't have the optimal 3-5 hashtags. This is hurting your discoverability.",
      action_items: [
        "Use exactly 3-5 hashtags per post",
        "Always include #KarryKraze",
        "Mix branded, category, and niche hashtags"
      ],
      based_on_data: { postsWithOptimalHashtags, totalPosts: recentPosts.length },
      confidence: 0.8
    });
  }
  
  // Check CTA usage
  const postsWithCTA = recentPosts.filter(p => detectCTA(p.caption)).length;
  if (postsWithCTA / recentPosts.length < 0.6) {
    recommendations.push({
      recommendation_type: "weekly",
      category: "caption",
      priority: 2,
      title: "Add Calls-to-Action",
      description: "Less than 60% of your posts have clear CTAs. Adding CTAs can boost engagement and conversions.",
      action_items: [
        "Add 'Shop now' or 'Link in bio' to product posts",
        "Ask questions to encourage comments",
        "Use action verbs: Grab, Get, Shop, Discover"
      ],
      based_on_data: { postsWithCTA, totalPosts: recentPosts.length },
      confidence: 0.75
    });
  }
  
  // Check timing
  const weekendPosts = recentPosts.filter(p => {
    if (!p.posted_at) return false;
    const day = new Date(p.posted_at).getDay();
    return day === 0 || day === 6;
  }).length;
  
  if (weekendPosts / recentPosts.length > 0.3) {
    recommendations.push({
      recommendation_type: "weekly",
      category: "timing",
      priority: 3,
      title: "Shift to Weekday Posting",
      description: "You're posting a lot on weekends, which typically has lower engagement.",
      action_items: [
        "Schedule posts for Monday-Friday",
        "Best days are Monday-Wednesday",
        "Aim for 5 AM or 11 AM posting times"
      ],
      based_on_data: { weekendPosts, totalPosts: recentPosts.length },
      confidence: 0.7
    });
  }
  
  // Check saves performance
  const avgSaves = recentPosts.reduce((sum, p) => sum + (p.saves || 0), 0) / recentPosts.length;
  if (avgSaves < 1) {
    recommendations.push({
      recommendation_type: "weekly",
      category: "content",
      priority: 2,
      title: "Create More Saveable Content",
      description: "Your posts aren't getting many saves. Saves are a key ranking signal!",
      action_items: [
        "Create tip-based content people want to reference later",
        "Make how-to posts or styling guides",
        "Share valuable information worth bookmarking"
      ],
      based_on_data: { avgSaves },
      confidence: 0.85
    });
  }
  
  // Delete old recommendations and insert new ones (prevents duplicates)
  await supabase
    .from("content_recommendations")
    .delete()
    .eq("is_active", true);
  
  // Try AI-powered recommendations
  if (USE_AI_ANALYSIS && recentPosts.length >= 5) {
    try {
      // Get additional data for AI context
      const { data: topHashtags } = await supabase
        .from("hashtag_performance")
        .select("hashtag, avg_engagement_rate, times_used")
        .order("avg_engagement_rate", { ascending: false })
        .limit(10);
        
      const { data: bestTimes } = await supabase
        .from("posting_time_performance")
        .select("hour, day_of_week, avg_engagement_rate")
        .order("avg_engagement_rate", { ascending: false })
        .limit(5);
        
      const { data: patterns } = await supabase
        .from("post_learning_patterns")
        .select("pattern_type, pattern_key, pattern_value, confidence_score")
        .order("confidence_score", { ascending: false })
        .limit(10);
      
      const aiResult = await callAIFunction("recommendations", {
        performanceData: {
          avgEngagement: avgEngRate,
          topHashtags: topHashtags || [],
          bestTimes: bestTimes || [],
          recentPosts: recentPosts.slice(0, 10).map(p => ({
            caption: p.caption?.substring(0, 100),
            engagement: (p.likes || 0) + (p.comments || 0) * 3 + (p.saves || 0) * 5,
            posted_at: p.posted_at
          })),
          patterns: patterns?.reduce((acc, p) => {
            acc[p.pattern_key] = p.pattern_value;
            return acc;
          }, {}) || {}
        }
      });
      
      if (aiResult && !aiResult.error && aiResult.recommendations) {
        console.log("✅ AI generated smart recommendations");
        
        // Convert AI recommendations to our format
        for (const aiRec of aiResult.recommendations) {
          recommendations.push({
            recommendation_type: "ai_generated",
            category: aiRec.category || "general",
            priority: aiRec.priority || 3,
            title: aiRec.title,
            description: aiRec.description,
            action_items: aiRec.action_items || [],
            based_on_data: { 
              ai_source: true,
              expected_impact: aiRec.expected_impact,
              based_on: aiRec.based_on
            },
            confidence: 0.85
          });
        }
        
        // Store quick wins and patterns for future learning
        if (aiResult.patterns_identified) {
          for (const pattern of aiResult.patterns_identified) {
            await supabase.from("post_learning_patterns").upsert({
              pattern_type: "ai_insight",
              pattern_key: pattern.pattern?.substring(0, 50) || "general",
              pattern_value: {
                pattern: pattern.pattern,
                insight: pattern.insight,
                identified_at: new Date().toISOString()
              },
              confidence_score: 0.8,
              sample_size: recentPosts.length
            }, { onConflict: "pattern_type,pattern_key" });
          }
        }
        
        // Store content calendar suggestions
        if (aiResult.content_calendar_suggestions) {
          await supabase.from("post_learning_patterns").upsert({
            pattern_type: "ai_calendar",
            pattern_key: "content_calendar",
            pattern_value: aiResult.content_calendar_suggestions,
            confidence_score: 0.85,
            sample_size: recentPosts.length
          }, { onConflict: "pattern_type,pattern_key" });
        }
      }
    } catch (err) {
      console.warn("AI recommendations failed, using rule-based only:", err);
    }
  }
  
  // Insert all recommendations (rule-based + AI)
  for (const rec of recommendations) {
    await supabase.from("content_recommendations").insert({
      ...rec,
      is_active: true,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // Expires in 7 days
    });
  }
  
  console.log(`Generated ${recommendations.length} new recommendations`);
  return recommendations;
}

/**
 * Get best performing hashtags
 */
export async function getTopHashtags(limit = 10) {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from("hashtag_performance")
    .select("*")
    .gte("times_used", 1) // At least used once
    .order("avg_engagement_rate", { ascending: false })
    .limit(limit);
    
  return data || [];
}

/**
 * Get best posting times from actual data
 */
export async function getBestPostingTimes() {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from("posting_time_performance")
    .select("*")
    .order("avg_engagement_rate", { ascending: false });
    
  return data || [];
}

/**
 * Get active recommendations
 */
export async function getActiveRecommendations() {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from("content_recommendations")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(5);
    
  // Filter out expired ones in JS (since expires_at could be null)
  const now = new Date().toISOString();
  const filtered = (data || []).filter(r => !r.expires_at || r.expires_at > now);
    
  return filtered;
}

/**
 * Get learned patterns
 */
export async function getLearnedPatterns() {
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from("post_learning_patterns")
    .select("*")
    .order("confidence_score", { ascending: false });
    
  return data || [];
}

// ============================================
// Helper Functions
// ============================================

function calculateAverages(posts) {
  if (!posts || posts.length === 0) {
    return { likes: 0, comments: 0, saves: 0, reach: 0, engagement_rate: 0 };
  }
  
  const count = posts.length;
  return {
    likes: posts.reduce((sum, p) => sum + (p.likes || 0), 0) / count,
    comments: posts.reduce((sum, p) => sum + (p.comments || 0), 0) / count,
    saves: posts.reduce((sum, p) => sum + (p.saves || 0), 0) / count,
    reach: posts.reduce((sum, p) => sum + (p.reach || 0), 0) / count,
    engagement_rate: posts.reduce((sum, p) => sum + (p.engagement_rate || 0), 0) / count
  };
}

function detectCTA(caption) {
  if (!caption) return false;
  const lower = caption.toLowerCase();
  const ctaPatterns = [
    "shop now", "shop today", "link in bio", "tap to", "click link",
    "check out", "grab yours", "get yours", "don't miss", "limited time",
    "limited stock", "order now", "buy now", "available now", "shop the",
    "discover", "explore", "find out"
  ];
  return ctaPatterns.some(cta => lower.includes(cta));
}

function detectEmojis(text) {
  if (!text) return [];
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu;
  return text.match(emojiRegex) || [];
}

function detectSentiment(caption) {
  if (!caption) return "neutral";
  const lower = caption.toLowerCase();
  
  if (lower.includes("hurry") || lower.includes("limited") || lower.includes("last chance") || lower.includes("don't miss")) {
    return "urgency";
  }
  if (lower.includes("love") || lower.includes("amazing") || lower.includes("perfect") || lower.includes("favorite")) {
    return "positive";
  }
  return "neutral";
}

function categorizeHashtags(hashtags) {
  const categories = {
    branded: [],
    category: [],
    trending: [],
    niche: []
  };
  
  hashtags.forEach(tag => {
    const lower = tag.toLowerCase().replace("#", "");
    if (lower.includes("karrykraze")) {
      categories.branded.push(tag);
    } else if (["fashion", "style", "ootd", "jewelry", "accessories", "bags", "hats"].some(c => lower.includes(c))) {
      categories.category.push(tag);
    } else if (["trending", "viral", "fyp", "explore"].some(t => lower.includes(t))) {
      categories.trending.push(tag);
    } else {
      categories.niche.push(tag);
    }
  });
  
  return categories;
}

function getDayName(day) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day];
}

/**
 * Get AI tips for creating a new post based on learned patterns
 */
export async function getPostCreationTips() {
  const supabase = getSupabaseClient();
  
  const tips = {
    bestTime: "5 AM",
    bestDay: "Monday",
    hashtagCount: "3-5",
    topHashtags: ["karrykraze"],
    captionLength: 150,
    useCTA: true,
    useEmojis: true,
    askQuestion: true
  };
  
  try {
    // Get best posting times
    const { data: times } = await supabase
      .from("posting_time_performance")
      .select("*")
      .order("avg_engagement_rate", { ascending: false })
      .limit(5);
    
    if (times && times.length > 0) {
      const bestTime = times[0];
      tips.bestTime = formatTimeForDisplay(bestTime.hour_of_day);
      tips.bestDay = getDayName(bestTime.day_of_week);
    }
    
    // Get top hashtags
    const { data: hashtags } = await supabase
      .from("hashtag_performance")
      .select("hashtag, avg_engagement_rate")
      .gte("times_used", 1)
      .order("avg_engagement_rate", { ascending: false })
      .limit(5);
    
    if (hashtags && hashtags.length > 0) {
      tips.topHashtags = hashtags.map(h => h.hashtag);
    }
    
    // Get caption patterns
    const { data: patterns } = await supabase
      .from("post_learning_patterns")
      .select("*")
      .in("pattern_key", ["optimal_length", "use_cta", "use_emojis", "ask_questions"]);
    
    if (patterns) {
      const lengthPattern = patterns.find(p => p.pattern_key === "optimal_length");
      if (lengthPattern && lengthPattern.pattern_value) {
        tips.captionLength = lengthPattern.pattern_value.chars || 150;
      }
    }
    
  } catch (err) {
    console.error("Error getting post creation tips:", err);
  }
  
  return tips;
}

function formatTimeForDisplay(hour) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}
