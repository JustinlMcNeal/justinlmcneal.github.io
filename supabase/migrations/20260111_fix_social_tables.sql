-- Fix social media tables - Run this in Supabase SQL Editor
-- This migration fixes missing columns, tables, and creates proper indexes

-- ============================================
-- 1. Add published_at column to social_posts (the code expects this)
-- ============================================
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Copy existing posted_at values to published_at
UPDATE social_posts SET published_at = posted_at WHERE published_at IS NULL AND posted_at IS NOT NULL;

-- Create index for published_at queries
CREATE INDEX IF NOT EXISTS idx_social_posts_published_at ON social_posts(published_at) WHERE published_at IS NOT NULL;

-- ============================================
-- 2. Ensure social_settings table exists with proper structure
-- ============================================
CREATE TABLE IF NOT EXISTS social_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE social_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first to avoid conflicts
DROP POLICY IF EXISTS "Admin read social_settings" ON social_settings;
DROP POLICY IF EXISTS "Admin write social_settings" ON social_settings;
DROP POLICY IF EXISTS "Allow authenticated read social_settings" ON social_settings;
DROP POLICY IF EXISTS "Allow authenticated write social_settings" ON social_settings;

-- Create policies
CREATE POLICY "Allow authenticated read social_settings" ON social_settings 
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated write social_settings" ON social_settings 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- 3. Add status 'published' to social_posts status check
-- (Some code uses 'published' instead of 'posted')
-- ============================================
ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_status_check;
ALTER TABLE social_posts 
ADD CONSTRAINT social_posts_status_check 
CHECK (status IN ('draft', 'queued', 'approved', 'posting', 'posted', 'published', 'failed'));

-- ============================================
-- 4. Seed default autopilot settings
-- ============================================
INSERT INTO social_settings (setting_key, setting_value)
VALUES 
  ('autopilot', '{"enabled": false, "days_ahead": 7, "posts_per_day": 2, "platforms": ["instagram"], "tones": ["casual", "trending"], "posting_times": ["10:00", "14:00", "18:00"]}'),
  ('autopilot_last_run', '{"timestamp": null}'),
  ('repost', '{"enabled": false, "count": 2, "min_days_old": 30, "platforms": ["instagram"], "tones": ["casual", "trending"]}')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================
-- 5. Update existing 'posted' status to 'published' for consistency
-- ============================================
UPDATE social_posts SET status = 'published' WHERE status = 'posted';

-- ============================================
-- 6. Add comments for documentation
-- ============================================
COMMENT ON COLUMN social_posts.published_at IS 'Timestamp when post was actually published to the platform';
COMMENT ON TABLE social_settings IS 'Global settings for the social media engine (autopilot, repost, etc)';
