-- Add image_url column to social_posts table
-- This is needed for carousel posts to store a thumbnail/preview image
-- Run this in Supabase SQL Editor

-- Add image_url column for single image posts and carousel thumbnails
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add product_id column if it doesn't exist (for direct product reference without variation)
ALTER TABLE social_posts 
ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;

-- Make variation_id nullable (not all posts need a variation, e.g. carousels)
ALTER TABLE social_posts 
ALTER COLUMN variation_id DROP NOT NULL;

-- Add index for product_id lookups
CREATE INDEX IF NOT EXISTS idx_social_posts_product_id ON social_posts(product_id);

-- Comments for documentation
COMMENT ON COLUMN social_posts.image_url IS 'Single image URL for image posts, or thumbnail/preview for carousel posts';
COMMENT ON COLUMN social_posts.product_id IS 'Direct reference to product for posts created without a variation';
