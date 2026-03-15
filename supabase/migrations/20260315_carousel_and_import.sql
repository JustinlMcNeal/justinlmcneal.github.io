-- ═══════════════════════════════════════════════════════════════
-- Phase 2 Completion: Carousel Sets + Supplier Image Import
-- ═══════════════════════════════════════════════════════════════

-- 1. Carousel set tracking on generated images
ALTER TABLE social_generated_images
  ADD COLUMN IF NOT EXISTS carousel_set_id UUID DEFAULT NULL;

COMMENT ON COLUMN social_generated_images.carousel_set_id IS 
  'Groups images into carousel sets. Images sharing the same set ID form a swipeable carousel.';

CREATE INDEX IF NOT EXISTS idx_gen_images_carousel_set 
  ON social_generated_images(carousel_set_id) 
  WHERE carousel_set_id IS NOT NULL;

-- 2. Track imported supplier images
CREATE TABLE IF NOT EXISTS imported_product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,             -- original supplier/external URL
  storage_path TEXT NOT NULL,             -- path in Supabase Storage
  public_url TEXT NOT NULL,               -- public URL from storage
  image_type TEXT NOT NULL DEFAULT 'catalog',  -- catalog | gallery | hover | primary
  file_size_bytes BIGINT,
  mime_type TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, original_url)        -- prevent duplicate imports
);

CREATE INDEX IF NOT EXISTS idx_imported_images_product 
  ON imported_product_images(product_id);

COMMENT ON TABLE imported_product_images IS 
  'Tracks supplier images that have been downloaded and stored locally in Supabase Storage.';
