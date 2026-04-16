-- Sprint 2: Image Pool — add tagging + usage tracking columns to social_assets
-- product_id and idx_social_assets_product already exist from initial migration

ALTER TABLE social_assets
  ADD COLUMN IF NOT EXISTS shot_type TEXT,
  ADD COLUMN IF NOT EXISTS quality_score SMALLINT DEFAULT 3 CHECK (quality_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS used_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_social_assets_used ON social_assets(used_count);
CREATE INDEX IF NOT EXISTS idx_social_assets_shot_type ON social_assets(shot_type);

-- Track which pool asset was used per post (for learning + repost control)
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS source_asset_id UUID REFERENCES social_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_source_asset ON social_posts(source_asset_id);
