-- EMERGENCY RECOVERY — Karry Kraze (yxdzvzscufkvewecvagq)
-- Run in Supabase Dashboard → SQL Editor when it accepts queries.
-- Goal: stop connection starvation, replace heavy v_inventory_issues with a lite view.
--
-- After project is stable, apply the permanent fix:
--   supabase/migrations/20261020_inventory_phase10aa_issues_snapshot.sql

-- ── 1) Optional: cancel long-running queries (skip if this times out) ─────────
-- SELECT pg_cancel_backend(pid)
-- FROM pg_stat_activity
-- WHERE datname = current_database()
--   AND pid <> pg_backend_pid()
--   AND state = 'active'
--   AND now() - query_start > interval '30 seconds';

-- ── 2) Pause pg_cron jobs temporarily (reduces load while recovering) ───────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- ── 3) Lite issues view (core counts only — no return/bundle guidance scans) ─
CREATE OR REPLACE VIEW public.v_inventory_issues AS
WITH issue_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND COALESCE(pv.stock, 0) < 0)::bigint AS negative_stock,
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND COALESCE(pv.stock, 0) > 0 AND COALESCE(pv.stock, 0) <= 3)::bigint AS low_stock,
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND NULLIF(BTRIM(COALESCE(pv.sku, '')), '') IS NULL)::bigint AS missing_sku,
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND p.ebay_offer_id IS NOT NULL AND p.ebay_listing_id IS NULL)::bigint AS ebay_mapping_missing,
    COUNT(*) FILTER (WHERE COALESCE(pv.is_active, true) AND EXISTS (
      SELECT 1 FROM public.amazon_listing_mappings m2 WHERE m2.kk_product_id = p.id AND m2.mapping_status = 'mapped'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.amazon_listing_mappings m3 WHERE m3.kk_variant_id = pv.id AND m3.mapping_status = 'mapped'
    ))::bigint AS amazon_mapping_missing,
    (SELECT COUNT(*)::bigint FROM public.parcel_import_item_mappings m
     JOIN public.parcel_imports pi ON pi.id = m.parcel_import_id
     WHERE m.row_type = 'business_inventory' AND pi.status = 'approved' AND pi.inventory_received_at IS NULL
       AND (m.mapping_status <> 'matched' OR m.product_variant_id IS NULL)) AS parcel_mapping_missing,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_unmapped_order_lines u WHERE u.reason <> 'afn_skip') AS unmapped_order_line
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
)
SELECT issues.issue_id, issues.issue_type, issues.issue_label, issues.severity,
  issues.description, issues.affected_count, issues.source, issues.reference, now() AS updated_at
FROM (
  SELECT 'negative_stock'::text, 'negative_stock'::text, 'Negative Stock'::text, 'critical'::text,
    'On-hand quantity below zero.'::text, ic.negative_stock, 'product_variants'::text, NULL::text
  FROM issue_counts ic WHERE ic.negative_stock > 0
  UNION ALL SELECT 'low_stock', 'low_stock', 'Low Stock', 'medium',
    'Active variants at or below low-stock threshold.', ic.low_stock, 'product_variants', NULL
  FROM issue_counts ic WHERE ic.low_stock > 0
  UNION ALL SELECT 'missing_sku', 'missing_sku', 'Missing SKU', 'high',
    'Variants without an internal SKU.', ic.missing_sku, 'product_variants', NULL
  FROM issue_counts ic WHERE ic.missing_sku > 0
  UNION ALL SELECT 'ebay_mapping_missing', 'ebay_mapping_missing', 'eBay Mapping Missing', 'high',
    'Products with eBay offer but no listing id.', ic.ebay_mapping_missing, 'products', NULL
  FROM issue_counts ic WHERE ic.ebay_mapping_missing > 0
  UNION ALL SELECT 'amazon_mapping_missing', 'amazon_mapping_missing', 'Amazon Mapping Missing', 'high',
    'Variants missing variant-level Amazon mapping.', ic.amazon_mapping_missing, 'amazon_listing_mappings', NULL
  FROM issue_counts ic WHERE ic.amazon_mapping_missing > 0
  UNION ALL SELECT 'parcel_mapping_missing', 'parcel_mapping_missing', 'Parcel Mapping Missing', 'high',
    'Approved parcel rows not mapped to products.', ic.parcel_mapping_missing, 'parcel_import_item_mappings', NULL
  FROM issue_counts ic WHERE ic.parcel_mapping_missing > 0
  UNION ALL SELECT 'unmapped_order_line', 'unmapped_order_line', 'Unmapped Order Lines', 'high',
    'Order lines need variant mapping.', ic.unmapped_order_line, 'orders', NULL
  FROM issue_counts ic WHERE ic.unmapped_order_line > 0
) AS issues(issue_id, issue_type, issue_label, severity, description, affected_count, source, reference);

COMMENT ON VIEW public.v_inventory_issues IS
  'EMERGENCY lite core issues view — pair with Phase 10AA snapshot table for extended counts.';

GRANT SELECT ON public.v_inventory_issues TO authenticated, service_role;

-- ── 4) Recreate workflow overlay (cheap join on lite view) ────────────────────
CREATE OR REPLACE VIEW public.v_inventory_issues_with_state AS
SELECT
  i.issue_id, i.issue_type, i.issue_label, i.severity, i.description,
  i.affected_count, i.source, i.reference, i.updated_at,
  COALESCE(s.status, 'open'::text) AS workflow_status,
  s.snoozed_until, s.resolution_note, s.id AS issue_state_id,
  s.updated_at AS state_updated_at,
  (
    COALESCE(s.status, 'open') NOT IN ('resolved', 'ignored')
    AND NOT (COALESCE(s.status, 'open') = 'snoozed' AND s.snoozed_until IS NOT NULL AND s.snoozed_until > now())
  ) AS is_active_workflow,
  (
    COALESCE(s.status, 'open') = 'snoozed' AND s.snoozed_until IS NOT NULL AND s.snoozed_until > now()
  ) AS is_snoozed_active
FROM public.v_inventory_issues i
LEFT JOIN public.inventory_issue_states s ON s.issue_key = ('group:' || i.issue_type);

GRANT SELECT ON public.v_inventory_issues_with_state TO authenticated, service_role;

-- ── 5) Sanity check ─────────────────────────────────────────────────────────
SELECT issue_type, affected_count FROM public.v_inventory_issues ORDER BY affected_count DESC LIMIT 5;
