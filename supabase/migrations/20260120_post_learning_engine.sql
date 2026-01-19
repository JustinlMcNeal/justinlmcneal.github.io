-- ============================================
-- Post Learning Engine - Database Schema
-- Stores patterns, learnings, and recommendations
-- ============================================

-- Drop any existing views that might conflict with table names
DROP VIEW IF EXISTS hashtag_performance CASCADE;
DROP VIEW IF EXISTS posting_time_performance CASCADE;
DROP VIEW IF EXISTS caption_element_performance CASCADE;

-- 1. Post Performance Analysis (detailed breakdown of what works)
CREATE TABLE IF NOT EXISTS post_performance_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  
  -- Performance Scores (0-100)
  overall_score DECIMAL(5,2) DEFAULT 0,
  timing_score DECIMAL(5,2) DEFAULT 0,
  caption_score DECIMAL(5,2) DEFAULT 0,
  hashtag_score DECIMAL(5,2) DEFAULT 0,
  visual_score DECIMAL(5,2) DEFAULT 0,
  engagement_velocity_score DECIMAL(5,2) DEFAULT 0,
  
  -- Timing Analysis
  posted_hour INTEGER,
  posted_day_of_week INTEGER, -- 0=Sunday, 6=Saturday
  posted_day_name TEXT,
  is_weekend BOOLEAN,
  
  -- Caption Analysis
  caption_length INTEGER,
  has_cta BOOLEAN DEFAULT false, -- Call to action
  has_emoji BOOLEAN DEFAULT false,
  emoji_count INTEGER DEFAULT 0,
  has_question BOOLEAN DEFAULT false,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'urgency')),
  
  -- Hashtag Analysis
  hashtag_count INTEGER DEFAULT 0,
  branded_hashtag_used BOOLEAN DEFAULT false,
  category_hashtags_used TEXT[],
  trending_hashtags_used TEXT[],
  hashtag_reach_contribution DECIMAL(5,2) DEFAULT 0,
  
  -- Engagement Velocity (how fast engagement came)
  engagement_first_hour JSONB, -- {likes: x, comments: y}
  engagement_first_day JSONB,
  peak_engagement_time TIMESTAMPTZ,
  
  -- Content Type Analysis
  content_type TEXT, -- 'product', 'lifestyle', 'promo', 'ugc', 'meme', 'carousel'
  product_category TEXT,
  
  -- Comparison to Average
  vs_avg_engagement_rate DECIMAL(5,2), -- percentage above/below average
  vs_avg_likes DECIMAL(5,2),
  vs_avg_comments DECIMAL(5,2),
  vs_avg_saves DECIMAL(5,2),
  
  -- AI-Generated Insights
  strengths TEXT[],
  weaknesses TEXT[],
  recommendations TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Learned Patterns (aggregated learnings from all posts)
CREATE TABLE IF NOT EXISTS post_learning_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL, -- 'timing', 'hashtag', 'caption', 'content'
  pattern_key TEXT NOT NULL, -- e.g., 'best_hour', 'top_hashtag', 'optimal_length'
  pattern_value JSONB NOT NULL,
  confidence_score DECIMAL(5,2) DEFAULT 0, -- 0-100 based on sample size
  sample_size INTEGER DEFAULT 0,
  last_calculated TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(pattern_type, pattern_key)
);

-- 3. Hashtag Performance Tracking
CREATE TABLE IF NOT EXISTS hashtag_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hashtag TEXT NOT NULL UNIQUE,
  times_used INTEGER DEFAULT 0,
  total_reach BIGINT DEFAULT 0,
  total_likes INTEGER DEFAULT 0,
  total_comments INTEGER DEFAULT 0,
  total_saves INTEGER DEFAULT 0,
  avg_engagement_rate DECIMAL(5,2) DEFAULT 0,
  best_performing_post_id UUID REFERENCES social_posts(id) ON DELETE SET NULL,
  worst_performing_post_id UUID REFERENCES social_posts(id) ON DELETE SET NULL,
  category TEXT, -- 'branded', 'category', 'trending', 'niche'
  is_recommended BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Posting Time Performance
