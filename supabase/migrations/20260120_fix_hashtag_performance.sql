-- ============================================
-- Fix hashtag_performance - ensure table exists with correct schema
-- This migration handles the conflict between old view and new table
-- ============================================

-- Step 1: Drop any existing view (from old migration)
DROP VIEW IF EXISTS hashtag_performance CASCADE;

-- Step 2: Create or update the table
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

-- Step 3: Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_hashtag ON hashtag_performance(hashtag);
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_engagement ON hashtag_performance(avg_engagement_rate DESC);
CREATE INDEX IF NOT EXISTS idx_hashtag_performance_recommended ON hashtag_performance(is_recommended);

-- Step 4: Enable RLS
ALTER TABLE hashtag_performance ENABLE ROW LEVEL SECURITY;

-- Step 5: Create policies (drop first if they exist)
DROP POLICY IF EXISTS "Allow authenticated read hashtag_performance" ON hashtag_performance;
DROP POLICY IF EXISTS "Allow authenticated insert hashtag_performance" ON hashtag_performance;
DROP POLICY IF EXISTS "Allow authenticated update hashtag_performance" ON hashtag_performance;

CREATE POLICY "Allow authenticated read hashtag_performance" ON hashtag_performance
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert hashtag_performance" ON hashtag_performance
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update hashtag_performance" ON hashtag_performance
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Step 6: Grant permissions
GRANT SELECT, INSERT, UPDATE ON hashtag_performance TO authenticated;
GRANT ALL ON hashtag_performance TO service_role;

-- Step 7: Seed with some initial branded/recommended hashtags
INSERT INTO hashtag_performance (hashtag, times_used, avg_engagement_rate, category, is_recommended)
VALUES 
  ('karrykraze', 0, 0, 'branded', true),
  ('karrykrazefashion', 0, 0, 'branded', true),
  ('streetwear', 0, 0, 'category', true),
  ('fashion', 0, 0, 'category', true),
  ('accessories', 0, 0, 'category', true),
  ('ootd', 0, 0, 'trending', true),
  ('style', 0, 0, 'category', true)
ON CONFLICT (hashtag) DO NOTHING;

-- Done!
