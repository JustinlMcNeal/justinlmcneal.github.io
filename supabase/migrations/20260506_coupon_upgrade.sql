-- Coupon upgrade via SMS enrollment
-- Adds upgrade settings to promotions and a table to track issued upgrade codes.

-- ── New columns on promotions ────────────────────────────────────────────────

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS coupon_upgrade_enabled    BOOLEAN    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coupon_upgrade_value      NUMERIC,
  ADD COLUMN IF NOT EXISTS coupon_upgrade_prefix     TEXT       NOT NULL DEFAULT 'VIP',
  ADD COLUMN IF NOT EXISTS coupon_upgrade_expiry_days INTEGER   NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS coupon_upgrade_consent    TEXT;

COMMENT ON COLUMN public.promotions.coupon_upgrade_enabled IS
'If true, visitors on the coupon landing page can enter their phone to receive a personal upgraded code and enroll in SMS marketing.';

COMMENT ON COLUMN public.promotions.coupon_upgrade_value IS
'Discount value for the upgraded personal code (e.g. 20 for 20% off). Same discount type as the base promotion.';

COMMENT ON COLUMN public.promotions.coupon_upgrade_prefix IS
'Prefix used when generating personal upgrade codes (e.g. VIP → VIP-X4F9J2).';

COMMENT ON COLUMN public.promotions.coupon_upgrade_expiry_days IS
'Number of days until the generated upgrade code expires.';

COMMENT ON COLUMN public.promotions.coupon_upgrade_consent IS
'Consent disclosure text shown to the customer on the coupon landing page before they submit their phone number.';

-- ── coupon_upgrades table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.coupon_upgrades (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id         UUID        NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  phone            TEXT        NOT NULL,
  upgrade_code     TEXT        NOT NULL,
  upgrade_promo_id UUID        REFERENCES public.promotions(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One upgrade per phone per base promotion
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_upgrades_promo_phone
  ON public.coupon_upgrades (promo_id, phone);

CREATE INDEX IF NOT EXISTS idx_coupon_upgrades_phone
  ON public.coupon_upgrades (phone);

COMMENT ON TABLE public.coupon_upgrades IS
'Tracks which phone numbers have already received a personal upgrade code for a given promotion.';

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.coupon_upgrades ENABLE ROW LEVEL SECURITY;

-- Edge function uses service role key — no public read/write needed
-- Admins (authenticated) can read for analytics
CREATE POLICY "admin_read_coupon_upgrades"
  ON public.coupon_upgrades
  FOR SELECT
  TO authenticated
  USING (true);