CREATE TABLE IF NOT EXISTS posting_time_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hour_of_day INTEGER NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day < 24),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week < 7),
  total_posts INTEGER DEFAULT 0,
  total_reach BIGINT DEFAULT 0,
  total_engagement INTEGER DEFAULT 0,
  avg_engagement_rate DECIMAL(5,2) DEFAULT 0,
  is_peak_time BOOLEAN DEFAULT false,
  
  UNIQUE(hour_of_day, day_of_week)
);

-- 5. Caption Element Performance
CREATE TABLE IF NOT EXISTS caption_element_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  element_type TEXT NOT NULL, -- 'emoji', 'cta', 'question', 'length_range', 'tone'
  element_value TEXT NOT NULL, -- e.g., '🔥', 'shop_now', 'short', 'casual'
  times_used INTEGER DEFAULT 0,
  avg_engagement_rate DECIMAL(5,2) DEFAULT 0,
  avg_saves DECIMAL(5,2) DEFAULT 0,
  avg_comments DECIMAL(5,2) DEFAULT 0,
  is_recommended BOOLEAN DEFAULT false,
  
  UNIQUE(element_type, element_value)
);

-- 6. Content Strategy Recommendations (AI-generated weekly insights)
CREATE TABLE IF NOT EXISTS content_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_type TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
  category TEXT, -- 'timing', 'content', 'hashtags', 'engagement', 'general'
  priority INTEGER DEFAULT 0, -- 1=highest
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  action_items TEXT[],
  based_on_data JSONB, -- The data that led to this recommendation
  is_active BOOLEAN DEFAULT true,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_post_analysis_post ON post_performance_analysis(post_id);
