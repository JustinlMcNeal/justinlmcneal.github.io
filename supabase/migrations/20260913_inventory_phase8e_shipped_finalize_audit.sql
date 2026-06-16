-- Phase 8E — shipped-order finalize audit (read-only).
-- No stock/reservation/ledger mutations.

CREATE OR REPLACE VIEW public.v_inventory_shipped_finalize_audit AS
WITH line_enriched AS (
  SELECT
    li.stripe_checkout_session_id AS source_order_id,
    li.stripe_line_item_id AS source_order_item_id,
    li.variant_id,
    pv.product_id,
    li.product_id AS line_product_code,
    COALESCE(p.name, li.product_name, 'Unknown') AS product_label,
    COALESCE(NULLIF(BTRIM(pv.sku), ''), NULLIF(BTRIM(li.product_id), ''), '—') AS sku,
    li.product_name AS title,
    li.quantity,
    o.refund_status,
    o.kk_order_id,
    fs.label_status AS fulfillment_status,
    fs.carrier,
    fs.service,
    CASE
      WHEN COALESCE(o.refund_status, '') = 'full' THEN 'refunded'
      WHEN COALESCE(o.refund_status, '') = 'partial' THEN 'partial_refund'
      ELSE 'paid'
    END AS payment_status,
    CASE
      WHEN COALESCE(fs.label_status, 'pending') IN ('shipped', 'delivered') THEN fs.label_status
      WHEN COALESCE(fs.label_status, 'pending') IN ('cancelled', 'voided') THEN 'canceled'
      ELSE COALESCE(fs.label_status, 'pending')
    END AS order_status,
    CASE
      WHEN o.stripe_checkout_session_id LIKE 'ebay_%' THEN 'ebay'
      WHEN o.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
      ELSE 'kk'
    END AS source_channel,
    CASE
      WHEN o.stripe_checkout_session_id LIKE 'amazon_%'
        AND fs.carrier = 'Amazon'
        AND COALESCE(fs.service, '') ILIKE '%Fulfilled by Amazon%'
        THEN 'afn'
      WHEN o.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon_mfn'
      WHEN o.stripe_checkout_session_id LIKE 'ebay_%' THEN 'ebay'
      ELSE 'kk'
    END AS fulfillment_channel,
    (
      o.stripe_checkout_session_id LIKE 'amazon_%'
      AND fs.carrier = 'Amazon'
      AND COALESCE(fs.service, '') ILIKE '%Fulfilled by Amazon%'
    ) AS is_afn
  FROM public.line_items_raw li
  JOIN public.orders_raw o
    ON o.stripe_checkout_session_id = li.stripe_checkout_session_id
  LEFT JOIN public.fulfillment_shipments fs
    ON fs.stripe_checkout_session_id = li.stripe_checkout_session_id
  LEFT JOIN public.product_variants pv ON pv.id = li.variant_id
  LEFT JOIN public.products p ON p.id = pv.product_id
  WHERE COALESCE(fs.label_status, 'pending') IN ('shipped', 'delivered')
),
with_signals AS (
  SELECT
    le.*,
    ir.id AS existing_reservation_id,
    ir.status AS reservation_status,
    ir.finalize_ledger_id,
    CASE WHEN ir.status = 'finalized' THEN ir.updated_at END AS finalized_at,
    sl.id AS matching_ledger_id,
    sl.reason AS matching_ledger_reason
  FROM line_enriched le
  LEFT JOIN LATERAL (
    SELECT r.id, r.status, r.finalize_ledger_id, r.updated_at
    FROM public.inventory_reservations r
    WHERE r.order_id = le.source_order_id
      AND r.order_item_id = le.source_order_item_id
      AND COALESCE(r.is_shadow, false) = false
    ORDER BY r.created_at DESC
    LIMIT 1
  ) ir ON true
  LEFT JOIN LATERAL (
    SELECT sl2.id, sl2.reason
    FROM public.stock_ledger sl2
    WHERE le.variant_id IS NOT NULL
      AND sl2.variant_id = le.variant_id
      AND sl2.change < 0
      AND sl2.reason IN ('order', 'order_finalized')
      AND (
        sl2.reference_id = le.source_order_id
        OR sl2.reference_id = le.kk_order_id
        OR sl2.reference_id = le.source_order_item_id
      )
    ORDER BY sl2.created_at DESC
    LIMIT 1
  ) sl ON true
),
classified AS (
  SELECT
    ws.*,
    CASE
      WHEN ws.is_afn THEN 'skipped_afn'
      WHEN ws.variant_id IS NULL THEN 'missing_variant'
      WHEN COALESCE(ws.refund_status, '') = 'full' THEN 'refunded_after_ship'
      WHEN ws.order_status = 'canceled' THEN 'manual_review'
      WHEN ws.reservation_status = 'finalized' OR ws.finalize_ledger_id IS NOT NULL THEN 'accounted_for'
      WHEN ws.matching_ledger_id IS NOT NULL THEN 'accounted_for'
      WHEN ws.reservation_status = 'reserved' THEN 'missing_finalize_record'
      WHEN ws.existing_reservation_id IS NULL AND ws.matching_ledger_id IS NULL THEN 'missing_finalize_record'
      ELSE 'manual_review'
    END AS suggested_audit_status
  FROM with_signals ws
)
SELECT
  source_channel,
  source_order_id,
  source_order_item_id,
  product_id,
  variant_id,
  product_label,
  sku,
  title,
  quantity,
  order_status,
  fulfillment_status,
  payment_status,
  refund_status,
  fulfillment_channel,
  existing_reservation_id,
  reservation_status,
  finalized_at,
  matching_ledger_id,
  matching_ledger_reason,
  suggested_audit_status,
  CASE suggested_audit_status
    WHEN 'accounted_for' THEN 'low'
    WHEN 'skipped_afn' THEN 'low'
    WHEN 'refunded_after_ship' THEN 'low'
    WHEN 'missing_finalize_record' THEN 'high'
    WHEN 'missing_ledger' THEN 'high'
    WHEN 'missing_variant' THEN 'medium'
    ELSE 'medium'
  END AS severity,
  CASE suggested_audit_status
    WHEN 'accounted_for' THEN 'Finalized reservation or matching stock ledger decrement found'
    WHEN 'skipped_afn' THEN 'Amazon AFN/FBA — external fulfillment, no local deduction expected'
    WHEN 'missing_finalize_record' THEN 'Shipped line lacks finalized reservation and ledger signal'
    WHEN 'missing_variant' THEN 'Shipped line has no variant_id — map before auditing inventory impact'
    WHEN 'refunded_after_ship' THEN 'Fully refunded after shipment — review manually'
    WHEN 'manual_review' THEN 'Ambiguous accounting — review reservation and ledger history'
    ELSE 'Review manually'
  END AS reason,
  (
    variant_id IS NOT NULL
    AND NOT is_afn
    AND COALESCE(refund_status, '') <> 'full'
    AND order_status <> 'canceled'
    AND suggested_audit_status IN ('missing_finalize_record', 'missing_ledger')
  ) AS needs_audit_issue
