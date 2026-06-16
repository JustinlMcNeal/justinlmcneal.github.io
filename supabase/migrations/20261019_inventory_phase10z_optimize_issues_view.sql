-- ============================================================================
-- ⛔ DO NOT APPLY — SUPERSEDED BY 10AA — CAN EXHAUST DB POOL ⛔
-- ============================================================================
-- File: 20261019_inventory_phase10z_optimize_issues_view.sql
-- STATUS: RETAINED FOR MIGRATION HISTORY ONLY — NEVER RUN ON PRODUCTION
--
-- This migration replaces v_inventory_issues with a LIVE HEAVY VIEW that scans
-- bundle/return/audit/dashboard views on EVERY admin page load. On Supabase
-- micro instances it exhausts the Postgres connection pool and marks the
-- project Unhealthy (REST timeouts, ABORTED health checks).
--
-- REQUIRED PRODUCTION PATH (apply in order):
--   1. supabase/migrations/20261020_inventory_phase10aa_issues_snapshot.sql
--   2. supabase/migrations/20261021_inventory_phase10ab_missing_sku_product_code.sql
--
-- Verify after deploy: node scripts/verify-inventory-issue-view-safety.mjs
-- Runbook: docs/pages/admin/inventory/implementation/057_supabase_pool_exhaustion_runbook.md
-- ============================================================================
-- Phase 10Z — consolidate repeated scans in v_inventory_issues (fixes PostgREST 500/timeouts).
-- NOTE: This approach was abandoned — live heavy scans caused worse pool exhaustion.

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
live_issues_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE i.issue_type = 'bundle_component_reservation_failed')::bigint AS bundle_component_reservation_failed,
    COUNT(*) FILTER (WHERE i.issue_type = 'bundle_component_finalize_failed')::bigint AS bundle_component_finalize_failed,
    COUNT(*) FILTER (WHERE i.issue_type = 'bundle_component_over_restock_attempt')::bigint AS bundle_component_over_restock_attempt
  FROM public.inventory_bundle_live_issues i
  WHERE i.resolved_at IS NULL
),
return_candidates_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE c.suggested_action = 'eligible_restock')::bigint AS bundle_component_return_pending,
    COUNT(*) FILTER (WHERE c.suggested_action IN ('manual_review', 'refunded_no_return')
      AND c.quantity_available_to_restock > 0)::bigint AS bundle_component_restock_manual_review
  FROM public.v_inventory_bundle_component_return_candidates c
),
return_guidance_agg AS (
  SELECT
    COUNT(*) FILTER (WHERE wg.workflow_id IS NOT NULL
      AND wg.workflow_status IN ('open', 'return_expected'))::bigint AS bundle_return_expected,
    COUNT(*) FILTER (WHERE wg.workflow_id IS NOT NULL
      AND wg.workflow_status IN ('received', 'partially_received', 'inspected')
      AND wg.workflow_condition = 'resellable'
      AND wg.max_restockable_qty > 0
      AND COALESCE(wg.workflow_quantity_received, 0) > COALESCE(wg.workflow_quantity_restocked, 0))::bigint AS bundle_return_received_not_restocked,
    COUNT(*) FILTER (WHERE wg.workflow_id IS NOT NULL
      AND (wg.workflow_condition IN ('damaged', 'missing')
        OR wg.workflow_next_action = 'manual_review'))::bigint AS bundle_return_manual_review,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'refund_without_return_workflow'
      AND wg.max_restockable_qty > 0)::bigint AS refund_without_return_workflow,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'partial_refund_detected'
      AND wg.max_restockable_qty > 0
      AND COALESCE(wg.refund_confidence, 'low') IN ('low', 'medium'))::bigint AS partial_refund_return_review,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'refund_restock_review_needed')::bigint AS refund_restock_review_needed,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'marketplace_refund_review'
      AND wg.max_restockable_qty > 0)::bigint AS marketplace_refund_review,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'cancellation_detected'
      AND wg.max_restockable_qty > 0)::bigint AS marketplace_cancel_review,
    COUNT(*) FILTER (WHERE wg.refund_guidance_status_resolved = 'afn_external_fulfillment_review'
      AND wg.max_restockable_qty > 0)::bigint AS afn_return_external_review,
    COUNT(*) FILTER (WHERE wg.max_restockable_qty > 0
      AND (
        wg.refund_guidance_status_resolved IN (
          'marketplace_refund_review', 'cancellation_detected', 'return_detected',
          'marketplace_restock_assist_ready'
        )
        OR wg.marketplace_observation_confidence IS NOT NULL
        OR COALESCE(wg.persisted_observation_count, 0) > 0
      )
      AND COALESCE(wg.latest_persisted_obs_at, wg.latest_marketplace_obs_at) < now() - interval '48 hours'
    )::bigint AS marketplace_observation_stale
  FROM public.v_inventory_bundle_component_return_workflow_guidance wg
),
live_bundle_issue_counts AS (
  SELECT
    blr.bundle_live_readiness_blocked,
    bls.bundle_component_shortage_live,
    lia.bundle_component_reservation_failed,
    lia.bundle_component_finalize_failed,
    rca.bundle_component_return_pending,
    rca.bundle_component_restock_manual_review,
    lia.bundle_component_over_restock_attempt,
    rga.bundle_return_expected,
    rga.bundle_return_received_not_restocked,
    rga.bundle_return_manual_review,
    rga.refund_without_return_workflow,
    rga.partial_refund_return_review,
    rga.refund_restock_review_needed,
    rga.marketplace_refund_review,
    rga.marketplace_cancel_review,
    rga.afn_return_external_review,
    mra.marketplace_restock_assist_ready,
    rga.marketplace_observation_stale,
    rf.restock_channel_followup_needed,
    COALESCE(rds.dashboard_attention_count, 0)::bigint AS returns_restock_dashboard_attention
  FROM return_guidance_agg rga
  CROSS JOIN live_issues_agg lia
  CROSS JOIN return_candidates_agg rca
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::bigint AS bundle_live_readiness_blocked
    FROM public.inventory_bundle_variant_settings vs
    JOIN public.v_inventory_bundle_cutover_readiness r ON r.bundle_variant_id = vs.bundle_variant_id
    WHERE vs.mode = 'live_requested' AND NOT COALESCE(r.is_ready_for_live, false)
  ) blr
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::bigint AS bundle_component_shortage_live
    FROM public.v_inventory_bundle_summary_preview s
    WHERE public.is_bundle_live_deduction_enabled(s.bundle_variant_id)
      AND COALESCE(s.virtual_bundle_available, 0) <= 0
  ) bls
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::bigint AS marketplace_restock_assist_ready
    FROM public.v_inventory_marketplace_restock_assist_candidates ma
    WHERE ma.assist_status = 'eligible_line_confirmed'
  ) mra
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::bigint AS restock_channel_followup_needed
    FROM public.v_inventory_restock_followup_candidates fc
    LEFT JOIN public.inventory_restock_followup_states fs ON fs.restock_action_id = fc.restock_action_id
    WHERE fc.followup_status IN ('needs_channel_review', 'needs_amazon_review', 'needs_ebay_review')
      AND COALESCE(fs.status, 'open') = 'open'
      AND fc.restock_created_at > now() - interval '14 days'
  ) rf
  CROSS JOIN LATERAL (
    SELECT dashboard_attention_count
    FROM public.v_inventory_returns_restock_dashboard_summary
  ) rds
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
  UNION ALL SELECT 'returns_restock_dashboard_attention', 'returns_restock_dashboard_attention',
    'Returns & Restock Dashboard Attention', 'low',
    'Unified returns/restock workbench has attention items — review returns, restock assist, and channel follow-ups.',
    lbic.returns_restock_dashboard_attention, 'v_inventory_returns_restock_dashboard_worklist', 'live'
  FROM live_bundle_issue_counts lbic WHERE lbic.returns_restock_dashboard_attention > 0
) AS issues(issue_id, issue_type, issue_label, severity, description, affected_count, source, reference);