CREATE INDEX IF NOT EXISTS idx_post_analysis_score ON post_performance_analysis(overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_hashtag_perf_engagement ON hashtag_performance(avg_engagement_rate DESC);
CREATE INDEX IF NOT EXISTS idx_hashtag_perf_used ON hashtag_performance(times_used DESC);
CREATE INDEX IF NOT EXISTS idx_time_perf_engagement ON posting_time_performance(avg_engagement_rate DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_active ON content_recommendations(is_active, priority);

-- ============================================
-- Row Level Security
-- ============================================

ALTER TABLE post_performance_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_learning_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE hashtag_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE posting_time_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE caption_element_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_recommendations ENABLE ROW LEVEL SECURITY;

-- Admin policies
CREATE POLICY "Admin read post_performance_analysis" ON post_performance_analysis FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write post_performance_analysis" ON post_performance_analysis FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read post_learning_patterns" ON post_learning_patterns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write post_learning_patterns" ON post_learning_patterns FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read hashtag_performance" ON hashtag_performance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write hashtag_performance" ON hashtag_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read posting_time_performance" ON posting_time_performance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write posting_time_performance" ON posting_time_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read caption_element_performance" ON caption_element_performance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write caption_element_performance" ON caption_element_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read content_recommendations" ON content_recommendations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write content_recommendations" ON content_recommendations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- Seed Initial Best Practice Data
-- ============================================

-- Based on research: Best posting times
INSERT INTO posting_time_performance (hour_of_day, day_of_week, is_peak_time) VALUES
  -- Monday: 5 AM peak
  (5, 1, true), (6, 1, false), (11, 1, false), (23, 1, true),
  -- Tuesday: 5 AM peak
  (5, 2, true), (6, 2, false),
  -- Wednesday: 3-5 AM peak
  (3, 3, true), (4, 3, true), (5, 3, true),
  -- Thursday: 4-5 AM peak
  (4, 4, true), (5, 4, true),
  -- Friday: 3-6 AM peak
  (3, 5, true), (4, 5, true), (5, 5, true), (6, 5, false),
  -- Saturday: 5 AM peak
  (5, 6, true),
  -- Sunday: 12 AM, 5 AM, 11 PM peaks
  (0, 0, true), (5, 0, true), (23, 0, true)
ON CONFLICT DO NOTHING;

-- Initial caption element recommendations
INSERT INTO caption_element_performance (element_type, element_value, is_recommended) VALUES
  ('cta', 'shop_now', true),
  ('cta', 'link_in_bio', true),
  ('cta', 'tap_to_shop', true),
  ('cta', 'question', true),
  ('length_range', 'short', true), -- Under 125 chars
  ('length_range', 'medium', true), -- 125-300 chars
  ('tone', 'casual', true),
  ('tone', 'urgency', true),
  ('emoji', 'fire', true),
  ('emoji', 'heart', true),
  ('emoji', 'sparkle', true),
  ('emoji', 'shopping', true)
ON CONFLICT DO NOTHING;

-- Initial learning patterns (Instagram research-based)
INSERT INTO post_learning_patterns (pattern_type, pattern_key, pattern_value, confidence_score) VALUES
  ('timing', 'best_general_time', '{"hour": 5, "description": "5 AM in audience timezone"}', 85),
  ('timing', 'best_day', '{"day": 1, "day_name": "Monday", "reason": "Start of week, high engagement"}', 80),
  ('timing', 'worst_day', '{"day": 6, "day_name": "Saturday", "reason": "Lowest overall engagement"}', 75),
  ('hashtag', 'optimal_count', '{"min": 3, "max": 5, "reason": "3-5 hashtags is the sweet spot per Instagram research"}', 90),
  ('hashtag', 'placement', '{"location": "caption", "alternative": "first_comment", "note": "Both work, caption slightly better for discovery"}', 70),
  ('caption', 'optimal_length', '{"chars": 150, "range": "100-200", "reason": "Short, concise messaging works best"}', 85),
  ('caption', 'use_emojis', '{"recommended": true, "max": 5, "reason": "Increases engagement but dont overdo"}', 80),
  ('caption', 'use_cta', '{"recommended": true, "examples": ["shop now", "link in bio", "tap to see"], "reason": "CTAs drive action"}', 85),
  ('caption', 'ask_questions', '{"recommended": true, "reason": "Questions boost comment rate significantly"}', 80),
  ('content', 'reels_priority', '{"recommended": true, "under_minutes": 1.5, "reason": "Reels under 90 seconds get most reach"}', 85),
  ('content', 'carousel_engagement', '{"recommended": true, "engagement_boost": "2.4%", "reason": "Carousels have highest engagement rate"}', 90),
  ('content', 'hooks', '{"recommended": true, "first_seconds": 3, "reason": "First 3 seconds critical for retention"}', 95),
  ('engagement', 'shares_priority', '{"importance": "high", "reason": "Instagram prioritizes shares as top ranking signal in 2026"}', 95),
  ('engagement', 'saves_value', '{"importance": "high", "reason": "Saves signal high interest and content value"}', 90),
  ('engagement', 'reply_to_comments', '{"recommended": true, "timing": "quick", "reason": "Boosts algorithm ranking and community building"}', 85),
  ('ecommerce', 'product_tags', '{"recommended": true, "reason": "7% of users start shopping searches on Instagram"}', 75),
  ('ecommerce', 'shopping_features', '{"use": true, "reason": "40.1% of Instagram shoppers spend $200+/year on platform"}', 80)
ON CONFLICT (pattern_type, pattern_key) DO NOTHING;

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE post_performance_analysis IS 'Detailed performance breakdown for each post';
COMMENT ON TABLE post_learning_patterns IS 'Aggregated learnings and best practices from all posts';
COMMENT ON TABLE hashtag_performance IS 'Tracks which hashtags perform best';
COMMENT ON TABLE posting_time_performance IS 'Tracks best times to post based on actual data';
COMMENT ON TABLE caption_element_performance IS 'Tracks which caption elements drive engagement';
COMMENT ON TABLE content_recommendations IS 'AI-generated actionable recommendations';
