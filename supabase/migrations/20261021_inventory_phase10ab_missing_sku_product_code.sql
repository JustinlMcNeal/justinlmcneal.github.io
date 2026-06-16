-- Phase 10AB — Treat product.code as SKU when variant.sku is unset (schema intent).
-- Fixes false "Missing SKU" (212) and is_unmapped flags for catalog with product codes only.

CREATE OR REPLACE VIEW public.v_inventory_issues_core AS
WITH issue_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND COALESCE(pv.stock, 0) < 0)::bigint AS negative_stock,
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND COALESCE(pv.stock, 0) > 0 AND COALESCE(pv.stock, 0) <= 3)::bigint AS low_stock,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND NULLIF(BTRIM(COALESCE(pv.sku, '')), '') IS NULL
        AND NULLIF(BTRIM(COALESCE(p.code, '')), '') IS NULL
    )::bigint AS missing_sku,
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND p.ebay_offer_id IS NOT NULL AND p.ebay_listing_id IS NULL)::bigint AS ebay_mapping_missing,
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND EXISTS (
      SELECT 1 FROM public.amazon_listing_mappings m2
      WHERE m2.kk_product_id = p.id AND m2.mapping_status = 'mapped'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.amazon_listing_mappings m3
      WHERE m3.kk_variant_id = pv.id AND m3.mapping_status = 'mapped'
    ))::bigint AS amazon_mapping_missing,
    (SELECT COUNT(*)::bigint FROM public.parcel_import_item_mappings m
     JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
     WHERE m.row_type = 'business_inventory' AND pi.status = 'approved' AND pi.inventory_received_at IS NULL
       AND (m.mapping_status <> 'matched' OR m.product_variant_id IS NULL)) AS parcel_mapping_missing,
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND p.ebay_listing_id IS NOT NULL
      AND LOWER(COALESCE(p.ebay_status, '')) IN ('ended', 'out_of_stock'))::bigint AS ebay_listing_ended,
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND EXISTS (
      SELECT 1 FROM public.amazon_listing_mappings m
      JOIN public.amazon_listings al ON al.id = m.amazon_listing_id
      WHERE m.kk_variant_id = pv.id AND m.mapping_status = 'mapped'
        AND (COALESCE(al.listing_status_buyable, false) = false
          OR LOWER(COALESCE(al.listing_status, '')) IN ('inactive', 'incomplete', 'suppressed'))
    ))::bigint AS amazon_listing_inactive,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_unmapped_order_lines u WHERE u.reason <> 'afn_skip') AS unmapped_order_line
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
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
  issues.reference
