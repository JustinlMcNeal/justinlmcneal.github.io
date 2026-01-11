-- Add carousel support to social_posts table
-- Run this in Supabase SQL Editor

-- Add image_urls column for carousel posts (array of URLs)
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS image_urls TEXT[];

-- Add media_type column to distinguish single vs carousel posts
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'image' 
CHECK (media_type IN ('image', 'carousel', 'video', 'reel'));

-- Add index for faster carousel queries
CREATE INDEX IF NOT EXISTS idx_social_posts_media_type ON social_posts(media_type);

-- Comment
COMMENT ON COLUMN social_posts.image_urls IS 'Array of image URLs for carousel posts (2-10 images)';
COMMENT ON COLUMN social_posts.media_type IS 'Type of media: image, carousel, video, or reel';
