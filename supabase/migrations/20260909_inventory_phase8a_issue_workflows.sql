-- Phase 8A — extend v_inventory_issues with channel/sync issue groups.

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
    )::bigint AS amazon_listing_inactive,
    (
      SELECT COUNT(*)::bigint
      FROM public.v_inventory_unmapped_order_lines u
      WHERE u.reason <> 'afn_skip'
    ) AS unmapped_order_line
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
),
sync_issue_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE sc.available_qty < 0)::bigint AS negative_available,
    COUNT(*) FILTER (WHERE sc.ebay_sync_action = 'qty_cache_missing')::bigint AS ebay_qty_cache_missing,
    COUNT(*) FILTER (WHERE sc.ebay_sync_action = 'unsupported_variation')::bigint AS ebay_unsupported_variation
  FROM public.v_inventory_channel_sync_candidates sc
),
sync_fail_counts AS (
  SELECT COUNT(*)::bigint AS channel_sync_failed
  FROM public.inventory_channel_sync_results r
  JOIN public.inventory_channel_sync_runs run ON run.id = r.run_id
  WHERE r.status = 'failed'
    AND run.mode IN ('push', 'dry_run')
    AND r.created_at > now() - interval '7 days'
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
  SELECT 'negative_stock'::text AS issue_id, 'negative_stock'::text AS issue_type,
    'Negative Stock'::text AS issue_label, 'critical'::text AS severity,
    'On-hand quantity below zero — fulfillment may exceed physical stock.'::text AS description,
    ic.negative_stock AS affected_count, 'product_variants'::text AS source, NULL::text AS reference
  FROM issue_counts ic WHERE ic.negative_stock > 0
  UNION ALL
  SELECT 'low_stock', 'low_stock', 'Low Stock', 'medium',
    'Active variants at or below the low-stock threshold (1–3 units).',
    ic.low_stock, 'product_variants', NULL FROM issue_counts ic WHERE ic.low_stock > 0
  UNION ALL
  SELECT 'missing_sku', 'missing_sku', 'Missing SKU', 'high',
    'Variants without an internal SKU — harder to map orders and channels.',
    ic.missing_sku, 'product_variants', NULL FROM issue_counts ic WHERE ic.missing_sku > 0
  UNION ALL
  SELECT 'ebay_mapping_missing', 'ebay_mapping_missing', 'eBay Mapping Missing', 'high',
    'Products with an eBay offer but no listing id — channel link incomplete.',
    ic.ebay_mapping_missing, 'products', NULL FROM issue_counts ic WHERE ic.ebay_mapping_missing > 0
  UNION ALL
  SELECT 'amazon_mapping_missing', 'amazon_mapping_missing', 'Amazon Mapping Missing', 'high',
    'Variants on products with Amazon listings but no variant-level mapping.',
    ic.amazon_mapping_missing, 'amazon_listing_mappings', NULL FROM issue_counts ic WHERE ic.amazon_mapping_missing > 0
  UNION ALL
  SELECT 'parcel_mapping_missing', 'parcel_mapping_missing', 'Parcel Mapping Missing', 'high',
    'Approved parcel import rows not mapped to KK products — stock not received.',
    ic.parcel_mapping_missing, 'parcel_import_item_mappings', NULL FROM issue_counts ic WHERE ic.parcel_mapping_missing > 0
  UNION ALL
  SELECT 'unmapped_order_line', 'unmapped_order_line', 'Unmapped Order Lines', 'high',
    'Order lines need variant mapping before inventory can reserve or deduct.',
    ic.unmapped_order_line, 'orders', NULL FROM issue_counts ic WHERE ic.unmapped_order_line > 0
  UNION ALL
  SELECT 'ebay_listing_ended', 'ebay_listing_ended', 'eBay Listing Ended', 'medium',
    'eBay listing ended or out of stock — restock may require relist flow.',
    ic.ebay_listing_ended, 'products', NULL FROM issue_counts ic WHERE ic.ebay_listing_ended > 0
  UNION ALL
  SELECT 'amazon_listing_inactive', 'amazon_listing_inactive', 'Amazon Listing Inactive', 'medium',
    'Mapped Amazon listing inactive or not buyable — channel may not be selling.',
    ic.amazon_listing_inactive, 'amazon_listings', NULL FROM issue_counts ic WHERE ic.amazon_listing_inactive > 0
  UNION ALL
  SELECT 'negative_available', 'negative_available', 'Negative Available', 'critical',
    'Reserved quantity exceeds on-hand — available qty is negative.',
    sic.negative_available, 'v_inventory_channel_sync_candidates', NULL
  FROM sync_issue_counts sic WHERE sic.negative_available > 0
  UNION ALL
  SELECT 'ebay_qty_cache_missing', 'ebay_qty_cache_missing', 'eBay Qty Cache Missing', 'medium',
    'Active eBay listings without cached quantity — refresh eBay cache before sync.',
    sic.ebay_qty_cache_missing, 'v_inventory_channel_sync_candidates', NULL
  FROM sync_issue_counts sic WHERE sic.ebay_qty_cache_missing > 0
  UNION ALL
  SELECT 'ebay_unsupported_variation', 'ebay_unsupported_variation', 'eBay Unsupported Variation', 'medium',
    'Multi-variant eBay group listings require manual per-SKU handling.',
    sic.ebay_unsupported_variation, 'v_inventory_channel_sync_candidates', NULL
  FROM sync_issue_counts sic WHERE sic.ebay_unsupported_variation > 0
  UNION ALL
  SELECT 'channel_sync_failed', 'channel_sync_failed', 'Channel Sync Failed', 'high',
    'Recent Amazon or eBay quantity sync attempts failed (last 7 days).',
    sfc.channel_sync_failed, 'inventory_channel_sync_results', NULL
  FROM sync_fail_counts sfc WHERE sfc.channel_sync_failed > 0
) AS issues;

COMMENT ON VIEW public.v_inventory_issues IS
  'Grouped inventory issue summaries including channel sync readiness (Phase 8A).';