FROM (
  SELECT 'negative_stock'::text, 'negative_stock'::text, 'Negative Stock'::text, 'critical'::text,
    'On-hand quantity below zero — fulfillment may exceed physical stock.'::text,
    ic.negative_stock, 'product_variants'::text, NULL::text FROM issue_counts ic WHERE ic.negative_stock > 0
  UNION ALL SELECT 'low_stock', 'low_stock', 'Low Stock', 'medium',
    'Active variants at or below the low-stock threshold (1–3 units).',
    ic.low_stock, 'product_variants', NULL FROM issue_counts ic WHERE ic.low_stock > 0
  UNION ALL SELECT 'missing_sku', 'missing_sku', 'Missing SKU', 'high',
    'Variants without an internal SKU or product code — harder to map orders and channels.',
    ic.missing_sku, 'product_variants', NULL FROM issue_counts ic WHERE ic.missing_sku > 0
  UNION ALL SELECT 'ebay_mapping_missing', 'ebay_mapping_missing', 'eBay Mapping Missing', 'high',
    'Products with an eBay offer but no listing id — channel link incomplete.',
    ic.ebay_mapping_missing, 'products', NULL FROM issue_counts ic WHERE ic.ebay_mapping_missing > 0
  UNION ALL SELECT 'amazon_mapping_missing', 'amazon_mapping_missing', 'Amazon Mapping Missing', 'high',
    'Variants on products with Amazon listings but no variant-level mapping.',
    ic.amazon_mapping_missing, 'amazon_listing_mappings', NULL FROM issue_counts ic WHERE ic.amazon_mapping_missing > 0
  UNION ALL SELECT 'parcel_mapping_missing', 'parcel_mapping_missing', 'Parcel Mapping Missing', 'high',
    'Approved parcel import rows not mapped to KK products — stock not received.',
    ic.parcel_mapping_missing, 'parcel_import_item_mappings', NULL FROM issue_counts ic WHERE ic.parcel_mapping_missing > 0
  UNION ALL SELECT 'unmapped_order_line', 'unmapped_order_line', 'Unmapped Order Lines', 'high',
    'Order lines need variant mapping before inventory can reserve or deduct.',
    ic.unmapped_order_line, 'orders', NULL FROM issue_counts ic WHERE ic.unmapped_order_line > 0
  UNION ALL SELECT 'ebay_listing_ended', 'ebay_listing_ended', 'eBay Listing Ended', 'medium',
    'eBay listing ended or out of stock — restock may require relist flow.',
    ic.ebay_listing_ended, 'products', NULL FROM issue_counts ic WHERE ic.ebay_listing_ended > 0
  UNION ALL SELECT 'amazon_listing_inactive', 'amazon_listing_inactive', 'Amazon Listing Inactive', 'medium',
    'Mapped Amazon listing inactive or not buyable — channel may not be selling.',
    ic.amazon_listing_inactive, 'amazon_listings', NULL FROM issue_counts ic WHERE ic.amazon_listing_inactive > 0
  UNION ALL SELECT 'channel_sync_failed', 'channel_sync_failed', 'Channel Sync Failed', 'high',
    'Recent Amazon or eBay quantity sync attempts failed (last 7 days).',
    sfc.channel_sync_failed, 'inventory_channel_sync_results', NULL
  FROM sync_fail_counts sfc WHERE sfc.channel_sync_failed > 0
) AS issues(issue_id, issue_type, issue_label, severity, description, affected_count, source, reference);

COMMENT ON VIEW public.v_inventory_issues_core IS
  'Fast live inventory issue counts — missing_sku requires both variant.sku and product.code empty (10AB).';

