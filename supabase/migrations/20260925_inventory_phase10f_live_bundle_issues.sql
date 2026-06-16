-- Phase 10F — Live bundle issue groups + operation log.

CREATE TABLE IF NOT EXISTS public.inventory_bundle_live_issues (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type          text NOT NULL
                      CHECK (issue_type IN (
                        'bundle_component_reservation_failed',
                        'bundle_component_finalize_failed',
                        'bundle_live_readiness_blocked',
                        'bundle_component_shortage_live'
                      )),
  bundle_variant_id   uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  order_id            text,
  order_item_id       text,
  component_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  details             jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bundle_live_issues_open
  ON public.inventory_bundle_live_issues (issue_type, created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.inventory_bundle_live_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_bundle_live_issues_service_all
  ON public.inventory_bundle_live_issues FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_bundle_live_issues_authenticated_select
  ON public.inventory_bundle_live_issues FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.inventory_bundle_live_issues TO authenticated;
GRANT ALL ON public.inventory_bundle_live_issues TO service_role;

-- Log reservation failures from reserve_live_bundle_components.
CREATE OR REPLACE FUNCTION public.reserve_live_bundle_components(
  p_order_id            text,
  p_order_item_id       text,
  p_bundle_variant_id   uuid,
  p_quantity            integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty           integer;
  v_rule          record;
  v_comp_avail    integer;
  v_needed        integer;
  v_reserved      integer := 0;
  v_skipped       integer := 0;
  v_failed        integer := 0;
  v_idem          text;
  v_ins           uuid;
  v_issues        jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_bundle_live_deduction_enabled(p_bundle_variant_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'live_deduction_not_enabled');
  END IF;

  v_qty := GREATEST(COALESCE(p_quantity, 0), 0);
  IF v_qty <= 0 OR p_order_id IS NULL OR p_order_item_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  FOR v_rule IN
    SELECT br.component_variant_id, br.component_qty::integer AS component_qty, pv.product_id
    FROM public.inventory_bundle_rules br
    JOIN public.product_variants pv ON pv.id = br.component_variant_id
    WHERE br.bundle_variant_id = p_bundle_variant_id AND br.is_active
    ORDER BY br.component_variant_id
  LOOP
    v_needed := v_qty * v_rule.component_qty;

    SELECT GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0)::integer
    INTO v_comp_avail
    FROM public.product_variants pv
    LEFT JOIN (
      SELECT ir.variant_id, COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
      FROM public.inventory_reservations ir
      WHERE ir.status = 'reserved' AND COALESCE(ir.is_shadow, false) = false
      GROUP BY ir.variant_id
    ) vr ON vr.variant_id = pv.id
    WHERE pv.id = v_rule.component_variant_id;

    v_idem := format('bundle_component_reserve:%s:%s:%s', p_order_id, p_order_item_id, v_rule.component_variant_id);

    IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE idempotency_key = v_idem) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_comp_avail < v_needed THEN
      v_failed := v_failed + 1;
      v_issues := v_issues || jsonb_build_object(
        'component_variant_id', v_rule.component_variant_id,
        'required', v_needed,
        'available', v_comp_avail,
        'reason', 'component_shortage_live'
      );
      INSERT INTO public.inventory_bundle_live_issues (
        issue_type, bundle_variant_id, order_id, order_item_id,
        component_variant_id, details
      ) VALUES (
        'bundle_component_reservation_failed',
        p_bundle_variant_id, p_order_id, p_order_item_id,
        v_rule.component_variant_id,
        jsonb_build_object('required', v_needed, 'available', v_comp_avail)
      );
      CONTINUE;
    END IF;

    INSERT INTO public.inventory_reservations (
      channel, order_id, order_item_id, variant_id, product_id, quantity, status,
      is_shadow, idempotency_key, source_reference, reservation_kind,
      parent_bundle_variant_id, parent_order_item_id, notes
    ) VALUES (
      'kk', p_order_id, p_order_item_id, v_rule.component_variant_id, v_rule.product_id,
      v_needed, 'reserved', false, v_idem, p_order_id, 'bundle_component',
      p_bundle_variant_id, p_order_item_id,
      format('Live bundle component reserve (bundle %s qty %s)', p_bundle_variant_id, v_qty)
    )
    RETURNING id INTO v_ins;

    v_reserved := v_reserved + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', v_failed = 0,
    'reserved_components', v_reserved,
    'skipped_duplicate', v_skipped,
    'failed_components', v_failed,
    'issues', v_issues
  );
END;
$$;

