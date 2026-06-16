-- 20260824_inventory_phase3b_workspace_issues.sql
--
-- Phase 3B — read-only inventory workspace table + issues summary views.
-- No stock mutations, reservations, or channel sync logic.

-- ── v_inventory_workspace — one row per active variant ────────────────────────

CREATE OR REPLACE VIEW public.v_inventory_workspace AS
WITH ledger_latest AS (
  SELECT
    sl.variant_id,
    MAX(sl.created_at) AS last_ledger_at
  FROM public.stock_ledger sl
  GROUP BY sl.variant_id
),
amazon_variant AS (
  SELECT DISTINCT ON (m.kk_variant_id)
    m.kk_variant_id,
    al.id AS amazon_listing_id,
    al.asin AS amazon_asin,
    al.seller_sku AS amazon_seller_sku,
    al.fbm_quantity AS amazon_stock,
    al.listing_status AS amazon_listing_status,
    al.listing_status_buyable AS amazon_listing_buyable,
    al.last_synced_at AS amazon_last_synced_at
  FROM public.amazon_listing_mappings m
  JOIN public.amazon_listings al ON al.id = m.amazon_listing_id
  WHERE m.mapping_status = 'mapped'
    AND m.kk_variant_id IS NOT NULL
  ORDER BY m.kk_variant_id, m.mapped_at DESC NULLS LAST, m.created_at DESC
),
product_amazon_mapped AS (
  SELECT DISTINCT kk_product_id AS product_id
  FROM public.amazon_listing_mappings
  WHERE mapping_status = 'mapped'
    AND kk_product_id IS NOT NULL
),
parcel_variant_unmapped AS (
  SELECT
    m.product_variant_id AS variant_id,
    COUNT(*)::bigint AS unmapped_parcel_rows
  FROM public.parcel_import_item_mappings m
  JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
  WHERE m.row_type = 'business_inventory'
    AND pi.status = 'approved'
    AND pi.inventory_received_at IS NULL
    AND m.product_variant_id IS NOT NULL
    AND (
      m.mapping_status <> 'matched'
      OR m.product_variant_id IS NULL
    )
  GROUP BY m.product_variant_id
),
variant_base AS (
  SELECT
    pv.id AS variant_id,
    p.id AS product_id,
    p.name AS product_title,
    COALESCE(
      NULLIF(BTRIM(pv.title), ''),
      NULLIF(BTRIM(pv.option_value), ''),
      'Default'
    ) AS variant_label,
    NULLIF(BTRIM(pv.option_name), '') AS option_name,
    NULLIF(BTRIM(pv.option_value), '') AS option_value,
    NULLIF(BTRIM(pv.sku), '') AS variant_sku,
    p.code AS short_sku,
    COALESCE(
      NULLIF(BTRIM(pv.preview_image_url), ''),
      NULLIF(BTRIM(p.primary_image_url), ''),
      NULLIF(BTRIM(p.catalog_image_url), '')
    ) AS image_url,
    COALESCE(pv.stock, 0) AS on_hand,
    0::integer AS reserved,
    COALESCE(pv.stock, 0) AS available,
    3::integer AS low_stock_threshold,
    COALESCE(pv.stock, 0) AS kk_stock,
    NULL::integer AS ebay_stock,
    av.amazon_stock,
    p.ebay_sku,
    p.ebay_listing_id,
    p.ebay_offer_id,
    COALESCE(p.ebay_status, 'not_listed') AS ebay_listing_status,
    av.amazon_listing_id,
    av.amazon_asin,
    av.amazon_seller_sku,
    av.amazon_listing_status,
    av.amazon_listing_buyable,
    av.amazon_last_synced_at,
    ll.last_ledger_at,
    COALESCE(pvu.unmapped_parcel_rows, 0) AS parcel_unmapped_rows,
    (pam.product_id IS NOT NULL) AS product_has_amazon_mapping,
    (av.amazon_listing_id IS NOT NULL) AS has_amazon_mapping,
    (
      p.ebay_listing_id IS NOT NULL
      AND COALESCE(p.ebay_status, 'not_listed') NOT IN ('not_listed')
    ) AS has_ebay_mapping,
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
  WHERE COALESCE(pv.is_active, true) = true
)
SELECT
  vb.*,
  COALESCE(
    NULLIF(BTRIM(vb.variant_sku), ''),
    vb.short_sku || '-' || LEFT(vb.variant_id::text, 8)
  ) AS internal_sku,
  CASE
    WHEN vb.on_hand < 0 THEN 'issue'
    WHEN vb.on_hand > 0 AND vb.on_hand <= vb.low_stock_threshold THEN 'low'
    WHEN vb.on_hand < 0
      OR vb.variant_sku IS NULL
      OR vb.has_parcel_unmapped
      OR (vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL)
      OR (vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping)
      OR (
        vb.amazon_listing_id IS NOT NULL
        AND (
          COALESCE(vb.amazon_listing_buyable, false) = false
          OR LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')
        )
      )
      OR (
        vb.ebay_listing_id IS NOT NULL
        AND LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock')
      )
      OR (vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand)
    THEN 'issue'
    ELSE 'healthy'
  END AS status,
  (
    vb.on_hand < 0
    OR vb.variant_sku IS NULL
    OR vb.has_parcel_unmapped
    OR (vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL)
    OR (vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping)
    OR (
      vb.amazon_listing_id IS NOT NULL
      AND (
        COALESCE(vb.amazon_listing_buyable, false) = false
        OR LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')
      )
    )
    OR (
      vb.ebay_listing_id IS NOT NULL
      AND LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock')
    )
    OR (vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand)
  ) AS has_issue,
  (
    vb.variant_sku IS NULL
    OR vb.has_parcel_unmapped
    OR (vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL)
    OR (vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping)
  ) AS is_unmapped,
  CASE
    WHEN vb.amazon_listing_id IS NULL
      AND NOT (
        vb.ebay_listing_id IS NOT NULL
        AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed')
      )
    THEN 'never'
    WHEN vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand THEN 'mismatch'
    WHEN vb.amazon_last_synced_at IS NOT NULL
      AND vb.amazon_last_synced_at < (now() - interval '24 hours')
    THEN 'stale'
    WHEN vb.amazon_listing_id IS NOT NULL
      OR (
        vb.ebay_listing_id IS NOT NULL
        AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed')
      )
    THEN 'synced'
    ELSE 'never'
  END AS sync_state,
  COALESCE(vb.last_ledger_at, now()) AS updated_at,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN vb.on_hand < 0 THEN 'negative_stock' END,
    CASE WHEN vb.on_hand > 0 AND vb.on_hand <= vb.low_stock_threshold THEN 'low_stock' END,
    CASE WHEN vb.variant_sku IS NULL THEN 'missing_sku' END,
    CASE
      WHEN vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL
      THEN 'ebay_mapping_missing'
    END,
    CASE
      WHEN vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping
      THEN 'amazon_mapping_missing'
    END,
    CASE WHEN vb.has_parcel_unmapped THEN 'parcel_mapping_missing' END,
    CASE
      WHEN vb.ebay_listing_id IS NOT NULL
        AND LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock')
      THEN 'ebay_listing_ended'
    END,
    CASE
      WHEN vb.amazon_listing_id IS NOT NULL
        AND (
          COALESCE(vb.amazon_listing_buyable, false) = false
          OR LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')
        )
      THEN 'amazon_listing_inactive'
    END
  ]::text[], NULL) AS issue_types