-- Patch workspace flags: missing SKU only when no product code either.
CREATE OR REPLACE VIEW public.v_inventory_workspace AS
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
    NULL::integer AS ebay_stock, av.amazon_stock,
    p.ebay_sku, p.ebay_listing_id, p.ebay_offer_id, COALESCE(p.ebay_status, 'not_listed') AS ebay_listing_status,
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
  WHERE COALESCE(pv.is_active, true) = true
)
SELECT
  vb.*,
  COALESCE(NULLIF(BTRIM(vb.variant_sku), ''), vb.short_sku || '-' || LEFT(vb.variant_id::text, 8)) AS internal_sku,
  CASE
    WHEN vb.on_hand < 0 THEN 'issue'
    WHEN vb.on_hand > 0 AND vb.on_hand <= vb.low_stock_threshold THEN 'low'
    WHEN vb.on_hand < 0
      OR (vb.variant_sku IS NULL AND NULLIF(BTRIM(vb.short_sku), '') IS NULL)
      OR vb.has_parcel_unmapped
      OR (vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL)
      OR (vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping)
      OR (vb.amazon_listing_id IS NOT NULL AND (
        COALESCE(vb.amazon_listing_buyable, false) = false
        OR LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')))
      OR (vb.ebay_listing_id IS NOT NULL AND LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock'))
      OR (vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand)
    THEN 'issue'
    ELSE 'healthy'
  END AS status,
  (
    vb.on_hand < 0
    OR (vb.variant_sku IS NULL AND NULLIF(BTRIM(vb.short_sku), '') IS NULL)
    OR vb.has_parcel_unmapped
    OR (vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL)
    OR (vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping)
    OR (vb.amazon_listing_id IS NOT NULL AND (
      COALESCE(vb.amazon_listing_buyable, false) = false
      OR LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')))
    OR (vb.ebay_listing_id IS NOT NULL AND LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock'))
    OR (vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand)
  ) AS has_issue,
  (
    vb.has_parcel_unmapped
    OR (vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL)
    OR (vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping)
  ) AS is_unmapped,
  CASE
    WHEN vb.amazon_listing_id IS NULL AND NOT (
      vb.ebay_listing_id IS NOT NULL AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed'))
    THEN 'never'
    WHEN vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand THEN 'mismatch'
    WHEN vb.amazon_last_synced_at IS NOT NULL AND vb.amazon_last_synced_at < (now() - interval '24 hours') THEN 'stale'
    WHEN vb.amazon_listing_id IS NOT NULL OR (
      vb.ebay_listing_id IS NOT NULL AND COALESCE(vb.ebay_listing_status, 'not_listed') NOT IN ('not_listed'))
    THEN 'synced'
    ELSE 'never'
  END AS sync_state,
  COALESCE(vb.last_ledger_at, now()) AS updated_at,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN vb.on_hand < 0 THEN 'negative_stock' END,
    CASE WHEN vb.on_hand > 0 AND vb.on_hand <= vb.low_stock_threshold THEN 'low_stock' END,
    CASE WHEN vb.variant_sku IS NULL AND NULLIF(BTRIM(vb.short_sku), '') IS NULL THEN 'missing_sku' END,
    CASE WHEN vb.ebay_offer_id IS NOT NULL AND vb.ebay_listing_id IS NULL THEN 'ebay_mapping_missing' END,
    CASE WHEN vb.product_has_amazon_mapping AND NOT vb.has_amazon_mapping THEN 'amazon_mapping_missing' END,
    CASE WHEN vb.has_parcel_unmapped THEN 'parcel_mapping_missing' END,
    CASE WHEN vb.ebay_listing_id IS NOT NULL AND LOWER(COALESCE(vb.ebay_listing_status, '')) IN ('ended', 'out_of_stock') THEN 'ebay_listing_ended' END,
    CASE WHEN vb.amazon_listing_id IS NOT NULL AND (
      COALESCE(vb.amazon_listing_buyable, false) = false
      OR LOWER(COALESCE(vb.amazon_listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')) THEN 'amazon_listing_inactive' END,
    CASE WHEN vb.amazon_stock IS NOT NULL AND vb.amazon_stock <> vb.on_hand THEN 'channel_sync_mismatch' END
  ], NULL) AS issue_types
FROM variant_base vb;

COMMENT ON VIEW public.v_inventory_workspace IS
  'Inventory workspace rows — is_unmapped excludes missing variant SKU when product.code exists (10AB).';

GRANT SELECT ON public.v_inventory_workspace TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_inventory_issues AS
SELECT c.issue_id, c.issue_type, c.issue_label, c.severity, c.description,
  c.affected_count, c.source, c.reference, now() AS updated_at
FROM public.v_inventory_issues_core c
UNION ALL
SELECT s.issue_id, s.issue_type, s.issue_label, s.severity, s.description,
  s.affected_count, s.source, s.reference, s.refreshed_at AS updated_at
FROM public.inventory_issue_snapshots s
WHERE s.affected_count > 0;

GRANT SELECT ON public.v_inventory_issues TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_inventory_issues_with_state AS
SELECT
  i.issue_id, i.issue_type, i.issue_label, i.severity, i.description,
  i.affected_count, i.source, i.reference, i.updated_at,
  COALESCE(s.status, 'open'::text) AS workflow_status,
  s.snoozed_until, s.resolution_note, s.id AS issue_state_id, s.updated_at AS state_updated_at,
  (COALESCE(s.status, 'open') NOT IN ('resolved', 'ignored')
    AND NOT (COALESCE(s.status, 'open') = 'snoozed' AND s.snoozed_until IS NOT NULL AND s.snoozed_until > now())
  ) AS is_active_workflow,
  (COALESCE(s.status, 'open') = 'snoozed' AND s.snoozed_until IS NOT NULL AND s.snoozed_until > now()) AS is_snoozed_active
FROM public.v_inventory_issues i
LEFT JOIN public.inventory_issue_states s ON s.issue_key = ('group:' || i.issue_type);

GRANT SELECT ON public.v_inventory_issues_with_state TO authenticated, service_role;
