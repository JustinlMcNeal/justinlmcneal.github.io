-- ============================================
-- Social Media Content Engine - Database Schema
-- ============================================

-- 1. Pinterest Boards (for organizing pins by category)
CREATE TABLE IF NOT EXISTS pinterest_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  pinterest_board_id TEXT, -- Will be populated when synced with Pinterest API
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL, -- Auto-map to product category
  is_default BOOLEAN DEFAULT FALSE, -- Default board for unmatched categories
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Social Assets (original uploaded images)
CREATE TABLE IF NOT EXISTS social_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL, -- Optional link to product
  original_image_path TEXT NOT NULL, -- Path in social-media bucket
  original_filename TEXT,
  product_url TEXT, -- Direct link to product page (auto-generated from product)
  keywords TEXT[], -- Optional keywords for caption generation
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Social Variations (auto-generated crops/formats)
CREATE TABLE IF NOT EXISTS social_variations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES social_assets(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'pinterest', 'both')),
  variant_type TEXT NOT NULL, -- 'square_1x1', 'portrait_4x5', 'vertical_2x3', 'tall_1x2'
  aspect_ratio TEXT NOT NULL, -- '1:1', '4:5', '2:3', '1:2.1'
  image_path TEXT NOT NULL, -- Path in social-media bucket
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Caption Templates (editable templates by tone)
CREATE TABLE IF NOT EXISTS social_caption_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tone TEXT NOT NULL CHECK (tone IN ('casual', 'professional', 'urgency')),
  template TEXT NOT NULL, -- Uses placeholders like {product_name}, {category}, {link}
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Category Hashtags (hashtags per product category)
CREATE TABLE IF NOT EXISTS social_category_hashtags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  category_name TEXT, -- Fallback if category_id is null (for default/global)
  hashtags TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Social Posts (the scheduling queue + history)
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_id UUID NOT NULL REFERENCES social_variations(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'pinterest')),
  
  -- Content
  caption TEXT,
  hashtags TEXT[],
  link_url TEXT, -- Destination URL (required for Pinterest)
  
  -- Pinterest-specific
  pinterest_board_id UUID REFERENCES pinterest_boards(id) ON DELETE SET NULL,
  pinterest_pin_id TEXT, -- Returned after posting
  
  -- Instagram-specific  
  instagram_media_id TEXT, -- Returned after posting
  
  -- Scheduling
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('draft', 'queued', 'approved', 'posting', 'posted', 'failed')),
  requires_approval BOOLEAN DEFAULT FALSE,
  
  -- Result tracking
  platform_post_id TEXT, -- Generic field for the platform's post ID
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  posted_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Social Settings (global settings for the engine)
CREATE TABLE IF NOT EXISTS social_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key TEXT NOT NULL UNIQUE,
  setting_value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_for) WHERE status IN ('queued', 'approved');
CREATE INDEX IF NOT EXISTS idx_social_posts_platform_status ON social_posts(platform, status);
CREATE INDEX IF NOT EXISTS idx_social_variations_asset ON social_variations(asset_id);
CREATE INDEX IF NOT EXISTS idx_social_assets_product ON social_assets(product_id);
CREATE INDEX IF NOT EXISTS idx_pinterest_boards_category ON pinterest_boards(category_id);

-- ============================================
-- Row Level Security (RLS)
-- ============================================

ALTER TABLE pinterest_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_caption_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_category_hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_settings ENABLE ROW LEVEL SECURITY;

-- Admin-only policies (authenticated users only)
CREATE POLICY "Admin read pinterest_boards" ON pinterest_boards FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write pinterest_boards" ON pinterest_boards FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read social_assets" ON social_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write social_assets" ON social_assets FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read social_variations" ON social_variations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write social_variations" ON social_variations FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read social_caption_templates" ON social_caption_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write social_caption_templates" ON social_caption_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read social_category_hashtags" ON social_category_hashtags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write social_category_hashtags" ON social_category_hashtags FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read social_posts" ON social_posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write social_posts" ON social_posts FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admin read social_settings" ON social_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write social_settings" ON social_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- Seed default data
-- ============================================

-- Default caption templates
INSERT INTO social_caption_templates (tone, template) VALUES
  -- Casual
  ('casual', 'Loving this {product_name}! ✨ Perfect for everyday wear. Tap to shop! 🛒'),
  ('casual', 'New drop alert! 🔥 Check out our {product_name} - link in bio! 👆'),
  ('casual', 'Your new favorite {category} just landed! 😍 Shop the {product_name} now!'),
  ('casual', 'Obsessed with this {product_name}! 💕 Who else needs one?'),
  ('casual', 'Weekend vibes with our {product_name} ✌️ Shop yours today!'),
  
  -- Professional
  ('professional', 'Introducing the {product_name} - quality crafted for modern style.'),
  ('professional', 'Elevate your look with our {product_name}. Premium quality, timeless design.'),
  ('professional', 'The {product_name}: Where style meets functionality. Discover more.'),
  ('professional', 'Crafted with care: Our {product_name} collection is now available.'),
  ('professional', 'Experience the difference. Shop the {product_name} today.'),
  
  -- Urgency
  ('urgency', '🚨 Limited stock! Get your {product_name} before it''s gone!'),
  ('urgency', 'Don''t miss out! Our {product_name} is selling fast! ⏰'),
  ('urgency', 'Last chance! ⚡ The {product_name} won''t last long - shop now!'),
  ('urgency', 'GOING FAST! 🔥 Grab the {product_name} while you can!'),
  ('urgency', '⏰ Hurry! Limited {product_name} remaining - don''t wait!')
ON CONFLICT DO NOTHING;

-- Default global hashtags (used for all categories)
INSERT INTO social_category_hashtags (category_name, hashtags) VALUES
  ('_global', ARRAY['#karrykraze', '#fashion', '#style', '#ootd', '#shopnow', '#newdrop'])
ON CONFLICT DO NOTHING;

-- Default settings
INSERT INTO social_settings (setting_key, setting_value) VALUES
  ('posting_schedule', '{"instagram": {"enabled": true, "posts_per_day": 1, "times": ["12:00"]}, "pinterest": {"enabled": true, "posts_per_day": 1, "times": ["12:00"]}}'),
  ('auto_approve', '{"enabled": true}'),
  ('default_tone', '{"tone": "casual"}'),
  ('variation_formats', '{"instagram": ["square_1x1", "portrait_4x5"], "pinterest": ["vertical_2x3", "tall_1x2"]}')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================
-- Comments for documentation
-- ============================================

COMMENT ON TABLE social_assets IS 'Original images uploaded for social media posting';
COMMENT ON TABLE social_variations IS 'Auto-generated crop variations of social assets';
COMMENT ON TABLE social_posts IS 'Scheduled and posted social media content queue';
COMMENT ON TABLE social_caption_templates IS 'Editable caption templates organized by tone';
COMMENT ON TABLE social_category_hashtags IS 'Category-specific hashtags for auto-generation';
COMMENT ON TABLE pinterest_boards IS 'Pinterest boards for organizing pins';
COMMENT ON TABLE social_settings IS 'Global settings for the social media engine';