FROM variant_base vb;

COMMENT ON VIEW public.v_inventory_workspace IS
  'Active variant inventory rows for admin workspace table. ebay_stock NULL (no eBay qty cache). reserved=0 until reservations exist.';

-- ── v_inventory_issues — grouped issue summaries for footer panel ─────────────

CREATE OR REPLACE VIEW public.v_inventory_issues AS
WITH issue_counts AS (
  SELECT
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND COALESCE(pv.stock, 0) < 0
    )::bigint AS negative_stock,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND COALESCE(pv.stock, 0) > 0
        AND COALESCE(pv.stock, 0) <= 3
    )::bigint AS low_stock,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND NULLIF(BTRIM(COALESCE(pv.sku, '')), '') IS NULL
    )::bigint AS missing_sku,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND p.ebay_offer_id IS NOT NULL
        AND p.ebay_listing_id IS NULL
    )::bigint AS ebay_mapping_missing,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND EXISTS (
          SELECT 1
          FROM public.amazon_listing_mappings m2
          WHERE m2.kk_product_id = p.id
            AND m2.mapping_status = 'mapped'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.amazon_listing_mappings m3
          WHERE m3.kk_variant_id = pv.id
            AND m3.mapping_status = 'mapped'
        )
    )::bigint AS amazon_mapping_missing,
    (
      SELECT COUNT(*)::bigint
      FROM public.parcel_import_item_mappings m
      JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
      WHERE m.row_type = 'business_inventory'
        AND pi.status = 'approved'
        AND pi.inventory_received_at IS NULL
        AND (
          m.mapping_status <> 'matched'
          OR m.product_variant_id IS NULL
        )
    ) AS parcel_mapping_missing,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND p.ebay_listing_id IS NOT NULL
        AND LOWER(COALESCE(p.ebay_status, '')) IN ('ended', 'out_of_stock')
    )::bigint AS ebay_listing_ended,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND EXISTS (
          SELECT 1
          FROM public.amazon_listing_mappings m
          JOIN public.amazon_listings al ON al.id = m.amazon_listing_id
          WHERE m.kk_variant_id = pv.id
            AND m.mapping_status = 'mapped'
            AND (
              COALESCE(al.listing_status_buyable, false) = false
              OR LOWER(COALESCE(al.listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')
            )
        )
    )::bigint AS amazon_listing_inactive
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
)
SELECT
  issues.issue_id,
  issues.issue_type,
  issues.issue_label,
  issues.severity,
  issues.description,
  issues.affected_count,
  issues.source,
  issues.reference,
  now() AS updated_at