FROM classified;

COMMENT ON VIEW public.v_inventory_shipped_finalize_audit IS
  'Read-only shipped/delivered order-line inventory accounting audit (Phase 8E).';

GRANT SELECT ON public.v_inventory_shipped_finalize_audit TO authenticated, service_role;

-- Extend issue summaries with shipped finalize audit group.
CREATE OR REPLACE VIEW public.v_inventory_issues AS
WITH issue_counts AS (
  SELECT
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true) AND COALESCE(pv.stock, 0) < 0
    )::bigint AS negative_stock,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true) AND COALESCE(pv.stock, 0) > 0
        AND COALESCE(pv.stock, 0) <= 3
    )::bigint AS low_stock,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND NULLIF(BTRIM(COALESCE(pv.sku, '')), '') IS NULL
    )::bigint AS missing_sku,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true) AND p.ebay_offer_id IS NOT NULL
        AND p.ebay_listing_id IS NULL
    )::bigint AS ebay_mapping_missing,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND EXISTS (
          SELECT 1 FROM public.amazon_listing_mappings m2
          WHERE m2.kk_product_id = p.id AND m2.mapping_status = 'mapped'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.amazon_listing_mappings m3
          WHERE m3.kk_variant_id = pv.id AND m3.mapping_status = 'mapped'
        )
    )::bigint AS amazon_mapping_missing,
    (
      SELECT COUNT(*)::bigint FROM public.parcel_import_item_mappings m
      JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
      WHERE m.row_type = 'business_inventory' AND pi.status = 'approved'
        AND pi.inventory_received_at IS NULL
        AND (m.mapping_status <> 'matched' OR m.product_variant_id IS NULL)
    ) AS parcel_mapping_missing,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true) AND p.ebay_listing_id IS NOT NULL
        AND LOWER(COALESCE(p.ebay_status, '')) IN ('ended', 'out_of_stock')
    )::bigint AS ebay_listing_ended,
    COUNT(*) FILTER (
      WHERE COALESCE(pv.is_active, true)
        AND EXISTS (
          SELECT 1 FROM public.amazon_listing_mappings m
          JOIN public.amazon_listings al ON al.id = m.amazon_listing_id
          WHERE m.kk_variant_id = pv.id AND m.mapping_status = 'mapped'
            AND (
              COALESCE(al.listing_status_buyable, false) = false
              OR LOWER(COALESCE(al.listing_status, '')) IN ('inactive', 'incomplete', 'suppressed')
            )
        )
    )::bigint AS amazon_listing_inactive,
    (
      SELECT COUNT(*)::bigint FROM public.v_inventory_unmapped_order_lines u
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
  WHERE r.status = 'failed' AND run.mode IN ('push', 'dry_run')
    AND r.created_at > now() - interval '7 days'
),
audit_issue_counts AS (
  SELECT COUNT(*)::bigint AS shipped_finalize_audit_needed
  FROM public.v_inventory_shipped_finalize_audit a
  WHERE a.needs_audit_issue = true
)
SELECT issues.issue_id, issues.issue_type, issues.issue_label, issues.severity,
  issues.description, issues.affected_count, issues.source, issues.reference, now() AS updated_at
