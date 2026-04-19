-- Prevent duplicate images in the social assets pool
-- Partial unique index: only enforced for active assets
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_assets_active_path
  ON social_assets (original_image_path)
  WHERE is_active = true;