FROM (
  SELECT
    'negative_stock'::text AS issue_id,
    'negative_stock'::text AS issue_type,
    'Negative Stock'::text AS issue_label,
    'critical'::text AS severity,
    'On-hand quantity below zero — fulfillment may exceed physical stock.'::text AS description,
    ic.negative_stock AS affected_count,
    'product_variants'::text AS source,
    NULL::text AS reference
  FROM issue_counts ic
  WHERE ic.negative_stock > 0

  UNION ALL

  SELECT
    'low_stock',
    'low_stock',
    'Low Stock',
    'medium',
    'Active variants at or below the low-stock threshold (1–3 units).',
    ic.low_stock,
    'product_variants',
    NULL
  FROM issue_counts ic
  WHERE ic.low_stock > 0

  UNION ALL

  SELECT
    'missing_sku',
    'missing_sku',
    'Missing SKU',
    'high',
    'Variants without an internal SKU — harder to map orders and channels.',
    ic.missing_sku,
    'product_variants',
    NULL
  FROM issue_counts ic
  WHERE ic.missing_sku > 0

  UNION ALL

  SELECT
    'ebay_mapping_missing',
    'ebay_mapping_missing',
    'eBay Mapping Missing',
    'high',
    'Products with an eBay offer but no listing id — channel link incomplete.',
    ic.ebay_mapping_missing,
    'products',
    NULL
  FROM issue_counts ic
  WHERE ic.ebay_mapping_missing > 0

  UNION ALL

  SELECT
    'amazon_mapping_missing',
    'amazon_mapping_missing',
    'Amazon Mapping Missing',
    'high',
    'Variants on products with Amazon listings but no variant-level mapping.',
    ic.amazon_mapping_missing,
    'amazon_listing_mappings',
    NULL
  FROM issue_counts ic
  WHERE ic.amazon_mapping_missing > 0

  UNION ALL

  SELECT
    'parcel_mapping_missing',
    'parcel_mapping_missing',
    'Parcel Mapping Missing',
    'high',
    'Approved parcel import rows not mapped to KK products — stock not received.',
    ic.parcel_mapping_missing,
    'parcel_import_item_mappings',
    NULL
  FROM issue_counts ic
  WHERE ic.parcel_mapping_missing > 0

  UNION ALL

  SELECT
    'ebay_listing_ended',
    'ebay_listing_ended',
    'eBay Listing Ended',
    'medium',
    'eBay listing ended or out of stock — restock may require relist flow.',
    ic.ebay_listing_ended,
    'products',
    NULL
  FROM issue_counts ic
  WHERE ic.ebay_listing_ended > 0

  UNION ALL

  SELECT
    'amazon_listing_inactive',
    'amazon_listing_inactive',
    'Amazon Listing Inactive',
    'medium',
    'Mapped Amazon listing inactive or not buyable — channel may not be selling.',
    ic.amazon_listing_inactive,
    'amazon_listings',
    NULL
  FROM issue_counts ic
  WHERE ic.amazon_listing_inactive > 0
) AS issues;

COMMENT ON VIEW public.v_inventory_issues IS
  'Grouped inventory issue summaries for admin footer panel. Read-only derived counts; no inventory_issues table yet.';

GRANT SELECT ON public.v_inventory_workspace TO authenticated, service_role;
GRANT SELECT ON public.v_inventory_issues TO authenticated, service_role;
