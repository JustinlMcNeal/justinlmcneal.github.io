-- Phase 058 (post-10Y patch) — Wire v_inventory_workspace.ebay_stock from ebay_listing_inventory_cache.
-- Read-only cache join; confidence rules aligned with Phase 7D/7F sync eligibility.
-- Does NOT touch issues snapshots, stock, reservations, or channel sync push.

DROP VIEW IF EXISTS public.v_inventory_workspace;

CREATE VIEW public.v_inventory_workspace AS
WITH ledger_latest AS (
  SELECT sl.variant_id, MAX(sl.created_at) AS last_ledger_at
  FROM public.stock_ledger sl
  GROUP BY sl.variant_id
),
variant_reserved AS (
  SELECT ir.variant_id, COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
  FROM public.inventory_reservations ir
  WHERE ir.status = 'reserved' AND ir.variant_id IS NOT NULL AND COALESCE(ir.is_shadow, false) = false
  GROUP BY ir.variant_id
),
amazon_variant AS (
  SELECT DISTINCT ON (m.kk_variant_id)
    m.kk_variant_id, al.id AS amazon_listing_id, al.asin AS amazon_asin,
    al.seller_sku AS amazon_seller_sku, al.fbm_quantity AS amazon_stock,
    al.listing_status AS amazon_listing_status, al.listing_status_buyable AS amazon_listing_buyable,
    al.last_synced_at AS amazon_last_synced_at
  FROM public.amazon_listing_mappings m
  JOIN public.amazon_listings al ON al.id = m.amazon_listing_id
  WHERE m.mapping_status = 'mapped' AND m.kk_variant_id IS NOT NULL
  ORDER BY m.kk_variant_id, m.mapped_at DESC NULLS LAST, m.created_at DESC
),
product_amazon_mapped AS (
  SELECT DISTINCT kk_product_id AS product_id
  FROM public.amazon_listing_mappings
  WHERE mapping_status = 'mapped' AND kk_product_id IS NOT NULL
),
parcel_variant_unmapped AS (
  SELECT m.product_variant_id AS variant_id, COUNT(*)::bigint AS unmapped_parcel_rows
  FROM public.parcel_import_item_mappings m
  JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
  WHERE m.row_type = 'business_inventory' AND pi.status = 'approved' AND pi.inventory_received_at IS NULL
    AND m.product_variant_id IS NOT NULL
    AND (m.mapping_status <> 'matched' OR m.product_variant_id IS NULL)
  GROUP BY m.product_variant_id
),
product_active_variants AS (
  SELECT product_id, COUNT(*)::integer AS active_variant_count
  FROM public.product_variants
  WHERE COALESCE(is_active, true) = true
  GROUP BY product_id
),
variant_base AS (
  SELECT
    pv.id AS variant_id, p.id AS product_id, p.name AS product_title,
    COALESCE(NULLIF(BTRIM(pv.title), ''), NULLIF(BTRIM(pv.option_value), ''), 'Default') AS variant_label,
    NULLIF(BTRIM(pv.option_name), '') AS option_name,
    NULLIF(BTRIM(pv.option_value), '') AS option_value,
    NULLIF(BTRIM(pv.sku), '') AS variant_sku,
    p.code AS short_sku,
    COALESCE(NULLIF(BTRIM(pv.preview_image_url), ''), NULLIF(BTRIM(p.primary_image_url), ''), NULLIF(BTRIM(p.catalog_image_url), '')) AS image_url,
    COALESCE(pv.stock, 0) AS on_hand, COALESCE(vr.reserved_qty, 0) AS reserved,
    COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0) AS available,
    3::integer AS low_stock_threshold, COALESCE(pv.stock, 0) AS kk_stock,
    av.amazon_stock,
    p.ebay_sku, p.ebay_listing_id, p.ebay_offer_id, p.ebay_item_group_key,
    COALESCE(p.ebay_status, 'not_listed') AS ebay_listing_status,
    COALESCE(pav.active_variant_count, 0) AS product_active_variant_count,
    ec_v.current_qty AS ebay_variant_cache_qty,
    ec_v.last_synced_at AS ebay_variant_cache_at,
    ec_v.listing_status AS ebay_variant_cache_status,
    ec_p.current_qty AS ebay_product_cache_qty,
    ec_p.last_synced_at AS ebay_product_cache_at,
    ec_p.listing_status AS ebay_product_cache_status,
    av.amazon_listing_id, av.amazon_asin, av.amazon_seller_sku, av.amazon_listing_status,
    av.amazon_listing_buyable, av.amazon_last_synced_at, ll.last_ledger_at,
    COALESCE(pvu.unmapped_parcel_rows, 0) AS parcel_unmapped_rows,
    (pam.product_id IS NOT NULL) AS product_has_amazon_mapping,
    (av.amazon_listing_id IS NOT NULL) AS has_amazon_mapping,
    (p.ebay_listing_id IS NOT NULL AND COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')) AS has_ebay_mapping,
    true AS has_kk_mapping,
    (COALESCE(pvu.unmapped_parcel_rows, 0) > 0) AS has_parcel_unmapped,
    LOWER(REGEXP_REPLACE(COALESCE(c.name, ''), '[^a-zA-Z0-9]+', '_', 'g')) AS category_slug
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  LEFT JOIN ledger_latest ll ON ll.variant_id = pv.id
  LEFT JOIN amazon_variant av ON av.kk_variant_id = pv.id
  LEFT JOIN product_amazon_mapped pam ON pam.product_id = p.id
  LEFT JOIN parcel_variant_unmapped pvu ON pvu.variant_id = pv.id
  LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
  LEFT JOIN product_active_variants pav ON pav.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT c.current_qty, c.last_synced_at, c.listing_status
    FROM public.ebay_listing_inventory_cache c
    WHERE c.product_id = p.id AND c.variant_id = pv.id
    ORDER BY c.last_synced_at DESC NULLS LAST
    LIMIT 1
  ) ec_v ON true
  LEFT JOIN LATERAL (
    SELECT c.current_qty, c.last_synced_at, c.listing_status
    FROM public.ebay_listing_inventory_cache c
    WHERE c.product_id = p.id AND c.variant_id IS NULL
    ORDER BY c.last_synced_at DESC NULLS LAST
    LIMIT 1
  ) ec_p ON true
  WHERE COALESCE(pv.is_active, true) = true
),
variant_ebay AS (
  SELECT
    vb.*,
    COALESCE(
      vb.ebay_variant_cache_status,
      vb.ebay_product_cache_status,
      vb.ebay_listing_status,
      'not_listed'
    ) AS ebay_effective_listing_status,
    (
      vb.ebay_item_group_key IS NOT NULL
      AND vb.product_active_variant_count > 1
      AND vb.ebay_variant_cache_qty IS NULL
    ) AS is_ebay_unsupported_variation,
    (
      LOWER(COALESCE(
        vb.ebay_variant_cache_status,
        vb.ebay_product_cache_status,
        vb.ebay_listing_status,
        ''
      )) IN ('ended', 'out_of_stock', 'withdrawn', 'inactive')
    ) AS is_ebay_ended_listing
  FROM variant_base vb
),
variant_ebay_enriched AS (
  SELECT
    ve.*,
    CASE
      WHEN NOT ve.has_ebay_mapping AND ve.ebay_offer_id IS NULL THEN 'no_mapping'
      WHEN ve.is_ebay_ended_listing THEN 'ended_listing'
      WHEN ve.is_ebay_unsupported_variation THEN 'unsupported_variation'
      WHEN ve.ebay_variant_cache_qty IS NOT NULL THEN 'variant_cache'
      WHEN ve.ebay_item_group_key IS NULL
        OR ve.product_active_variant_count <= 1
      THEN
        CASE
          WHEN ve.ebay_product_cache_qty IS NOT NULL THEN 'single_sku_cache'
          WHEN ve.has_ebay_mapping OR ve.ebay_offer_id IS NOT NULL THEN 'missing_cache'
          ELSE 'no_mapping'
        END
      WHEN ve.has_ebay_mapping OR ve.ebay_offer_id IS NOT NULL THEN 'missing_cache'
      ELSE 'no_mapping'
    END AS ebay_stock_source
  FROM variant_ebay ve
)
SELECT
  v.variant_id,
  v.product_id,
  v.product_title,
  v.variant_label,
  v.option_name,
  v.option_value,
  v.variant_sku,
  v.short_sku,
  v.image_url,
  v.on_hand,
  v.reserved,
  v.available,
  v.low_stock_threshold,
  v.kk_stock,
  CASE
    WHEN v.ebay_stock_source IN ('variant_cache', 'single_sku_cache')
      THEN COALESCE(
        CASE WHEN v.ebay_stock_source = 'variant_cache' THEN v.ebay_variant_cache_qty END,
        CASE WHEN v.ebay_stock_source = 'single_sku_cache' THEN v.ebay_product_cache_qty END
      )
    ELSE NULL
  END AS ebay_stock,
  v.amazon_stock,
  v.ebay_sku,
  v.ebay_listing_id,
  v.ebay_offer_id,
  v.ebay_listing_status,
  v.amazon_listing_id,
  v.amazon_asin,
  v.amazon_seller_sku,
  v.amazon_listing_status,
  COALESCE(NULLIF(BTRIM(v.variant_sku), ''), v.short_sku || '-' || LEFT(v.variant_id::text, 8)) AS internal_sku,
  CASE
    WHEN v.on_hand < 0 THEN 'issue'
    WHEN v.on_hand > 0 AND v.on_hand <= v.low_stock_threshold THEN 'low'
    WHEN v.on_hand < 0
      OR (v.variant_sku IS NULL AND NULLIF(BTRIM(v.short_sku), '') IS NULL)
      OR v.has_parcel_unmapped
      OR (v.ebay_offer_id IS NOT NULL AND v.ebay_listing_id IS NULL)
      OR (v.product_has_amazon_mapping AND NOT v.has_amazon_mapping)
      OR (v.amazon_listing_id IS NOT NULL AND (
        COALESCE(v.amazon_listing_buyable, false) = false
        OR LOWER(COALESCE(v.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')))
      OR (v.ebay_listing_id IS NOT NULL AND LOWER(COALESCE(v.ebay_listing_status, '')) IN ('ended', 'out_of_stock'))
      OR (v.amazon_stock IS NOT NULL AND v.amazon_stock <> v.on_hand)
    THEN 'issue'
    ELSE 'healthy'
  END AS status,
  (
    v.on_hand < 0
    OR (v.variant_sku IS NULL AND NULLIF(BTRIM(v.short_sku), '') IS NULL)
    OR v.has_parcel_unmapped
    OR (v.ebay_offer_id IS NOT NULL AND v.ebay_listing_id IS NULL)
    OR (v.product_has_amazon_mapping AND NOT v.has_amazon_mapping)
    OR (v.amazon_listing_id IS NOT NULL AND (
      COALESCE(v.amazon_listing_buyable, false) = false
      OR LOWER(COALESCE(v.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')))
    OR (v.ebay_listing_id IS NOT NULL AND LOWER(COALESCE(v.ebay_listing_status, '')) IN ('ended', 'out_of_stock'))
    OR (v.amazon_stock IS NOT NULL AND v.amazon_stock <> v.on_hand)
  ) AS has_issue,
  (
    v.has_parcel_unmapped
    OR (v.ebay_offer_id IS NOT NULL AND v.ebay_listing_id IS NULL)
    OR (v.product_has_amazon_mapping AND NOT v.has_amazon_mapping)
  ) AS is_unmapped,
  CASE
    WHEN v.amazon_listing_id IS NULL AND NOT (
      v.ebay_listing_id IS NOT NULL AND COALESCE(v.ebay_listing_status, 'not_listed') NOT IN ('not_listed'))
    THEN 'never'
    WHEN v.amazon_stock IS NOT NULL AND v.amazon_stock <> v.on_hand THEN 'mismatch'
    WHEN v.amazon_last_synced_at IS NOT NULL AND v.amazon_last_synced_at < (now() - interval '24 hours') THEN 'stale'
    WHEN v.amazon_listing_id IS NOT NULL OR (
      v.ebay_listing_id IS NOT NULL AND COALESCE(v.ebay_listing_status, 'not_listed') NOT IN ('not_listed'))
    THEN 'synced'
    ELSE 'never'
  END AS sync_state,
  COALESCE(v.last_ledger_at, now()) AS updated_at,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN v.on_hand < 0 THEN 'negative_stock' END,
    CASE WHEN v.on_hand > 0 AND v.on_hand <= v.low_stock_threshold THEN 'low_stock' END,
    CASE WHEN v.variant_sku IS NULL AND NULLIF(BTRIM(v.short_sku), '') IS NULL THEN 'missing_sku' END,
    CASE WHEN v.ebay_offer_id IS NOT NULL AND v.ebay_listing_id IS NULL THEN 'ebay_mapping_missing' END,
    CASE WHEN v.product_has_amazon_mapping AND NOT v.has_amazon_mapping THEN 'amazon_mapping_missing' END,
    CASE WHEN v.has_parcel_unmapped THEN 'parcel_mapping_missing' END,
    CASE WHEN v.ebay_listing_id IS NOT NULL AND LOWER(COALESCE(v.ebay_listing_status, '')) IN ('ended', 'out_of_stock') THEN 'ebay_listing_ended' END,
    CASE WHEN v.amazon_listing_id IS NOT NULL AND (
      COALESCE(v.amazon_listing_buyable, false) = false
      OR LOWER(COALESCE(v.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')) THEN 'amazon_listing_inactive' END,
    CASE WHEN v.amazon_stock IS NOT NULL AND v.amazon_stock <> v.on_hand THEN 'channel_sync_mismatch' END
  ], NULL) AS issue_types,
  v.ebay_stock_source,
  CASE
    WHEN v.ebay_stock_source = 'variant_cache' THEN v.ebay_variant_cache_at
    WHEN v.ebay_stock_source = 'single_sku_cache' THEN v.ebay_product_cache_at
    ELSE NULL
  END AS ebay_stock_cached_at,
  (
    v.ebay_stock_source IN ('variant_cache', 'single_sku_cache')
    AND CASE
      WHEN v.ebay_stock_source = 'variant_cache' THEN v.ebay_variant_cache_at
      WHEN v.ebay_stock_source = 'single_sku_cache' THEN v.ebay_product_cache_at
      ELSE NULL
    END IS NOT NULL
    AND CASE
      WHEN v.ebay_stock_source = 'variant_cache' THEN v.ebay_variant_cache_at
      WHEN v.ebay_stock_source = 'single_sku_cache' THEN v.ebay_product_cache_at
      ELSE NULL
    END < (now() - interval '24 hours')
  ) AS ebay_stock_is_stale,
  CASE
    WHEN v.ebay_stock_source IN ('variant_cache', 'single_sku_cache')
      AND CASE
        WHEN v.ebay_stock_source = 'variant_cache' THEN v.ebay_variant_cache_at
        WHEN v.ebay_stock_source = 'single_sku_cache' THEN v.ebay_product_cache_at
        ELSE NULL
      END IS NOT NULL
      AND CASE
        WHEN v.ebay_stock_source = 'variant_cache' THEN v.ebay_variant_cache_at
        WHEN v.ebay_stock_source = 'single_sku_cache' THEN v.ebay_product_cache_at
        ELSE NULL
      END < (now() - interval '24 hours')
      THEN 'Cached eBay quantity may be stale. Refresh eBay Cache.'
    WHEN v.ebay_stock_source = 'missing_cache' THEN 'eBay quantity not cached yet. Refresh eBay Cache in Sync Channels.'
    WHEN v.ebay_stock_source = 'unsupported_variation' THEN 'eBay variation inventory is not supported in this table yet.'
    WHEN v.ebay_stock_source = 'ended_listing' THEN 'eBay listing is ended.'
    WHEN v.ebay_stock_source = 'no_mapping' THEN 'No active eBay mapping for this variant.'
    ELSE NULL
  END AS ebay_stock_tooltip
FROM variant_ebay_enriched v;

COMMENT ON VIEW public.v_inventory_workspace IS
  'Inventory workspace rows. ebay_stock from ebay_listing_inventory_cache (Phase 058) — read-only cache join.';

GRANT SELECT ON public.v_inventory_workspace TO authenticated, service_role;
