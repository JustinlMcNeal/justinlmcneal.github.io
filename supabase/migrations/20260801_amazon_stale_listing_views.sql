-- Phase 4A: stale listing detection on workspace read model + stale-only view.

CREATE OR REPLACE VIEW public.v_amazon_listing_workspace AS
WITH
variant_stats AS (
  SELECT
    product_id,
    COALESCE(SUM(COALESCE(stock, 0)) FILTER (WHERE is_active), 0) AS kk_stock_total
  FROM public.product_variants
  GROUP BY product_id
),
mapped AS (
  SELECT DISTINCT ON (m.amazon_listing_id)
    m.amazon_listing_id,
    m.id                AS mapping_id,
    m.kk_product_id,
    m.kk_sku,
    m.mapping_status,
    m.mapping_confidence,
    m.mapped_at
  FROM public.amazon_listing_mappings m
  WHERE m.mapping_status = 'mapped'
  ORDER BY m.amazon_listing_id, m.mapped_at DESC NULLS LAST, m.created_at DESC
),
issue_stats AS (
  SELECT
    i.amazon_listing_id,
    COUNT(*) FILTER (WHERE i.status = 'open') AS open_issue_count,
    MAX(
      CASE i.severity
        WHEN 'error'   THEN 3
        WHEN 'warning' THEN 2
        WHEN 'info'    THEN 1
        ELSE 0
      END
    ) FILTER (WHERE i.status = 'open') AS highest_issue_severity_rank
  FROM public.amazon_listing_issues i
  WHERE i.amazon_listing_id IS NOT NULL
  GROUP BY i.amazon_listing_id
)
SELECT
  al.id                          AS amazon_listing_id,
  al.seller_account_id,
  al.seller_id,
  al.marketplace_id,
  al.asin,
  al.seller_sku,
  al.amazon_title,
  al.product_type,
  al.listing_status,
  al.listing_status_buyable,
  al.listing_status_discoverable,
  al.price,
  al.currency,
  al.fulfillment_channel,
  al.fbm_quantity,
  al.fba_fulfillable_quantity,
  al.fba_reserved_quantity,
  al.fba_inbound_quantity,
  al.last_synced_at,
  mp.mapping_status,
  mp.mapping_confidence,
  mp.kk_product_id,
  COALESCE(mp.kk_sku, p.code)     AS kk_sku,
  p.name                          AS kk_product_title,
  p.price                         AS kk_price,
  COALESCE(vs.kk_stock_total, 0)  AS kk_stock,
  COALESCE(ist.open_issue_count, 0) AS open_issue_count,
  CASE COALESCE(ist.highest_issue_severity_rank, 0)
    WHEN 3 THEN 'error'
    WHEN 2 THEN 'warning'
    WHEN 1 THEN 'info'
    ELSE NULL
  END                             AS highest_issue_severity,
  CASE
    WHEN al.last_synced_at IS NULL THEN true
    WHEN al.last_synced_at < (now() - interval '24 hours') THEN true
    ELSE false
  END                             AS is_stale,
  CASE
    WHEN al.last_synced_at IS NULL THEN 'never_synced'
    WHEN al.last_synced_at < (now() - interval '24 hours') THEN 'sync_older_than_24h'
    ELSE NULL
  END                             AS stale_reason,
  CASE
    WHEN al.last_synced_at IS NULL THEN NULL
    ELSE ROUND(
      EXTRACT(EPOCH FROM (now() - al.last_synced_at)) / 3600.0,
      1
    )
  END                             AS hours_since_sync
FROM public.amazon_listings al
LEFT JOIN mapped mp
  ON mp.amazon_listing_id = al.id
LEFT JOIN public.products p
  ON p.id = mp.kk_product_id
LEFT JOIN variant_stats vs
  ON vs.product_id = p.id
LEFT JOIN issue_stats ist
  ON ist.amazon_listing_id = al.id;

COMMENT ON VIEW public.v_amazon_listing_workspace IS
  'Denormalized Amazon listing workspace for Synced Listings admin tab. Includes stale detection (24h threshold).';

GRANT SELECT ON public.v_amazon_listing_workspace TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_amazon_stale_listings AS
SELECT
  amazon_listing_id,
  seller_account_id,
  marketplace_id,
  seller_sku,
  asin,
  amazon_title,
  listing_status,
  last_synced_at,
  hours_since_sync,
  stale_reason
FROM public.v_amazon_listing_workspace
WHERE is_stale = true;

COMMENT ON VIEW public.v_amazon_stale_listings IS
  'Mapped or unmapped Amazon listings whose last_synced_at is null or older than 24 hours.';

GRANT SELECT ON public.v_amazon_stale_listings TO authenticated, service_role;
