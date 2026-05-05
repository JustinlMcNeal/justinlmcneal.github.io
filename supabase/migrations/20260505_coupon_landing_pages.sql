-- Coupon landing pages for QR-code campaigns
-- Lets admins expose a promotion code on a dedicated public page without making every code promo broadly listed.

ALTER TABLE public.promotions
  ALTER COLUMN code DROP NOT NULL;

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS coupon_landing_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coupon_slug TEXT,
  ADD COLUMN IF NOT EXISTS coupon_page_title TEXT,
  ADD COLUMN IF NOT EXISTS coupon_page_note TEXT;

UPDATE public.promotions
SET requires_code = true
WHERE code IS NOT NULL
  AND btrim(code) <> ''
  AND upper(btrim(code)) <> 'AUTO'
  AND requires_code IS DISTINCT FROM true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_coupon_slug_unique
  ON public.promotions (lower(coupon_slug))
  WHERE coupon_slug IS NOT NULL AND btrim(coupon_slug) <> '';

CREATE INDEX IF NOT EXISTS idx_promotions_coupon_landing
  ON public.promotions (coupon_landing_enabled, coupon_slug)
  WHERE coupon_landing_enabled = true;

ALTER TABLE public.promotions
  DROP CONSTRAINT IF EXISTS promotions_coupon_slug_format;

ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_coupon_slug_format
  CHECK (coupon_slug IS NULL OR coupon_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

COMMENT ON COLUMN public.promotions.coupon_landing_enabled IS
'If true, this promotion can be loaded on /pages/coupon.html?promo=<coupon_slug> and its code can be shown publicly.';

COMMENT ON COLUMN public.promotions.coupon_slug IS
'Public URL slug for QR-code coupon landing pages.';

DROP POLICY IF EXISTS "public_read_active_promotions" ON public.promotions;

CREATE POLICY "public_read_active_promotions"
  ON public.promotions
  FOR SELECT
  TO public
  USING (
    is_active = true
    AND (
      is_public = true
      OR coupon_landing_enabled = true
    )
  );