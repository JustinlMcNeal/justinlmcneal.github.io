-- Needs Mapping thumbnails: expose main image URL from synced raw_listing JSON.

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
WHERE NOT EXISTS (
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
  'Amazon listings awaiting KK product mapping. main_image_url parsed from raw_listing attributes/summaries.';

GRANT SELECT ON public.v_amazon_unmapped_listings TO authenticated, service_role;
