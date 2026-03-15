-- ============================================================
-- Image Pipeline: Blacklist + AI Generation + Review Queue
-- Run against: db.yxdzvzscufkvewecvagq.supabase.co
-- ============================================================

-- 1. IMAGE BLACKLIST — mark specific product images as unfit for social media
CREATE TABLE IF NOT EXISTS image_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,                -- the exact URL being blacklisted
  reason TEXT,                            -- optional: "low quality", "bad background", etc.
  blacklisted_by TEXT DEFAULT 'admin',    -- who flagged it
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint: same product + image URL can only be blacklisted once
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_blacklist_product_url
  ON image_blacklist(product_id, image_url);

CREATE INDEX IF NOT EXISTS idx_image_blacklist_product
  ON image_blacklist(product_id);

-- RLS
ALTER TABLE image_blacklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on image_blacklist"
  ON image_blacklist FOR ALL
  USING (true) WITH CHECK (true);

-- 2. AI-GENERATED IMAGES — store generated images with review status
CREATE TABLE IF NOT EXISTS social_generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,             -- path in Supabase Storage bucket
  public_url TEXT NOT NULL,               -- full public URL for posting
  prompt TEXT NOT NULL,                   -- the prompt used to generate
  model TEXT NOT NULL DEFAULT 'dall-e-3', -- dall-e-3, gpt-image-1, etc.
  style TEXT DEFAULT 'lifestyle',         -- lifestyle, flat-lay, promo, etc.
  quality TEXT DEFAULT 'hd',              -- standard, hd
  size TEXT DEFAULT '1024x1024',          -- generation size
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected')),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  rejection_reason TEXT,
  generation_cost_cents INTEGER,          -- track cost in cents (e.g., 8 = $0.08)
  metadata JSONB DEFAULT '{}',           -- extra data (revised_prompt, etc.)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sgi_product_status
  ON social_generated_images(product_id, status);

CREATE INDEX IF NOT EXISTS idx_sgi_status
  ON social_generated_images(status);

CREATE INDEX IF NOT EXISTS idx_sgi_created
  ON social_generated_images(created_at DESC);

-- RLS
ALTER TABLE social_generated_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on social_generated_images"
  ON social_generated_images FOR ALL
  USING (true) WITH CHECK (true);

-- 3. ADD image_source COLUMN to social_posts to track where the image came from
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'social_posts' AND column_name = 'image_source'
  ) THEN
    ALTER TABLE social_posts ADD COLUMN image_source TEXT DEFAULT 'catalog'
      CHECK (image_source IN ('catalog', 'gallery', 'ai_generated', 'manual'));
  END IF;
END $$;

-- 4. ADD generated_image_id to social_posts for traceability
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'social_posts' AND column_name = 'generated_image_id'
  ) THEN
    ALTER TABLE social_posts ADD COLUMN generated_image_id UUID
      REFERENCES social_generated_images(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 5. SETTING: image pipeline config in social_settings
-- Run as upsert so it doesn't fail if key exists
INSERT INTO social_settings (setting_key, setting_value)
VALUES (
  'image_pipeline',
  '{
    "enabled": true,
    "auto_generate": true,
    "model": "dall-e-3",
    "quality": "hd",
    "size": "1024x1024",
    "style_presets": ["lifestyle", "flat_lay", "close_up"],
    "require_review": true,
    "auto_approve_after_hours": null,
    "blacklist_catalog_by_default": false,
    "max_generations_per_day": 50,
    "fallback_to_catalog": true
  }'::jsonb
)
ON CONFLICT (setting_key) DO NOTHING;

COMMENT ON TABLE image_blacklist IS 'Product images flagged as unsuitable for social media posting';
COMMENT ON TABLE social_generated_images IS 'AI-generated product images with review workflow';
COMMENT ON COLUMN social_posts.image_source IS 'Where the post image came from: catalog, gallery, ai_generated, or manual';
COMMENT ON COLUMN social_posts.generated_image_id IS 'Links to the AI-generated image used for this post';
