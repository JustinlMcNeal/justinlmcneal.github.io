// supabase/functions/ai-generate/index.ts
// AI-powered caption, hashtag, and scoring generation using GPT-5-mini

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateRequest {
  type: "caption" | "hashtags" | "score" | "insights" | "analyze_post" | "recommendations" | "category_research";
  product?: {
    name: string;
    category: string;
    price?: number;
    description?: string;
  };
  tone?: string;
  platform?: string;
  caption?: string; // For scoring existing captions
  topPosts?: Array<{ caption: string; engagement: number; hashtags?: string[]; posted_at?: string }>; // Learning context
  learningPatterns?: Record<string, any>; // From post_learning_patterns
  // For deep post analysis
  postData?: {
    caption: string;
    hashtags: string[];
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    reach: number;
    posted_at: string;
    product_name?: string;
  };
  // For smart recommendations
  performanceData?: {
    avgEngagement: number;
    topHashtags: Array<{ hashtag: string; avg_engagement_rate: number }>;
    bestTimes: Array<{ hour: number; day_of_week: number; avg_engagement_rate: number }>;
    recentPosts: Array<{ caption: string; engagement: number; posted_at: string }>;
    patterns: Record<string, any>;
  };
  // For category research
  categoryData?: {
    categoryName: string;
    posts: Array<{
      caption: string;
      hashtags: string[];
      likes: number;
      comments: number;
      saves: number;
      shares: number;
      engagement_rate: number;
      posted_at: string;
      product_name: string;
    }>;
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const body: GenerateRequest = await req.json();
    const { type, product, tone, platform, caption, topPosts, learningPatterns, postData, performanceData, categoryData } = body;

    let prompt = "";
    let systemPrompt = "";

    // Build context from learning data
    const learningContext = buildLearningContext(learningPatterns, topPosts);

    switch (type) {
      case "caption":
        systemPrompt = buildCaptionSystemPrompt(learningContext);
        prompt = buildCaptionPrompt(product, tone, platform);
        break;

      case "hashtags":
        systemPrompt = buildHashtagSystemPrompt(learningContext);
        prompt = buildHashtagPrompt(product, platform);
        break;

      case "score":
        systemPrompt = buildScoreSystemPrompt();
        prompt = buildScorePrompt(caption, learningPatterns);
        break;

      case "insights":
        systemPrompt = buildInsightsSystemPrompt();
        prompt = buildInsightsPrompt(topPosts, learningPatterns);
        break;

      case "analyze_post":
        systemPrompt = buildAnalyzePostSystemPrompt();
        prompt = buildAnalyzePostPrompt(postData, learningPatterns);
        break;

      case "recommendations":
        systemPrompt = buildRecommendationsSystemPrompt();
        prompt = buildRecommendationsPrompt(performanceData);
        break;

      case "category_research":
        systemPrompt = buildCategoryResearchSystemPrompt();
        prompt = buildCategoryResearchPrompt(categoryData);
        break;

      default:
        throw new Error(`Unknown type: ${type}`);
    }

    // Call OpenAI API
    // Category research needs more tokens due to complex JSON output
    const maxTokens = type === "category_research" ? 2500 : 
                      type === "recommendations" ? 2000 :
                      type === "analyze_post" ? 1500 : 1000;
    
    // GPT-4o-mini: fast, reliable, cost-effective
    // (GPT-5-mini tested but returns empty responses)
    const model = "gpt-4o-mini";
    
    console.log(`[AI] Calling ${model} with ${maxTokens} max tokens for type: ${type}`);
    console.log(`[AI] Prompt length: ${prompt.length} chars`);
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    console.log("OpenAI Response:", JSON.stringify(data, null, 2));
    
    // GPT-5 models may have different response structure
    const content = data.choices?.[0]?.message?.content || 
                    data.output?.[0]?.content?.[0]?.text ||
                    data.choices?.[0]?.text || 
                    "";

    // Parse response based on type
    const result = parseResponse(type, content);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("AI Generate Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage, details: "Check Edge Function logs for more info" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================
// Learning Context Builder
// ============================================

function buildLearningContext(patterns?: Record<string, any>, topPosts?: Array<{ caption: string; engagement: number }>): string {
  let context = "";

  if (patterns) {
    // Handle new structured learning patterns
    const captionPatterns = patterns.caption_patterns || patterns;
    const captionLength = captionPatterns.optimal_length?.chars || 150;
    const useEmojis = captionPatterns.use_emojis?.recommended !== false;
    const useCTA = captionPatterns.use_cta?.recommended !== false;
    const hashtagCount = captionPatterns.optimal_count || { min: 3, max: 5 };

    context += `\nLEARNED PATTERNS FROM PAST PERFORMANCE:
- Optimal caption length: ${captionLength} characters
- Emojis: ${useEmojis ? "Increase engagement, use 2-4" : "Use sparingly"}
- Call-to-action: ${useCTA ? "Always include (e.g., 'Shop now', 'Link in bio')" : "Optional"}
- Hashtag count: ${hashtagCount.min}-${hashtagCount.max} hashtags work best
`;

    // Include AI-learned insights
    if (patterns.ai_learnings && patterns.ai_learnings.length > 0) {
      context += `\nAI-LEARNED INSIGHTS FROM POST ANALYSIS:
${patterns.ai_learnings.slice(0, 5).map((l: any, i: number) => {
        const advice = l.apply_to_future || l.insight || l.pattern;
        return `${i + 1}. ${advice}`;
      }).join("\n")}

IMPORTANT: Apply these learnings to create better captions. These are patterns that worked well in previous posts.
`;
    }

    // Include CATEGORY-SPECIFIC insights (this is the key learning!)
    if (patterns.category_insights) {
      const cat = patterns.category_insights;
      context += `\n🎯 CATEGORY-SPECIFIC INSIGHTS FOR "${cat.category || "this category"}":
Summary: ${cat.summary || "No summary available"}

Caption Strategy:
- Ideal length: ${cat.caption_strategy?.ideal_length || 150} characters
- Tone that works: ${cat.caption_strategy?.tone_that_works || "casual"}
- Opening styles: ${cat.caption_strategy?.best_opening_styles?.join(", ") || "question, emoji lead"}
- Effective CTAs: ${cat.caption_strategy?.effective_ctas?.join(", ") || "Shop now, Link in bio"}
- Emoji usage: ${cat.caption_strategy?.emoji_usage || "moderate"}
${cat.caption_strategy?.example_hooks?.length ? `- Proven hooks: "${cat.caption_strategy.example_hooks.join('", "')}"` : ""}

Key Insights:
${cat.key_insights?.slice(0, 3).map((i: any) => `• ${i.insight} → ${i.apply_how}`).join("\n") || "No specific insights yet"}

CRITICAL: Use these category-specific learnings! They are based on what actually worked for similar products.
`;
    }

    // Include content calendar suggestions
    if (patterns.content_calendar) {
      const cal = patterns.content_calendar;
      context += `\nCONTENT STRATEGY:
- Best days to post: ${cal.best_days?.join(", ") || "Monday-Wednesday"}
- Best times: ${cal.best_times?.join(", ") || "5 AM, 11 AM"}
- Content mix: ${JSON.stringify(cal.content_mix || {})}
`;
    }
  }

  if (topPosts && topPosts.length > 0) {
    context += `\nTOP PERFORMING CAPTIONS FOR REFERENCE:
${topPosts.slice(0, 3).map((p, i) => `${i + 1}. "${p.caption}" (engagement: ${p.engagement})`).join("\n")}
`;
  }

  return context;
}

// ============================================
// Caption Generation
// ============================================

function buildCaptionSystemPrompt(learningContext: string): string {
  return `You are a social media expert for Karry Kraze, a trendy fashion and accessories brand targeting Gen-Z and young millennials.

Your job is to write ONE engaging, scroll-stopping caption that drives engagement and sales.

Brand voice:
- Fun, trendy, relatable
- Uses emojis naturally (not overdone)
- Short, punchy sentences
- Includes call-to-action
- Feels authentic, not salesy

${learningContext}

CRITICAL: Output ONLY ONE caption. No numbering, no alternatives, no explanations. Just the caption text itself.`;
}

function buildCaptionPrompt(product?: { name: string; category: string; price?: number; description?: string }, tone?: string, platform?: string): string {
  const productInfo = product 
    ? `Product: ${product.name}\nCategory: ${product.category}${product.price ? `\nPrice: $${product.price}` : ""}${product.description ? `\nDescription: ${product.description}` : ""}`
    : "General brand post";

  const toneGuide = {
    casual: "friendly, conversational, like talking to a friend",
    professional: "polished, sophisticated, aspirational",
    urgency: "FOMO-inducing, limited time, act now energy",
    playful: "fun, quirky, uses trending phrases and humor",
    value: "deal-focused, savings-oriented, smart shopping",
    trending: "uses current trends, viral formats, relatable",
    minimal: "short, clean, aesthetic vibes",
    storytelling: "narrative-driven, emotional connection"
  };

  return `Write a ${platform || "Instagram"} caption for:

${productInfo}

Tone: ${toneGuide[tone as keyof typeof toneGuide] || toneGuide.casual}

Requirements:
- Under 150 characters if possible (or 2-3 short sentences max)
- Include 1-2 relevant emojis
- End with a call-to-action
- Make it unique and engaging`;
}

// ============================================
// Hashtag Generation
// ============================================

function buildHashtagSystemPrompt(learningContext: string): string {
  return `You are a social media hashtag expert for Karry Kraze, a trendy fashion brand.

Your job is to suggest the perfect hashtags that maximize reach while staying relevant.

Rules:
- Always include #karrykraze as the first hashtag
- Mix of: 1 branded, 2-3 niche/category, 1-2 trending
- Total: 3-5 hashtags only (research shows this is optimal)
- No spaces in hashtags
- All lowercase

${learningContext}

IMPORTANT: Return ONLY the hashtags, space-separated. No explanations.`;
}

function buildHashtagPrompt(product?: { name: string; category: string }, platform?: string): string {
  return `Generate hashtags for:

Product: ${product?.name || "General fashion post"}
Category: ${product?.category || "Fashion"}
Platform: ${platform || "Instagram"}

Return exactly 4-5 hashtags, space-separated, starting with #karrykraze`;
}

// ============================================
// Caption Scoring
// ============================================

function buildScoreSystemPrompt(): string {
  return `You are a social media analytics expert. Score captions based on engagement potential.

Return a JSON object with:
{
  "overall": 0-100,
  "breakdown": {
    "hook": 0-100,
    "clarity": 0-100,
    "cta": 0-100,
    "emoji": 0-100,
    "length": 0-100
  },
  "suggestions": ["improvement 1", "improvement 2"]
}

IMPORTANT: Return ONLY valid JSON, no markdown or explanations.`;
}

function buildScorePrompt(caption?: string, patterns?: Record<string, any>): string {
  return `Score this caption:

"${caption}"

Consider:
- Hook (first 5 words grab attention?)
- Clarity (message is clear?)
- CTA (has call-to-action?)
- Emoji usage (appropriate amount?)
- Length (optimal is ~150 chars)

Return JSON score.`;
}

// ============================================
// Insights Generation
// ============================================

function buildInsightsSystemPrompt(): string {
  return `You are a social media strategist. Analyze performance data and provide actionable insights.

Return a JSON object with:
{
  "insights": [
    { "title": "Insight Title", "description": "What we learned", "action": "What to do" }
  ],
  "recommendations": ["Quick tip 1", "Quick tip 2", "Quick tip 3"]
}

IMPORTANT: Return ONLY valid JSON.`;
}

function buildInsightsPrompt(topPosts?: Array<{ caption: string; engagement: number }>, patterns?: Record<string, any>): string {
  const postSummary = topPosts?.slice(0, 5).map(p => 
    `- "${p.caption.substring(0, 50)}..." (${p.engagement} engagement)`
  ).join("\n") || "No posts yet";

  return `Analyze this social media performance data and provide insights:

TOP PERFORMING POSTS:
${postSummary}

CURRENT PATTERNS:
${JSON.stringify(patterns || {}, null, 2)}

Provide 2-3 actionable insights and 3 quick recommendations.`;
}

// ============================================
// Response Parser
// ============================================

function parseResponse(type: string, content: string): any {
  switch (type) {
    case "caption":
      // Clean up caption - remove quotes if present
      return { 
        caption: content.replace(/^["']|["']$/g, "").trim() 
      };

    case "hashtags":
      // Parse hashtags into array
      const hashtags = content
        .split(/\s+/)
        .map(h => h.trim())
        .filter(h => h.startsWith("#"));
      return { hashtags };

    case "score":
    case "insights":
    case "analyze_post":
    case "recommendations":
    case "category_research":
      // Parse JSON response
      try {
        // Remove markdown code blocks if present
        const jsonStr = content.replace(/```json?\n?|\n?```/g, "").trim();
        return JSON.parse(jsonStr);
      } catch {
        return { error: "Failed to parse response", raw: content };
      }

    default:
      return { content };
  }
}

// ============================================
// Deep Post Analysis (AI-powered)
// ============================================

function buildAnalyzePostSystemPrompt(): string {
  return `You are a social media analytics expert for Karry Kraze, a fashion brand. Your job is to deeply analyze post performance and extract learnings.

Analyze posts to identify:
1. What worked well (content, timing, hashtags, caption style)
2. What could be improved
3. Patterns that drove engagement
4. Specific, actionable learnings to apply to future posts

Return a JSON object with:
{
  "overall_score": 0-100,
  "performance_tier": "exceptional" | "good" | "average" | "needs_improvement",
  "analysis": {
    "caption_analysis": {
      "score": 0-100,
      "strengths": ["what worked"],
      "weaknesses": ["what didn't work"],
      "key_elements": ["emoji usage", "CTA present", "question hook", etc.]
    },
    "hashtag_analysis": {
      "score": 0-100,
      "effective_hashtags": ["#tag1", "#tag2"],
      "underperforming_hashtags": ["#tag3"],
      "recommendations": ["suggestion"]
    },
    "timing_analysis": {
      "score": 0-100,
      "was_optimal": true/false,
      "reason": "why timing helped or hurt"
    },
    "content_analysis": {
      "score": 0-100,
      "appeal_factors": ["what made it appealing"],
      "improvement_areas": ["what could be better"]
    }
  },
  "learnings": [
    {
      "pattern": "identified pattern",
      "evidence": "data supporting this",
      "apply_to_future": "how to use this learning"
    }
  ],
  "specific_recommendations": ["actionable tip 1", "actionable tip 2", "actionable tip 3"]
}

CRITICAL: Return ONLY valid JSON. Be specific and data-driven in your analysis.`;
}

function buildAnalyzePostPrompt(postData?: any, patterns?: Record<string, any>): string {
  if (!postData) {
    return "No post data provided for analysis.";
  }

  const engagementRate = postData.reach > 0 
    ? ((postData.likes + postData.comments + postData.shares + postData.saves) / postData.reach * 100).toFixed(2)
    : "N/A";

  const postedDate = new Date(postData.posted_at);
  const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][postedDate.getDay()];
  const hour = postedDate.getHours();

  return `Analyze this Instagram post performance:

POST DATA:
- Caption: "${postData.caption}"
- Hashtags: ${postData.hashtags?.join(" ") || "None"}
- Product: ${postData.product_name || "Unknown"}
- Posted: ${dayOfWeek} at ${hour}:00

ENGAGEMENT METRICS:
- Likes: ${postData.likes}
- Comments: ${postData.comments}
- Shares: ${postData.shares}
- Saves: ${postData.saves}
- Reach: ${postData.reach}
- Engagement Rate: ${engagementRate}%

HISTORICAL CONTEXT:
${patterns ? `
- Average engagement: ${patterns.avg_engagement || "Unknown"}
- Best performing time: ${patterns.best_time || "Unknown"}
- Top hashtags historically: ${patterns.top_hashtags?.join(", ") || "Unknown"}
` : "No historical data available"}

Provide deep analysis with specific learnings we can apply to future posts.`;
}

// ============================================
// Smart Recommendations (AI-powered)
// ============================================

function buildRecommendationsSystemPrompt(): string {
  return `You are a strategic social media advisor for Karry Kraze, a trendy fashion brand. Analyze performance data and provide personalized, actionable recommendations.

Your recommendations should be:
1. Specific to their actual data (not generic advice)
2. Prioritized by potential impact
3. Immediately actionable
4. Based on identified patterns

Return a JSON object with:
{
  "recommendations": [
    {
      "title": "Clear, action-oriented title",
      "description": "Why this matters based on their data",
      "priority": 1-5 (1 = most urgent),
      "category": "timing" | "content" | "hashtags" | "engagement" | "strategy",
      "action_items": ["step 1", "step 2", "step 3"],
      "expected_impact": "What improvement to expect",
      "based_on": "The specific data point this comes from"
    }
  ],
  "quick_wins": [
    "Easy thing they can do today 1",
    "Easy thing they can do today 2"
  ],
  "patterns_identified": [
    {
      "pattern": "What we noticed",
      "insight": "What it means"
    }
  ],
  "content_calendar_suggestions": {
    "best_days": ["Monday", "Wednesday"],
    "best_times": ["5 AM", "11 AM"],
    "posting_frequency": "recommended posts per week",
    "content_mix": {
      "product_posts": "40%",
      "lifestyle": "30%",
      "engagement_posts": "20%",
      "promotional": "10%"
    }
  }
}

CRITICAL: Return ONLY valid JSON. Make recommendations specific to their data, not generic.`;
}

function buildRecommendationsPrompt(performanceData?: any): string {
  if (!performanceData) {
    return "No performance data provided for recommendations.";
  }

  const { avgEngagement, topHashtags, bestTimes, recentPosts, patterns } = performanceData;

  const topHashtagsList = topHashtags?.slice(0, 5).map((h: any) => 
    `  - ${h.hashtag}: ${(h.avg_engagement_rate * 100).toFixed(1)}% engagement`
  ).join("\n") || "  No hashtag data";

  const bestTimesList = bestTimes?.slice(0, 3).map((t: any) => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `  - ${days[t.day_of_week]} ${t.hour}:00: ${(t.avg_engagement_rate * 100).toFixed(1)}% engagement`;
  }).join("\n") || "  No timing data";

  const recentPostsList = recentPosts?.slice(0, 5).map((p: any) =>
    `  - "${p.caption?.substring(0, 40)}..." (${p.engagement} engagement)`
  ).join("\n") || "  No recent posts";

  return `Generate personalized recommendations based on this performance data:

OVERALL PERFORMANCE:
- Average Engagement Rate: ${(avgEngagement * 100).toFixed(1)}%
- Total Posts Analyzed: ${recentPosts?.length || 0}

TOP PERFORMING HASHTAGS:
${topHashtagsList}

BEST POSTING TIMES:
${bestTimesList}

RECENT POSTS:
${recentPostsList}

IDENTIFIED PATTERNS:
${JSON.stringify(patterns || {}, null, 2)}

Based on this data, provide 3-5 specific, prioritized recommendations that will improve their social media performance. Focus on what's actually working/not working in their data.`;
}

// ============================================
// Category Research (AI-powered)
// ============================================

function buildCategoryResearchSystemPrompt(): string {
  return `You are a social media strategist analyzing posts for a specific product category at Karry Kraze, a trendy fashion brand.

Your job is to deeply analyze all posts in this category and extract actionable insights that will improve future posts.

Research and identify:
1. What makes posts in this category successful
2. Which captions styles work best
3. Which hashtags drive the most engagement
4. Best timing patterns for this category
5. Content themes that resonate
6. Specific language and emojis that work

Return a JSON object with:
{
  "category": "category name",
  "total_posts_analyzed": number,
  "avg_engagement_rate": number,
  "summary": "2-3 sentence summary of what works for this category",
  "key_insights": [
    {
      "insight": "Clear observation",
      "evidence": "Data supporting this",
      "impact": "high" | "medium" | "low",
      "apply_how": "How to use this in future posts"
    }
  ],
  "caption_strategy": {
    "ideal_length": number,
    "best_opening_styles": ["question", "statement", "emoji lead", etc.],
    "effective_ctas": ["Shop now", "Link in bio", etc.],
    "tone_that_works": "playful" | "minimal" | "urgency" | etc.,
    "emoji_usage": "none" | "minimal" | "moderate" | "heavy",
    "example_hooks": ["hook 1", "hook 2", "hook 3"]
  },
  "hashtag_strategy": {
    "top_performers": ["#tag1", "#tag2", "#tag3"],
    "avoid": ["#generic1"],
    "category_specific": ["#niche1", "#niche2"],
    "ideal_count": number
  },
  "timing_insights": {
    "best_days": ["Monday", "Wednesday"],
    "best_hours": [5, 11],
    "avoid": ["Saturday afternoon"]
  },
  "visual_notes": "What types of images/styles work best",
  "improvement_opportunities": [
    "Specific thing to try",
    "Another opportunity"
  ]
}

CRITICAL: 
- Return ONLY valid JSON
- Be SPECIFIC to this category's data, not generic advice
- Focus on patterns you actually see in the data
- If data is limited, acknowledge that and still provide best-guess insights`;
}

function buildCategoryResearchPrompt(categoryData?: any): string {
  if (!categoryData || !categoryData.posts || categoryData.posts.length === 0) {
    return "No category data provided for research.";
  }

  const { categoryName, posts } = categoryData;
  
  // Calculate category stats
  const avgEngagement = posts.reduce((sum: number, p: any) => sum + (p.engagement_rate || 0), 0) / posts.length;
  const topPosts = [...posts].sort((a: any, b: any) => (b.engagement_rate || 0) - (a.engagement_rate || 0)).slice(0, 5);
  const bottomPosts = [...posts].sort((a: any, b: any) => (a.engagement_rate || 0) - (b.engagement_rate || 0)).slice(0, 3);
  
  // Analyze hashtags
  const hashtagCounts: Record<string, { count: number; totalEngagement: number }> = {};
  posts.forEach((p: any) => {
    (p.hashtags || []).forEach((h: string) => {
      if (!hashtagCounts[h]) hashtagCounts[h] = { count: 0, totalEngagement: 0 };
      hashtagCounts[h].count++;
      hashtagCounts[h].totalEngagement += p.engagement_rate || 0;
    });
  });
  
  const topHashtags = Object.entries(hashtagCounts)
    .map(([tag, data]) => ({ tag, ...data, avgEng: data.totalEngagement / data.count }))
    .sort((a, b) => b.avgEng - a.avgEng)
    .slice(0, 10);

  return `Research and analyze posts in the "${categoryName}" category:

CATEGORY OVERVIEW:
- Total Posts: ${posts.length}
- Average Engagement Rate: ${(avgEngagement * 100).toFixed(2)}%

TOP 5 PERFORMING POSTS:
${topPosts.map((p: any, i: number) => `
${i + 1}. "${p.caption?.substring(0, 80)}..."
   Product: ${p.product_name || "Unknown"}
   Engagement: ${((p.engagement_rate || 0) * 100).toFixed(1)}%
   Likes: ${p.likes} | Comments: ${p.comments} | Saves: ${p.saves}
   Hashtags: ${(p.hashtags || []).join(" ")}
   Posted: ${p.posted_at ? new Date(p.posted_at).toLocaleString() : "Unknown"}
`).join("\n")}

BOTTOM 3 PERFORMING POSTS (what to avoid):
${bottomPosts.map((p: any, i: number) => `
${i + 1}. "${p.caption?.substring(0, 60)}..."
   Engagement: ${((p.engagement_rate || 0) * 100).toFixed(1)}%
   Hashtags: ${(p.hashtags || []).join(" ")}
`).join("\n")}

TOP HASHTAGS BY ENGAGEMENT:
${topHashtags.map(h => `- ${h.tag}: used ${h.count}x, avg ${(h.avgEng * 100).toFixed(1)}% engagement`).join("\n")}

ALL CAPTIONS FOR PATTERN ANALYSIS:
${posts.map((p: any) => `- "${p.caption?.substring(0, 100)}..." (${((p.engagement_rate || 0) * 100).toFixed(1)}%)`).join("\n")}

Analyze this data and provide specific insights for creating better ${categoryName} posts.`;
}
