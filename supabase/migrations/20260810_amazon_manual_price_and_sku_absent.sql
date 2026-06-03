-- Manual price preservation + hide SKUs absent from Amazon single-SKU sync.

ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS price_last_source text
    CHECK (price_last_source IS NULL OR price_last_source IN (
      'listings', 'manual', 'unknown'
    ));

ALTER TABLE public.amazon_listings
  ADD COLUMN IF NOT EXISTS amazon_sku_absent_at timestamptz;

COMMENT ON COLUMN public.amazon_listings.price_last_source IS
  'Origin of price column: listings sync, manual patch/offer restore, or unknown.';

COMMENT ON COLUMN public.amazon_listings.amazon_sku_absent_at IS
  'Set when single-SKU sync returns no SP-API row, or admin dismisses a stale local row.';

CREATE OR REPLACE VIEW public.v_amazon_unmapped_listings AS
SELECT
  al.id                AS amazon_listing_id,
  al.seller_account_id,
  al.marketplace_id,
  al.asin,
  al.seller_sku,
  al.amazon_title,
  al.product_type,
  al.listing_status,
  al.price,
  al.currency,
  al.fbm_quantity,
  NULLIF(BTRIM(
    COALESCE(
      al.raw_listing->'attributes'->'main_product_image_locator'->0->>'media_location',
      al.raw_listing->'attributes'->'main_offer_image_locator'->0->>'media_location',
      al.raw_listing->'attributes'->'other_product_image_locator_1'->0->>'media_location',
      al.raw_listing->'summaries'->0->'mainImage'->>'link',
      al.raw_listing->'summaries'->0->'mainImage'->>'url',
      al.raw_listing->'summaries'->0->'mainImage'->>'media_location'
    )
  ), '') AS main_image_url,
  al.last_synced_at
FROM public.amazon_listings al
WHERE al.amazon_sku_absent_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.amazon_listing_mappings m
    WHERE m.amazon_listing_id = al.id
      AND m.mapping_status = 'mapped'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.amazon_listing_mappings m
    WHERE m.amazon_listing_id = al.id
      AND m.mapping_status IN ('ignored', 'legacy')
  );

COMMENT ON VIEW public.v_amazon_unmapped_listings IS
  'Amazon listings awaiting KK product mapping. Excludes dismissed/absent SKUs.';

GRANT SELECT ON public.v_amazon_unmapped_listings TO authenticated, service_role;
