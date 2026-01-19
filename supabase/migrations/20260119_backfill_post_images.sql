-- Backfill image_url for social_posts from social_variations
-- This updates posts that have a variation_id but no image_url set

UPDATE social_posts p
SET image_url = 'https://yxdzvzscufkvewecvagq.supabase.co/storage/v1/object/public/social-media/' || v.image_path
FROM social_variations v
WHERE p.variation_id = v.id
  AND (p.image_url IS NULL OR p.image_url = '');

-- Also backfill from assets for posts that might have direct asset reference
UPDATE social_posts p
SET image_url = 'https://yxdzvzscufkvewecvagq.supabase.co/storage/v1/object/public/social-media/' || a.original_image_path
FROM social_variations v
JOIN social_assets a ON v.asset_id = a.id
WHERE p.variation_id = v.id
  AND (p.image_url IS NULL OR p.image_url = '')
  AND v.image_path IS NULL
  AND a.original_image_path IS NOT NULL;
