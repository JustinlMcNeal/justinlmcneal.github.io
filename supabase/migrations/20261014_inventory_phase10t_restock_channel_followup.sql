-- Phase 10T — Post-restock channel follow-up checklist (informational only; no auto-sync).

CREATE TABLE IF NOT EXISTS public.inventory_restock_followup_states (
  restock_action_id  uuid PRIMARY KEY
    REFERENCES public.inventory_bundle_component_restock_actions(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'sync_not_needed', 'sync_completed', 'dismissed')),
  note               text,
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_restock_followup_states_status_idx
  ON public.inventory_restock_followup_states (status, updated_at DESC);

COMMENT ON TABLE public.inventory_restock_followup_states IS
  'Phase 10T: admin follow-up checklist state after component restock — no stock or channel mutations.';

ALTER TABLE public.inventory_restock_followup_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_restock_followup_states_select_authenticated
  ON public.inventory_restock_followup_states FOR SELECT TO authenticated USING (true);

CREATE POLICY inventory_restock_followup_states_service_all
  ON public.inventory_restock_followup_states FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.inventory_restock_followup_states TO authenticated;
GRANT ALL ON public.inventory_restock_followup_states TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_inventory_restock_followup_state(
  p_restock_action_id uuid,
  p_status            text DEFAULT 'open',
  p_note              text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_admin  boolean := false;
  v_status text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_admin;
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_restock_action_id IS NULL THEN
    RAISE EXCEPTION 'restock_action_id is required' USING ERRCODE = 'P0001';
  END IF;

  v_status := COALESCE(NULLIF(btrim(p_status), ''), 'open');
  IF v_status NOT IN ('open', 'reviewed', 'sync_not_needed', 'sync_completed', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid follow-up status' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_bundle_component_restock_actions ra WHERE ra.id = p_restock_action_id
  ) THEN
    RAISE EXCEPTION 'Restock action not found' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.inventory_restock_followup_states (
    restock_action_id, status, note, updated_by, updated_at
  ) VALUES (
    p_restock_action_id, v_status, NULLIF(btrim(p_note), ''), v_actor, now()
  )
  ON CONFLICT (restock_action_id) DO UPDATE SET
    status = EXCLUDED.status,
    note = COALESCE(EXCLUDED.note, inventory_restock_followup_states.note),
    updated_by = v_actor,
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'restock_action_id', p_restock_action_id,
    'status', v_status,
    'message', 'Follow-up state updated — no stock or channel sync performed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_inventory_restock_followup_state TO authenticated;

CREATE OR REPLACE VIEW public.v_inventory_restock_followup_candidates AS
WITH restock_base AS (
  SELECT
    ra.id AS restock_action_id,
    ra.reservation_id,
    ra.component_variant_id,
    ra.parent_bundle_variant_id,
    ra.source_order_id,
    ra.source_order_item_id,
    ra.restock_qty AS restocked_qty,
    ra.stock_after,
    ra.ledger_id,
    ra.created_at AS restock_created_at,
    mpa.id AS assist_action_id,
    mpa.observation_id,
    mpa.return_workflow_id
  FROM public.inventory_bundle_component_restock_actions ra
  LEFT JOIN LATERAL (
    SELECT a.id, a.observation_id, a.return_workflow_id
    FROM public.marketplace_restock_assist_actions a
    WHERE a.action_type = 'restock_confirmed'
      AND a.reservation_id = ra.reservation_id
      AND (
        (a.raw_context->>'ledger_id')::uuid = ra.ledger_id
        OR a.qty = ra.restock_qty
      )
    ORDER BY a.created_at DESC
    LIMIT 1
  ) mpa ON true
  WHERE ra.status = 'applied'
    AND ra.created_at > now() - interval '30 days'
),
enriched AS (
  SELECT
    rb.*,
    cpv.sku AS component_sku,
    COALESCE(NULLIF(btrim(cpv.title), ''), cpv.option_value, '—') AS component_title,
    bpv.sku AS parent_bundle_sku,
    COALESCE(NULLIF(btrim(bpv.title), ''), bpv.option_value, '—') AS parent_bundle_title,
    CASE
      WHEN rb.source_order_id LIKE 'ebay_%' THEN 'ebay'
      WHEN rb.source_order_id LIKE 'amazon_%' THEN 'amazon'
      ELSE 'kk'
    END AS source_channel,
    comp.amazon_listing_id AS comp_amazon_listing_id,
    comp.amazon_is_afn AS comp_amazon_afn,
    comp.amazon_sync_action AS comp_amazon_sync_action,
    comp.ebay_listing_id AS comp_ebay_listing_id,
    comp.ebay_sync_action AS comp_ebay_sync_action,
    parent.amazon_listing_id AS parent_amazon_listing_id,
    parent.amazon_is_afn AS parent_amazon_afn,
    parent.amazon_sync_action AS parent_amazon_sync_action,
    parent.ebay_listing_id AS parent_ebay_listing_id,
    parent.ebay_sync_action AS parent_ebay_sync_action,
    kk_comp.available AS kk_available_after,
    bs.virtual_bundle_available AS virtual_bundle_available_after,
    bs.current_model AS bundle_model,
    COALESCE(
      public.is_bundle_live_deduction_enabled(rb.parent_bundle_variant_id),
      false
    ) AS parent_bundle_live
  FROM restock_base rb
  JOIN public.product_variants cpv ON cpv.id = rb.component_variant_id
  LEFT JOIN public.product_variants bpv ON bpv.id = rb.parent_bundle_variant_id
  LEFT JOIN public.v_inventory_channel_sync_candidates comp ON comp.variant_id = rb.component_variant_id
  LEFT JOIN public.v_inventory_channel_sync_candidates parent ON parent.variant_id = rb.parent_bundle_variant_id
  LEFT JOIN public.v_kk_variant_available_stock kk_comp ON kk_comp.variant_id = rb.component_variant_id
  LEFT JOIN public.v_inventory_bundle_summary_preview bs ON bs.bundle_variant_id = rb.parent_bundle_variant_id
),
classified AS (
  SELECT
    e.*,
    CASE
      WHEN COALESCE(e.comp_amazon_afn, false) OR COALESCE(e.parent_amazon_afn, false) THEN 'mapped_afn'
      WHEN e.comp_amazon_listing_id IS NOT NULL OR e.parent_amazon_listing_id IS NOT NULL THEN 'mapped_fbm'
      ELSE 'not_mapped'
    END AS amazon_mapping_status,
    CASE
      WHEN e.comp_ebay_listing_id IS NOT NULL OR e.parent_ebay_listing_id IS NOT NULL THEN
        CASE
          WHEN COALESCE(e.comp_ebay_sync_action, e.parent_ebay_sync_action) IN (
            'ended_needs_relist', 'no_active_listing', 'missing_mapping'
          ) THEN 'mapped_inactive'
          ELSE 'mapped_active'
        END
      ELSE 'not_mapped'
    END AS ebay_mapping_status,
    COALESCE(fs.status, 'open') AS workflow_status,
    fs.note AS workflow_note,
    fs.updated_at AS workflow_updated_at
  FROM enriched e
  LEFT JOIN public.inventory_restock_followup_states fs ON fs.restock_action_id = e.restock_action_id
)
SELECT
  restock_action_id,
  reservation_id,
  return_workflow_id,
  observation_id,
  assist_action_id,
  component_variant_id,
  parent_bundle_variant_id,
  component_sku,
  component_title,
  parent_bundle_sku,
  parent_bundle_title,
  restocked_qty,
  stock_after,
  restock_created_at,
  source_channel,
  source_order_id,
  source_order_item_id,
  ledger_id,
  amazon_mapping_status,
  ebay_mapping_status,
  kk_available_after,
  virtual_bundle_available_after,
  workflow_status,
  workflow_note,
  CASE
    WHEN workflow_status = 'sync_completed' THEN 'completed'
    WHEN workflow_status = 'sync_not_needed' THEN 'kk_updated'
    WHEN workflow_status IN ('reviewed', 'dismissed') THEN 'completed'
    WHEN amazon_mapping_status = 'mapped_fbm'
      AND ebay_mapping_status IN ('mapped_active', 'mapped_inactive') THEN 'needs_channel_review'
    WHEN amazon_mapping_status = 'mapped_fbm' THEN 'needs_amazon_review'
    WHEN ebay_mapping_status IN ('mapped_active', 'mapped_inactive') THEN 'needs_ebay_review'
    WHEN parent_bundle_live
      AND bundle_model = 'model_b_virtual_preview'
      AND virtual_bundle_available_after IS NOT NULL THEN 'needs_channel_review'
    WHEN amazon_mapping_status = 'not_mapped'
      AND ebay_mapping_status = 'not_mapped' THEN 'no_channel_mapping'
    ELSE 'kk_updated'
  END AS followup_status,
  CASE
    WHEN workflow_status = 'sync_completed' THEN 'Follow-up marked sync completed.'
    WHEN workflow_status = 'sync_not_needed' THEN 'Admin marked sync not needed.'
    WHEN workflow_status IN ('reviewed', 'dismissed') THEN 'Follow-up reviewed or dismissed.'
    WHEN amazon_mapping_status = 'mapped_afn' THEN 'Amazon AFN/FBA mapped — local qty sync not applicable.'
    WHEN amazon_mapping_status = 'mapped_fbm' AND ebay_mapping_status IN ('mapped_active', 'mapped_inactive')
      THEN 'Component or bundle has Amazon FBM and eBay mappings — review channel quantities.'
    WHEN amazon_mapping_status = 'mapped_fbm' THEN 'Amazon FBM mapping exists — review Amazon quantity if sellable qty changed.'
    WHEN ebay_mapping_status IN ('mapped_active', 'mapped_inactive')
      THEN 'eBay listing mapped — review quantity or relist if listing was ended.'
    WHEN parent_bundle_live AND virtual_bundle_available_after IS NOT NULL
      THEN format('Live virtual bundle availability is now %s — review bundle sellability.', virtual_bundle_available_after)
    WHEN amazon_mapping_status = 'not_mapped' AND ebay_mapping_status = 'not_mapped'
      THEN 'No mapped marketplace quantity to sync — KK component stock updated only.'
    ELSE format('KK component available qty is now %s.', COALESCE(kk_available_after, stock_after))
  END AS followup_reason
FROM classified;

COMMENT ON VIEW public.v_inventory_restock_followup_candidates IS
  'Phase 10T: post-restock channel follow-up candidates (informational; no auto-sync).';

GRANT SELECT ON public.v_inventory_restock_followup_candidates TO authenticated, service_role;

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
     WHERE i.issue_type = 'bundle_component_finalize_failed' AND i.resolved_at IS NULL) AS bundle_component_finalize_failed,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_candidates c
     WHERE c.suggested_action = 'eligible_restock') AS bundle_component_return_pending,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_candidates c
     WHERE c.suggested_action IN ('manual_review', 'refunded_no_return')
       AND c.quantity_available_to_restock > 0) AS bundle_component_restock_manual_review,
    (SELECT COUNT(*)::bigint FROM public.inventory_bundle_live_issues i
     WHERE i.issue_type = 'bundle_component_over_restock_attempt' AND i.resolved_at IS NULL) AS bundle_component_over_restock_attempt,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.workflow_id IS NOT NULL
       AND wg.workflow_status IN ('open', 'return_expected')) AS bundle_return_expected,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.workflow_id IS NOT NULL
       AND wg.workflow_status IN ('received', 'partially_received', 'inspected')
       AND wg.workflow_condition = 'resellable'
       AND wg.max_restockable_qty > 0
       AND COALESCE(wg.workflow_quantity_received, 0) > COALESCE(wg.workflow_quantity_restocked, 0)) AS bundle_return_received_not_restocked,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.workflow_id IS NOT NULL
       AND (wg.workflow_condition IN ('damaged', 'missing')
         OR wg.workflow_next_action = 'manual_review')) AS bundle_return_manual_review,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.refund_guidance_status_resolved = 'refund_without_return_workflow'
       AND wg.max_restockable_qty > 0) AS refund_without_return_workflow,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.refund_guidance_status_resolved = 'partial_refund_detected'
       AND wg.max_restockable_qty > 0
       AND COALESCE(wg.refund_confidence, 'low') IN ('low', 'medium')) AS partial_refund_return_review,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.refund_guidance_status_resolved = 'refund_restock_review_needed') AS refund_restock_review_needed,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.refund_guidance_status_resolved = 'marketplace_refund_review'
       AND wg.max_restockable_qty > 0) AS marketplace_refund_review,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.refund_guidance_status_resolved = 'cancellation_detected'
       AND wg.max_restockable_qty > 0) AS marketplace_cancel_review,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.refund_guidance_status_resolved = 'afn_external_fulfillment_review'
       AND wg.max_restockable_qty > 0) AS afn_return_external_review,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_marketplace_restock_assist_candidates ma
     WHERE ma.assist_status = 'eligible_line_confirmed') AS marketplace_restock_assist_ready,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_bundle_component_return_workflow_guidance wg
     WHERE wg.max_restockable_qty > 0
       AND (
         wg.refund_guidance_status_resolved IN (
           'marketplace_refund_review', 'cancellation_detected', 'return_detected',
           'marketplace_restock_assist_ready'
         )
         OR wg.marketplace_observation_confidence IS NOT NULL
         OR COALESCE(wg.persisted_observation_count, 0) > 0
       )
       AND COALESCE(wg.latest_persisted_obs_at, wg.latest_marketplace_obs_at) < now() - interval '48 hours'
    ) AS marketplace_observation_stale,
    (SELECT COUNT(*)::bigint FROM public.v_inventory_restock_followup_candidates fc
     LEFT JOIN public.inventory_restock_followup_states fs ON fs.restock_action_id = fc.restock_action_id
     WHERE fc.followup_status IN ('needs_channel_review', 'needs_amazon_review', 'needs_ebay_review')
       AND COALESCE(fs.status, 'open') = 'open'
       AND fc.restock_created_at > now() - interval '14 days'
    ) AS restock_channel_followup_needed
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
  UNION ALL SELECT 'bundle_component_return_pending', 'bundle_component_return_pending',
    'Bundle Component Return Pending', 'medium',
    'Finalized live bundle component lines eligible for admin-confirmed restock.',
    lbic.bundle_component_return_pending, 'v_inventory_bundle_component_return_candidates', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_component_return_pending > 0
  UNION ALL SELECT 'bundle_component_restock_manual_review', 'bundle_component_restock_manual_review',
    'Bundle Component Restock Review', 'medium',
    'Refunded or flagged bundle component lines need manual restock confirmation.',
    lbic.bundle_component_restock_manual_review, 'v_inventory_bundle_component_return_candidates', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_component_restock_manual_review > 0
  UNION ALL SELECT 'bundle_component_over_restock_attempt', 'bundle_component_over_restock_attempt',
    'Bundle Component Over-Restock Blocked', 'high',
    'Restock RPC rejected qty exceeding finalized component amount.',
    lbic.bundle_component_over_restock_attempt, 'inventory_bundle_live_issues', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_component_over_restock_attempt > 0
  UNION ALL SELECT 'bundle_return_expected', 'bundle_return_expected',
    'Bundle Return Expected', 'medium',
    'RMA/return workflow open — physical return expected but not yet received.',
    lbic.bundle_return_expected, 'inventory_return_workflow', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_return_expected > 0
  UNION ALL SELECT 'bundle_return_received_not_restocked', 'bundle_return_received_not_restocked',
    'Bundle Return Received — Restock Pending', 'medium',
    'Resellable return received per workflow — confirmed restock still required for stock change.',
    lbic.bundle_return_received_not_restocked, 'inventory_return_workflow', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_return_received_not_restocked > 0
  UNION ALL SELECT 'bundle_return_manual_review', 'bundle_return_manual_review',
    'Bundle Return Manual Review', 'medium',
    'Return workflow flagged damaged/missing or needs manual review before restock.',
    lbic.bundle_return_manual_review, 'inventory_return_workflow', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.bundle_return_manual_review > 0
  UNION ALL SELECT 'refund_without_return_workflow', 'refund_without_return_workflow',
    'Refund Without Return Workflow', 'medium',
    'Full refund detected after finalize — no return workflow yet; create one to track physical return.',
    lbic.refund_without_return_workflow, 'order_refund_details', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.refund_without_return_workflow > 0
  UNION ALL SELECT 'partial_refund_return_review', 'partial_refund_return_review',
    'Partial Refund Return Review', 'medium',
    'Partial refund on finalized component line — dollar amount may not match returned quantity.',
    lbic.partial_refund_return_review, 'order_refund_details', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.partial_refund_return_review > 0
  UNION ALL SELECT 'refund_restock_review_needed', 'refund_restock_review_needed',
    'Refund Restock Review Needed', 'medium',
    'Refund context suggests restock review — confirm physical return and resellable condition before restock.',
    lbic.refund_restock_review_needed, 'order_refund_details', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.refund_restock_review_needed > 0
  UNION ALL SELECT 'marketplace_refund_review', 'marketplace_refund_review',
    'Marketplace Refund Review', 'medium',
    'eBay or Amazon refund signal detected — confirm physical return before restocking local inventory.',
    lbic.marketplace_refund_review, 'v_inventory_marketplace_refund_observations', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.marketplace_refund_review > 0
  UNION ALL SELECT 'marketplace_cancel_review', 'marketplace_cancel_review',
    'Marketplace Cancel Review', 'medium',
    'Marketplace cancellation detected — verify whether inventory was shipped or needs restock review.',
    lbic.marketplace_cancel_review, 'v_inventory_marketplace_refund_observations', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.marketplace_cancel_review > 0
  UNION ALL SELECT 'afn_return_external_review', 'afn_return_external_review',
    'AFN Return External Review', 'medium',
    'Amazon AFN/FBA refund or return signal — local inventory restock requires manual review.',
    lbic.afn_return_external_review, 'v_inventory_marketplace_refund_observations', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.afn_return_external_review > 0
  UNION ALL SELECT 'marketplace_restock_assist_ready', 'marketplace_restock_assist_ready',
    'Marketplace Restock Assist Ready', 'medium',
    'Line-confirmed marketplace observation with physical return confirmed — admin restock assist available.',
    lbic.marketplace_restock_assist_ready, 'v_inventory_marketplace_restock_assist_candidates', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.marketplace_restock_assist_ready > 0
  UNION ALL SELECT 'marketplace_observation_stale', 'marketplace_observation_stale',
    'Marketplace Observation Stale', 'medium',
    'Marketplace refund/cancel observations older than 48h — refresh observations before restock decisions.',
    lbic.marketplace_observation_stale, 'marketplace_refund_observations', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.marketplace_observation_stale > 0
  UNION ALL SELECT 'restock_channel_followup_needed', 'restock_channel_followup_needed',
    'Restock Channel Follow-Up Needed', 'low',
    'Recent component restock may require marketplace quantity or bundle availability review — informational only.',
    lbic.restock_channel_followup_needed, 'v_inventory_restock_followup_candidates', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.restock_channel_followup_needed > 0
) AS issues(issue_id, issue_type, issue_label, severity, description, affected_count, source, reference);

COMMENT ON VIEW public.v_inventory_issues IS
  'Grouped inventory issues including restock channel follow-up (Phase 10T).';

GRANT SELECT ON public.v_inventory_issues TO authenticated, service_role;