COMMENT ON VIEW public.v_inventory_issues IS
  'Grouped inventory issues including returns/restock dashboard attention (Phase 10U; 10Z scan consolidation).';

GRANT SELECT ON public.v_inventory_issues TO authenticated, service_role;


CREATE OR REPLACE VIEW public.v_inventory_issues_with_state AS
SELECT
  i.issue_id,
  i.issue_type,
  i.issue_label,
  i.severity,
  i.description,
  i.affected_count,
  i.source,
  i.reference,
  i.updated_at,
  COALESCE(s.status, 'open'::text) AS workflow_status,
  s.snoozed_until,
  s.resolution_note,
  s.id AS issue_state_id,
  s.updated_at AS state_updated_at,
  (
    COALESCE(s.status, 'open') NOT IN ('resolved', 'ignored')
    AND NOT (
      COALESCE(s.status, 'open') = 'snoozed'
      AND s.snoozed_until IS NOT NULL
      AND s.snoozed_until > now()
    )
  ) AS is_active_workflow,
  (
    COALESCE(s.status, 'open') = 'snoozed'
    AND s.snoozed_until IS NOT NULL
    AND s.snoozed_until > now()
  ) AS is_snoozed_active
FROM public.v_inventory_issues i
LEFT JOIN public.inventory_issue_states s
  ON s.issue_key = ('group:' || i.issue_type);

GRANT SELECT ON public.v_inventory_issues_with_state TO authenticated, service_role;
