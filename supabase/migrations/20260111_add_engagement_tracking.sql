-- ============================================
-- Add Engagement Tracking to Social Posts
-- ============================================
-- Tracks likes, comments, shares, saves, impressions, reach, and clicks
-- for Instagram, Facebook, and Pinterest posts

-- Add engagement columns to social_posts table
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS comments INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS saves INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS impressions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS reach INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS clicks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS engagement_rate DECIMAL(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS engagement_updated_at TIMESTAMPTZ;

-- Create table for hashtag performance tracking
CREATE TABLE IF NOT EXISTS social_hashtag_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hashtag TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'pinterest', 'facebook')),
  post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  
  -- Engagement at time of tracking
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  
  -- Calculated score for hashtag effectiveness
  effectiveness_score DECIMAL(5,2) DEFAULT 0,
  
  tracked_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for hashtag lookups
CREATE INDEX IF NOT EXISTS idx_hashtag_analytics_hashtag ON social_hashtag_analytics(hashtag);
CREATE INDEX IF NOT EXISTS idx_hashtag_analytics_platform ON social_hashtag_analytics(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_engagement_updated ON social_posts(engagement_updated_at);

-- Create view for hashtag performance summary
CREATE OR REPLACE VIEW hashtag_performance AS
SELECT 
  hashtag,
  platform,
  COUNT(DISTINCT post_id) as total_posts,
  AVG(likes) as avg_likes,
  AVG(comments) as avg_comments,
  AVG(saves) as avg_saves,
  AVG(impressions) as avg_impressions,
  AVG(reach) as avg_reach,
  AVG(effectiveness_score) as avg_effectiveness,
  MAX(tracked_at) as last_tracked
FROM social_hashtag_analytics
GROUP BY hashtag, platform
ORDER BY avg_effectiveness DESC;

-- Enable RLS
ALTER TABLE social_hashtag_analytics ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write
CREATE POLICY "Allow authenticated read hashtag_analytics" ON social_hashtag_analytics
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert hashtag_analytics" ON social_hashtag_analytics
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated update hashtag_analytics" ON social_hashtag_analytics
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access to hashtag_analytics" ON social_hashtag_analytics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add comments for documentation
COMMENT ON COLUMN social_posts.likes IS 'Number of likes on the post';
COMMENT ON COLUMN social_posts.comments IS 'Number of comments on the post';
COMMENT ON COLUMN social_posts.shares IS 'Number of shares/repins on the post';
COMMENT ON COLUMN social_posts.saves IS 'Number of saves/bookmarks on the post';
COMMENT ON COLUMN social_posts.impressions IS 'Number of times the post was shown';
COMMENT ON COLUMN social_posts.reach IS 'Number of unique accounts that saw the post';
COMMENT ON COLUMN social_posts.clicks IS 'Number of clicks on the post link';
COMMENT ON COLUMN social_posts.engagement_rate IS 'Calculated engagement rate percentage';
COMMENT ON COLUMN social_posts.engagement_updated_at IS 'Last time engagement metrics were updated';

COMMENT ON TABLE social_hashtag_analytics IS 'Tracks individual hashtag performance per post';
