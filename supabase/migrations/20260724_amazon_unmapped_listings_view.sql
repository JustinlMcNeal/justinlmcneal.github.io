-- v_amazon_unmapped_listings — Amazon listings without active mapped/ignored/legacy mapping.

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
  'Amazon listings awaiting KK product mapping (excludes mapped, ignored, and legacy rows).';

GRANT SELECT ON public.v_amazon_unmapped_listings TO authenticated, service_role;