FROM (
  SELECT 'negative_stock'::text, 'negative_stock'::text, 'Negative Stock'::text, 'critical'::text,
    'On-hand quantity below zero — fulfillment may exceed physical stock.'::text,
    ic.negative_stock, 'product_variants'::text, NULL::text
  FROM issue_counts ic WHERE ic.negative_stock > 0
  UNION ALL SELECT 'low_stock', 'low_stock', 'Low Stock', 'medium',
    'Active variants at or below the low-stock threshold (1–3 units).',
    ic.low_stock, 'product_variants', NULL FROM issue_counts ic WHERE ic.low_stock > 0
  UNION ALL SELECT 'missing_sku', 'missing_sku', 'Missing SKU', 'high',
    'Variants without an internal SKU — harder to map orders and channels.',
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
  UNION ALL SELECT 'negative_available', 'negative_available', 'Negative Available', 'critical',
    'Reserved quantity exceeds on-hand — available qty is negative.',
    sic.negative_available, 'v_inventory_channel_sync_candidates', NULL
  FROM sync_issue_counts sic WHERE sic.negative_available > 0
  UNION ALL SELECT 'ebay_qty_cache_missing', 'ebay_qty_cache_missing', 'eBay Qty Cache Missing', 'medium',
    'Active eBay listings without cached quantity — refresh eBay cache before sync.',
    sic.ebay_qty_cache_missing, 'v_inventory_channel_sync_candidates', NULL
  FROM sync_issue_counts sic WHERE sic.ebay_qty_cache_missing > 0
  UNION ALL SELECT 'ebay_unsupported_variation', 'ebay_unsupported_variation', 'eBay Unsupported Variation', 'medium',
    'Multi-variant eBay group listings require manual per-SKU handling.',
    sic.ebay_unsupported_variation, 'v_inventory_channel_sync_candidates', NULL
  FROM sync_issue_counts sic WHERE sic.ebay_unsupported_variation > 0
  UNION ALL SELECT 'channel_sync_failed', 'channel_sync_failed', 'Channel Sync Failed', 'high',
    'Recent Amazon or eBay quantity sync attempts failed (last 7 days).',
    sfc.channel_sync_failed, 'inventory_channel_sync_results', NULL
  FROM sync_fail_counts sfc WHERE sfc.channel_sync_failed > 0
  UNION ALL SELECT 'shipped_finalize_audit_needed', 'shipped_finalize_audit_needed',
    'Shipped Finalize Audit Needed', 'high',
    'Shipped/delivered lines lack finalized reservation or stock ledger accounting signal.',
    aic.shipped_finalize_audit_needed, 'v_inventory_shipped_finalize_audit', NULL
  FROM audit_issue_counts aic WHERE aic.shipped_finalize_audit_needed > 0
) AS issues(issue_id, issue_type, issue_label, severity, description, affected_count, source, reference);

COMMENT ON VIEW public.v_inventory_issues IS
  'Grouped inventory issue summaries including shipped finalize audit (Phase 8E).';
