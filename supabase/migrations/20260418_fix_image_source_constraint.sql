-- Fix image_source check constraint to include new values used by auto-queue
-- 'ai_carousel' = carousel post using AI-generated images
-- 'resurface' = resurfaced old high-performing post
-- 'image_pool' = image from the tagged image pool
ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_image_source_check;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_image_source_check
  CHECK (image_source IN ('catalog', 'gallery', 'ai_generated', 'manual', 'ai_carousel', 'resurface', 'image_pool'));
