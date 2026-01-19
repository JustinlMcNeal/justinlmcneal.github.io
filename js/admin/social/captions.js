// /js/admin/social/captions.js
// Caption generation and hashtag utilities with AI + learning

import { fetchTemplates, getHashtagsForCategory } from "./api.js";
import { getSupabaseClient } from "../../shared/supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config/env.js";

// Get supabase client
const supabase = getSupabaseClient();

// Cache templates
let templateCache = null;
let learningPatternsCache = null;

// AI Feature flag - set to true once Edge Function is deployed
const USE_AI_GENERATION = true;

/**
 * Load all caption templates
 */
export async function loadTemplates() {
  if (!templateCache) {
    templateCache = await fetchTemplates();
  }
  return templateCache;
}

/**
 * Clear template cache (call after adding/editing templates)
 */
export function clearTemplateCache() {
  templateCache = null;
}

/**
 * Get a random template for a given tone
 */
export async function getRandomTemplate(tone = "casual") {
  const templates = await loadTemplates();
  const filtered = templates.filter(t => t.tone === tone);
  
  if (!filtered.length) {
    // Fallback to any template
    return templates[Math.floor(Math.random() * templates.length)];
  }
  
  return filtered[Math.floor(Math.random() * filtered.length)];
}

/**
 * Get all templates for a given tone
 */
export async function getTemplatesForTone(tone) {
  const templates = await loadTemplates();
  return templates.filter(t => t.tone === tone);
}

/**
 * Fill template placeholders with product data
 */
export function fillTemplate(template, data = {}) {
  let result = template;
  
  // Support both snake_case and camelCase property names
  const placeholders = {
    "{product_name}": data.product_name || data.productName || "this item",
    "{category}": data.category || "collection",
    "{link}": data.link || "",
    "{price}": data.price ? `$${data.price}` : "",
    "{code}": data.code || ""
  };
  
  Object.entries(placeholders).forEach(([key, value]) => {
    result = result.replace(new RegExp(key, "gi"), value);
  });
  
  return result;
}

/**
 * Generate a caption - NOW USES AI (GPT-5-mini)
 * Priority: 1) AI generation, 2) Template fallback
 */
export async function generateCaption(tone, productData = {}, platform = "instagram") {
  // Try AI generation first
  if (USE_AI_GENERATION) {
    try {
      const aiCaption = await generateAICaption(tone, productData, platform);
      if (aiCaption) {
        console.log('[Caption AI] Generated unique caption via GPT-5-mini');
        return aiCaption;
      }
    } catch (error) {
      console.warn('[Caption AI] AI generation failed, falling back to templates:', error.message);
    }
  }
  
  // Fall back to template-based generation
  const template = await getRandomTemplate(tone);
  if (!template) {
    return `Check out our latest drop! Shop now at karrykraze.com`;
  }
  
  return fillTemplate(template.template, productData);
}

/**
 * Generate caption using OpenAI GPT-5-mini via Edge Function
 * Now includes AI learnings from past post analysis AND category insights
 */
