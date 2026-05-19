-- Image Pool content types (product, testimonial, promo, etc.)
-- Safe default for existing rows: product

ALTER TABLE social_assets
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'product';

ALTER TABLE social_assets
  DROP CONSTRAINT IF EXISTS social_assets_content_type_check;

ALTER TABLE social_assets
  ADD CONSTRAINT social_assets_content_type_check
  CHECK (content_type IN (
    'product',
    'testimonial',
    'promo',
    'lifestyle',
    'brand',
    'educational',
    'ugc',
    'other'
  ));

CREATE INDEX IF NOT EXISTS idx_social_assets_content_type ON social_assets(content_type);

COMMENT ON COLUMN social_assets.content_type IS 'Image Pool asset category for autopilot weighting and filters';
