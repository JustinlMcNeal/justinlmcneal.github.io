-- ============================================
-- Add Instagram Permalink to Social Posts
-- ============================================
-- Stores the direct link to the Instagram post for easy access

-- Add permalink column
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS instagram_permalink TEXT;

-- Add general permalink column for all platforms
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS permalink TEXT;

-- Comment for documentation
COMMENT ON COLUMN social_posts.instagram_permalink IS 'Direct URL to view the post on Instagram';
COMMENT ON COLUMN social_posts.permalink IS 'Direct URL to view the post on the respective platform';