async function generateAICaption(tone, productData, platform) {
  // Get all learning patterns including AI-generated insights
  const patterns = await getLearningPatterns();
  
  // Build learning context for AI
  const learningPatterns = {
    caption_patterns: {},
    ai_learnings: [],
    content_calendar: null,
    category_insights: null
  };
  
  // Get category-specific insights if available
  const categoryName = productData.category || 'fashion';
  const categoryInsight = patterns.find(
    p => p.pattern_type === 'category_insight' && p.pattern_key === categoryName
  );
  
  if (categoryInsight && categoryInsight.pattern_value) {
    learningPatterns.category_insights = categoryInsight.pattern_value;
    console.log(`[Caption AI] Using category insights for "${categoryName}"`);
  }
  
  patterns.forEach(p => {
    if (p.pattern_type === 'caption') {
      learningPatterns.caption_patterns[p.pattern_key] = p.pattern_value;
    } else if (p.pattern_type === 'ai_learning' && p.pattern_value) {
      // These are insights learned from analyzing past posts
      learningPatterns.ai_learnings.push({
        pattern: p.pattern_value.pattern,
        apply_to_future: p.pattern_value.apply_to_future,
        confidence: p.confidence_score
      });
    } else if (p.pattern_type === 'ai_insight' && p.pattern_value) {
      learningPatterns.ai_learnings.push({
        pattern: p.pattern_value.pattern,
        insight: p.pattern_value.insight
      });
    } else if (p.pattern_type === 'ai_calendar' && p.pattern_key === 'content_calendar') {
      learningPatterns.content_calendar = p.pattern_value;
    }
  });
  
  // Get top performing posts for context
  const topPosts = await getTopPerformingCaptions(productData.category, 5);
  
  console.log('[Caption AI] Using', learningPatterns.ai_learnings.length, 'AI learnings for generation');
  if (learningPatterns.category_insights) {
    console.log('[Caption AI] Category strategy:', learningPatterns.category_insights.caption_strategy?.tone_that_works || 'not specified');
  }
  
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      type: 'caption',
      product: {
        name: productData.productName || productData.product_name || 'this item',
        category: productData.category || 'fashion',
        price: productData.price,
        description: productData.description,
      },
      tone,
      platform,
      learningPatterns,
      topPosts: topPosts.map(c => ({ caption: c, engagement: 100 })),
    }),
  });
  
  if (!response.ok) {
    throw new Error(`AI API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.caption;
}

/**
 * Generate a caption by learning from top performing posts
 */
async function generateLearnedCaption(tone, productData = {}) {
  try {
    // Get caption patterns from learning data
    const patterns = await getLearningPatterns();
    const captionPatterns = patterns.filter(p => p.pattern_type === 'caption');
    
    // Get settings
    const optimalLength = captionPatterns.find(p => p.pattern_key === 'optimal_length')?.pattern_value?.chars || 150;
    const useEmojis = captionPatterns.find(p => p.pattern_key === 'use_emojis')?.pattern_value?.recommended !== false;
    const useCTA = captionPatterns.find(p => p.pattern_key === 'use_cta')?.pattern_value?.recommended !== false;
    const useQuestion = captionPatterns.find(p => p.pattern_key === 'ask_questions')?.pattern_value?.recommended !== false;
    
    // Get top performing captions from similar posts
    const topCaptions = await getTopPerformingCaptions(productData.category, 5);
    
    if (topCaptions.length === 0) {
      return null; // Fall back to template
    }
    
    // Analyze patterns from top captions
    const captionElements = analyzeCaptionElements(topCaptions);
    
    // Build a new caption inspired by top performers
    let caption = buildLearnedCaption(captionElements, tone, productData, {
      optimalLength,
      useEmojis,
      useCTA,
      useQuestion
    });
    
    console.log(`[Caption AI] Generated learned caption (${caption.length} chars)`);
    return caption;
    
  } catch (e) {
    console.log('[Caption AI] Learning failed, using templates:', e.message);
    return null;
  }
}

/**
 * Get top performing captions from past posts
 */
async function getTopPerformingCaptions(category, limit = 5) {
  try {
    let query = supabase
      .from('social_posts')
      .select(`
        caption,
        metrics,
        product:products(category_id, categories(name))
      `)
      .not('metrics', 'is', null)
      .not('caption', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);
    
    const { data, error } = await query;
    if (error) throw error;
    
    // Filter and sort by engagement
    const withEngagement = (data || [])
      .filter(p => p.caption && p.metrics)
      .map(p => ({
        caption: p.caption,
        engagement: (p.metrics.likes || 0) + (p.metrics.comments || 0) * 3 + (p.metrics.saves || 0) * 5,
        category: p.product?.categories?.name
      }))
      .sort((a, b) => b.engagement - a.engagement);
    
    // Prefer same category, but include others too
    const sameCategory = withEngagement.filter(p => p.category === category);
    const others = withEngagement.filter(p => p.category !== category);
    
    return [...sameCategory, ...others].slice(0, limit).map(p => p.caption);
    
  } catch (e) {
    console.log('[Caption AI] Could not load top captions:', e.message);
    return [];
  }
}

/**
 * Analyze patterns from successful captions
 */
function analyzeCaptionElements(captions) {
  const elements = {
    openingHooks: [],
    ctaPhrases: [],
    emojis: [],
    avgLength: 0,
    hasQuestion: false,
    commonWords: {}
  };
  
  captions.forEach(caption => {
    // Extract opening hook (first sentence)
    const firstSentence = caption.split(/[.!?\n]/)[0]?.trim();
    if (firstSentence && firstSentence.length < 60) {
      elements.openingHooks.push(firstSentence);
    }
    
    // Find CTA phrases
    const ctaPatterns = [
      /shop now/gi, /link in bio/gi, /tap to shop/gi, /get yours/gi,
      /order now/gi, /limited time/gi, /don't miss/gi, /check out/gi
    ];
    ctaPatterns.forEach(pattern => {
      const match = caption.match(pattern);
      if (match) elements.ctaPhrases.push(match[0]);
    });
    
    // Extract emojis
    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    const emojis = caption.match(emojiPattern) || [];
    elements.emojis.push(...emojis);
    
    // Check for questions
    if (caption.includes('?')) elements.hasQuestion = true;
    
    // Track length
    elements.avgLength += caption.length;
  });
  
  elements.avgLength = Math.round(elements.avgLength / captions.length);
  
  // Get unique emojis sorted by frequency
  elements.emojis = [...new Set(elements.emojis)].slice(0, 5);
  
  return elements;
}

/**
 * Build a new caption from learned elements
 */
function buildLearnedCaption(elements, tone, productData, settings) {
  const productName = productData.productName || productData.product_name || 'this piece';
  const category = productData.category || 'collection';
  
  // Tone-specific openers
  const toneOpeners = {
    casual: [`Obsessed with ${productName}!`, `New in: ${productName} ✨`, `Meet your new fave!`],
    professional: [`Introducing ${productName}`, `Now available: ${productName}`, `Elevate your style with ${productName}`],
    urgency: [`🚨 Just dropped: ${productName}!`, `Don't sleep on ${productName}!`, `Going fast: ${productName}!`],
    playful: [`${productName} is giving everything! 💅`, `POV: You just found ${productName}`, `It's giving ${category} vibes ✨`],
    value: [`${productName} at an unbeatable price!`, `Best value: ${productName}`, `Smart choice: ${productName}`],
    trending: [`${productName} is trending NOW 📈`, `Everyone's asking about ${productName}!`, `Viral alert: ${productName} 🔥`]
  };
  
  // Pick opener
  const openers = toneOpeners[tone] || toneOpeners.casual;
  let caption = openers[Math.floor(Math.random() * openers.length)];
  
  // Add emojis if recommended
  if (settings.useEmojis && elements.emojis.length > 0) {
    const randomEmoji = elements.emojis[Math.floor(Math.random() * elements.emojis.length)];
    if (!caption.includes(randomEmoji)) {
      caption = caption.replace(/[!.]$/, ` ${randomEmoji}`);
    }
  }
  
  // Add middle content
  const middles = [
    `Perfect for your ${category} rotation.`,
    `A must-have for your wardrobe.`,
    `Style it your way.`,
    `Made for those who stand out.`
  ];
  caption += ' ' + middles[Math.floor(Math.random() * middles.length)];
  
  // Add question if recommended
  if (settings.useQuestion && Math.random() > 0.5) {
    const questions = [
      'Would you rock this?',
      'Adding to cart?',
      'What do you think?',
      'Which color is your fave?'
    ];
    caption += ' ' + questions[Math.floor(Math.random() * questions.length)];
  }
  
  // Add CTA if recommended
  if (settings.useCTA) {
    const ctas = elements.ctaPhrases.length > 0 
      ? elements.ctaPhrases 
      : ['Shop now!', 'Link in bio 🔗', 'Tap to shop!'];
    caption += '\n\n' + ctas[Math.floor(Math.random() * ctas.length)];
  }
  
  // Trim to optimal length if too long
  if (caption.length > settings.optimalLength * 1.5) {
    // Remove middle content to shorten
    const parts = caption.split('\n\n');
    caption = parts[0].split('.').slice(0, 2).join('.') + '.\n\n' + (parts[1] || 'Shop now!');
  }
  
  return caption;
}

