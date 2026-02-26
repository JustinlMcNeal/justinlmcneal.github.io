-- ============================================================
-- Reviews + Review Reward Coupons
-- ============================================================

-- 1) Review settings (admin-configurable coupon details etc.)
CREATE TABLE IF NOT EXISTS public.review_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default settings
INSERT INTO public.review_settings (key, value) VALUES
  ('coupon', '{
    "enabled": true,
    "type": "percentage",
    "value": 5,
    "prefix": "THANKS",
    "expiry_days": 30,
    "single_use": true,
    "min_order_amount": 0
  }'::jsonb),
  ('moderation', '{
    "auto_approve": false,
    "notify_admin": true
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- RLS for review_settings
ALTER TABLE public.review_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_read_review_settings"
  ON public.review_settings FOR SELECT TO public USING (true);

CREATE POLICY "authenticated_manage_review_settings"
  ON public.review_settings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.review_settings TO anon;
GRANT ALL ON public.review_settings TO authenticated;
GRANT ALL ON public.review_settings TO service_role;


-- 2) Reviews table
CREATE TABLE IF NOT EXISTS public.reviews (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Link to the order (prevents fakes)
  order_session_id TEXT NOT NULL,          -- stripe_checkout_session_id
  product_id       TEXT,                   -- product code (KK-XXXX)
  product_name     TEXT,                   -- denormalized for display

  -- Reviewer
  reviewer_email   TEXT NOT NULL,
  reviewer_name    TEXT,

  -- Content
  rating           SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title            TEXT,
  body             TEXT,
  photo_url        TEXT,                   -- optional review photo

  -- Moderation
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes      TEXT,

  -- Coupon reward
  coupon_code      TEXT,                   -- generated coupon code (NULL until approved/sent)
  coupon_sent_at   TIMESTAMPTZ,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  -- One review per product per order
  CONSTRAINT uq_review_order_product UNIQUE (order_session_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_status ON public.reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON public.reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_email ON public.reviews(reviewer_email);
CREATE INDEX IF NOT EXISTS idx_reviews_order ON public.reviews(order_session_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON public.reviews(rating);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Anyone can read approved reviews
CREATE POLICY "public_read_approved_reviews"
  ON public.reviews FOR SELECT TO public
  USING (status = 'approved');

-- Service role (edge functions) can do everything
-- Authenticated (admin) can do everything
CREATE POLICY "authenticated_manage_reviews"
  ON public.reviews FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.reviews TO anon;
GRANT ALL ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;


-- 3) Review coupons log (tracks usage)
CREATE TABLE IF NOT EXISTS public.review_coupons (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  review_id       UUID REFERENCES public.reviews(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  discount_type   TEXT NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value  NUMERIC(10,2) NOT NULL DEFAULT 5,
  min_order       NUMERIC(10,2) DEFAULT 0,
  single_use      BOOLEAN DEFAULT TRUE,
  expires_at      TIMESTAMPTZ,
  used_at         TIMESTAMPTZ,           -- NULL = not yet used
  used_order_id   TEXT,                   -- stripe session id when redeemed
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_coupons_code ON public.review_coupons(code);
CREATE INDEX IF NOT EXISTS idx_review_coupons_review ON public.review_coupons(review_id);

ALTER TABLE public.review_coupons ENABLE ROW LEVEL SECURITY;

-- Anyone can look up a coupon by code (for validation at checkout)
CREATE POLICY "public_read_review_coupons"
  ON public.review_coupons FOR SELECT TO public
  USING (true);

CREATE POLICY "authenticated_manage_review_coupons"
  ON public.review_coupons FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.review_coupons TO anon;
GRANT ALL ON public.review_coupons TO authenticated;
GRANT ALL ON public.review_coupons TO service_role;
