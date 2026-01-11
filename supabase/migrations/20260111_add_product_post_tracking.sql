-- Track when products were last posted to prevent repeats
-- This enables the "smart queue" feature that cycles through all products

-- Add last_posted column to track when a product was last used in a social post
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS last_social_post_at TIMESTAMPTZ;

-- Add index for efficient querying of products needing posts
CREATE INDEX IF NOT EXISTS idx_products_last_social_post 
ON products(last_social_post_at NULLS FIRST) 
WHERE is_active = true;

-- Create a view for products needing social posts (haven't been posted recently)
CREATE OR REPLACE VIEW products_needing_social_posts AS
SELECT 
  p.id,
  p.name,
  p.slug,
  p.category_id,
  p.catalog_image_url,
  p.price,
  c.name as category_name,
  p.last_social_post_at,
  COALESCE(p.last_social_post_at, '1970-01-01'::timestamptz) as sort_date
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
WHERE p.is_active = true
  AND p.catalog_image_url IS NOT NULL
  AND p.catalog_image_url != ''
ORDER BY sort_date ASC;

-- Add auto_queue settings to social_settings if not exists
INSERT INTO social_settings (setting_key, setting_value)
VALUES (
  'auto_queue',
  '{
    "enabled": false,
    "posts_per_day": 2,
    "platforms": ["instagram"],
    "posting_times": ["10:00", "18:00"],
    "caption_tones": ["casual", "urgency"],
    "min_days_between_repeat": 14
  }'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;

-- Comment explaining the feature
COMMENT ON COLUMN products.last_social_post_at IS 'Timestamp of when this product was last used in a social media post. Used by auto-queue to cycle through all products evenly.';