/**
 * Get hashtags for a product - NOW USES AI (GPT-5-mini)
 * Priority: 1) AI generation, 2) Category + learning patterns fallback
 */
export async function getHashtagsForProduct(product, platform = "instagram") {
  // Try AI generation first
  if (USE_AI_GENERATION) {
    try {
      const aiHashtags = await generateAIHashtags(product, platform);
      if (aiHashtags && aiHashtags.length > 0) {
        console.log('[Hashtags AI] Generated unique hashtags via GPT-5-mini:', aiHashtags);
        return aiHashtags;
      }
    } catch (error) {
      console.warn('[Hashtags AI] AI generation failed, falling back:', error.message);
    }
  }
  
  // Fallback to pattern-based generation
  return getHashtagsFallback(product);
}

/**
 * Generate hashtags using OpenAI GPT-5-mini via Edge Function
 */
async function generateAIHashtags(product, platform) {
  // Get learning patterns for context
  const patterns = await getLearningPatterns();
  const learningPatterns = {};
  patterns.forEach(p => {
    if (p.pattern_type === 'hashtag') {
      learningPatterns[p.pattern_key] = p.pattern_value;
    }
  });
  
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      type: 'hashtags',
      product: product ? {
        name: product.name || 'fashion item',
        category: product.category?.name || 'fashion',
      } : null,
      platform,
      learningPatterns,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`AI API error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.hashtags;
}

/**
 * Fallback hashtag generation using patterns
 */
async function getHashtagsFallback(product) {
  // Get optimal hashtag count from learning patterns
  const patterns = await getLearningPatterns();
  const hashtagPattern = patterns.find(p => p.pattern_key === 'optimal_count');
  const minHashtags = hashtagPattern?.pattern_value?.min || 3;
  const maxHashtags = hashtagPattern?.pattern_value?.max || 5;
  
  let allHashtags = ["#karrykraze"];
  
  if (!product) {
    allHashtags.push("#fashion", "#style", "#shopnow");
  } else {
    // Get category name from product
    let categoryName = null;
    let categoryId = product.category_id;
    
    if (product.category?.name) {
      categoryName = product.category.name;
    }
    
    const categoryHashtags = await getHashtagsForCategory(categoryId, categoryName);
    allHashtags = [...new Set([...allHashtags, ...categoryHashtags])];
  }
  
  // Get top performing hashtags from learning data
  const topHashtags = await getTopPerformingHashtags(3);
  if (topHashtags.length > 0) {
    // Add top performers, avoiding duplicates
    topHashtags.forEach(tag => {
      if (!allHashtags.some(h => h.toLowerCase() === tag.toLowerCase())) {
        allHashtags.push(tag);
      }
    });
  }
  
  // ENFORCE the learned optimal count (3-5 by default)
  // Always keep #karrykraze first, then pick best performers
  const branded = allHashtags.filter(h => h.toLowerCase() === '#karrykraze');
  const others = allHashtags.filter(h => h.toLowerCase() !== '#karrykraze');
  
  // Limit to max hashtags
  const limited = [...branded, ...others.slice(0, maxHashtags - 1)];
  
  console.log(`[Hashtags] Applied learning pattern: ${minHashtags}-${maxHashtags} hashtags. Result: ${limited.length}`);
  
  return limited;
}

/**
 * Get learning patterns from database
 */
async function getLearningPatterns() {
  if (learningPatternsCache) return learningPatternsCache;
  
  try {
    const { data, error } = await supabase
      .from('post_learning_patterns')
      .select('*');
    
    if (error) throw error;
    learningPatternsCache = data || [];
    return learningPatternsCache;
  } catch (e) {
    console.log('[Learning] Could not load patterns:', e.message);
    return [];
  }
}

/**
 * Get top performing hashtags from hashtag_performance table
 */
async function getTopPerformingHashtags(limit = 5) {
  try {
    const { data, error } = await supabase
      .from('hashtag_performance')
      .select('hashtag, avg_engagement_rate')
      .eq('is_recommended', true)
      .order('avg_engagement_rate', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return (data || []).map(h => h.hashtag);
  } catch (e) {
    console.log('[Hashtags] Could not load top performers:', e.message);
    return [];
  }
}

/**
 * Clear patterns cache (call when patterns are updated)
 */
export function clearLearningCache() {
  learningPatternsCache = null;
}

/**
 * Score a caption using AI
 * Returns: { overall: 0-100, breakdown: {...}, suggestions: [...] }
 */
export async function scoreCaption(caption) {
  if (!USE_AI_GENERATION || !caption) {
    return null;
  }
  
  try {
    const patterns = await getLearningPatterns();
    const learningPatterns = {};
    patterns.forEach(p => {
      learningPatterns[p.pattern_key] = p.pattern_value;
    });
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        type: 'score',
        caption,
        learningPatterns,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('[Score AI] Failed to score caption:', error);
    return null;
  }
}

/**
 * Get AI-powered insights based on post performance
 */
export async function getAIInsights() {
  if (!USE_AI_GENERATION) {
    return null;
  }
  
  try {
    const patterns = await getLearningPatterns();
    const topPosts = await getTopPerformingCaptions(null, 5);
    
    const learningPatterns = {};
    patterns.forEach(p => {
      learningPatterns[`${p.pattern_type}_${p.pattern_key}`] = p.pattern_value;
    });
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        type: 'insights',
        topPosts: topPosts.map(c => ({ caption: c, engagement: 100 })),
        learningPatterns,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('[Insights AI] Failed to get insights:', error);
    return null;
  }
}

/**
 * Format hashtags as a string
 */
export function formatHashtags(hashtags) {
  if (!hashtags || !hashtags.length) return "";
  return hashtags.join(" ");
}

/**
 * Parse hashtag string back to array
 */
export function parseHashtags(hashtagString) {
  if (!hashtagString) return [];
  
  return hashtagString
    .split(/\s+/)
    .map(tag => tag.trim())
    .filter(tag => tag.startsWith("#"))
    .map(tag => tag.toLowerCase());
}

/**
 * Ensure #karrykraze is always included
 */
export function ensureKarryKrazeTag(hashtags) {
  const tags = Array.isArray(hashtags) ? hashtags : parseHashtags(hashtags);
  
  if (!tags.some(t => t.toLowerCase() === "#karrykraze")) {
    tags.unshift("#karrykraze");
  }
  
  return tags;
}