-- Extend issue footer with live bundle groups (based on Phase 10A view + live counts).
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
  WHERE r.status = 'failed' AND run.mode IN ('push', 'dry_run') AND r.created_at > now() - interval '7 days'
),
audit_issue_counts AS (
  SELECT COUNT(*)::bigint AS shipped_finalize_audit_needed
  FROM public.v_inventory_shipped_finalize_audit a WHERE a.needs_audit_issue = true
),
bundle_issue_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE s.current_model = 'model_b_virtual_preview'
      AND (s.virtual_bundle_available IS NULL OR s.virtual_bundle_available <= 0))::bigint AS bundle_component_shortage,
    COUNT(*) FILTER (WHERE s.current_model = 'model_a_separate_stocked'
      AND s.detection_reason IN ('quantity_suffix', 'pack_pattern', 'bundle_keyword', 'kit_keyword'))::bigint AS bundle_rule_missing,
    (SELECT COUNT(*)::bigint FROM public.inventory_bundle_rules br WHERE br.bundle_variant_id = br.component_variant_id)::bigint AS bundle_self_reference
  FROM public.v_inventory_bundle_summary_preview s
),
live_bundle_issue_counts AS (
  SELECT
    (SELECT COUNT(*)::bigint FROM public.inventory_bundle_variant_settings vs
     JOIN public.v_inventory_bundle_cutover_readiness r ON r.bundle_variant_id = vs.bundle_variant_id
     WHERE vs.mode = 'live_requested' AND NOT COALESCE(r.is_ready_for_live, false)) AS bundle_live_readiness_blocked,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_summary_preview s
     WHERE public.is_bundle_live_deduction_enabled(s.bundle_variant_id)
       AND COALESCE(s.virtual_bundle_available, 0) <= 0) AS bundle_component_shortage_live,
    (SELECT COUNT(*)::bigint FROM public.inventory_bundle_live_issues i
     WHERE i.issue_type = 'bundle_component_reservation_failed' AND i.resolved_at IS NULL) AS bundle_component_reservation_failed,
    (SELECT COUNT(*)::bigint FROM public.inventory_bundle_live_issues i
     WHERE i.issue_type = 'bundle_component_finalize_failed' AND i.resolved_at IS NULL) AS bundle_component_finalize_failed
)
SELECT issues.issue_id, issues.issue_type, issues.issue_label, issues.severity,
  issues.description, issues.affected_count, issues.source, issues.reference, now() AS updated_at
FROM (
  SELECT 'negative_stock'::text, 'negative_stock'::text, 'Negative Stock'::text, 'critical'::text,
    'On-hand quantity below zero — fulfillment may exceed physical stock.'::text,
    ic.negative_stock, 'product_variants'::text, NULL::text FROM issue_counts ic WHERE ic.negative_stock > 0
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
  UNION ALL SELECT 'bundle_component_shortage', 'bundle_component_shortage',
    'Bundle Component Shortage (Preview)', 'low',
    'Preview only: configured virtual bundle would have zero availability from components.',
    bic.bundle_component_shortage, 'v_inventory_bundle_summary_preview', 'preview'
  FROM bundle_issue_counts bic WHERE bic.bundle_component_shortage > 0
  UNION ALL SELECT 'bundle_rule_missing', 'bundle_rule_missing', 'Bundle-Like SKU (Preview)', 'low',
    'Preview only: pack/bundle-like SKU defaults to separate stocked Model A.',
    bic.bundle_rule_missing, 'v_inventory_bundle_like_variants', 'preview'
  FROM bundle_issue_counts bic WHERE bic.bundle_rule_missing > 0
  UNION ALL SELECT 'bundle_self_reference', 'bundle_self_reference', 'Bundle Self-Reference (Preview)', 'low',
    'Preview only: invalid bundle rule references itself.',
    bic.bundle_self_reference, 'inventory_bundle_rules', 'preview'
  FROM bundle_issue_counts bic WHERE bic.bundle_self_reference > 0
  UNION ALL SELECT 'bundle_live_readiness_blocked', 'bundle_live_readiness_blocked',
    'Bundle Live Readiness Blocked', 'high',
    'Live requested but readiness blockers remain — cannot enable live deduction.',
    lbic.bundle_live_readiness_blocked, 'v_inventory_bundle_cutover_readiness', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_live_readiness_blocked > 0
  UNION ALL SELECT 'bundle_component_shortage_live', 'bundle_component_shortage_live',
    'Live Bundle Component Shortage', 'critical',
    'Live-enabled bundle has insufficient component availability for sales.',
    lbic.bundle_component_shortage_live, 'v_inventory_bundle_summary_preview', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_component_shortage_live > 0
  UNION ALL SELECT 'bundle_component_reservation_failed', 'bundle_component_reservation_failed',
    'Bundle Component Reservation Failed', 'critical',
    'Paid checkout could not reserve all components for a live bundle line.',
    lbic.bundle_component_reservation_failed, 'inventory_bundle_live_issues', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_component_reservation_failed > 0
  UNION ALL SELECT 'bundle_component_finalize_failed', 'bundle_component_finalize_failed',
    'Bundle Component Finalize Failed', 'critical',
    'Shipment finalization failed for live bundle component reservations.',
    lbic.bundle_component_finalize_failed, 'inventory_bundle_live_issues', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_component_finalize_failed > 0
) AS issues(issue_id, issue_type, issue_label, severity, description, affected_count, source, reference);

COMMENT ON VIEW public.v_inventory_issues IS
  'Grouped inventory issues including live virtual bundle groups (Phase 10F).';

GRANT SELECT ON public.v_inventory_issues TO authenticated, service_role;
