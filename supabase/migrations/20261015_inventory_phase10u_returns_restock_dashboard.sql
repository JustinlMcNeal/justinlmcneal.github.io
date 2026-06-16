-- Phase 10U — Unified returns/restock dashboard (read-only workbench; no stock mutations).

CREATE OR REPLACE VIEW public.v_inventory_returns_restock_dashboard_summary AS
SELECT
  (
    SELECT COUNT(*)::integer FROM public.inventory_return_workflow rw
    WHERE rw.status NOT IN ('closed', 'canceled')
  ) AS open_return_workflows,
  (
    SELECT COUNT(*)::integer FROM public.v_inventory_bundle_component_return_workflow_guidance wg
    WHERE wg.workflow_status IN ('received', 'partially_received', 'inspected')
      AND wg.workflow_condition = 'resellable'
      AND wg.max_restockable_qty > 0
      AND COALESCE(wg.workflow_quantity_received, 0) > COALESCE(wg.workflow_quantity_restocked, 0)
  ) AS received_not_restocked,
  COALESCE(qs.ready_to_restock, 0)::integer AS ready_to_restock,
  COALESCE(qs.stale_observation, 0)::integer AS stale_observations,
  (
    SELECT COUNT(*)::integer FROM public.v_inventory_restock_followup_candidates fc
    WHERE fc.workflow_status = 'open'
      AND fc.followup_status IN ('needs_channel_review', 'needs_amazon_review', 'needs_ebay_review')
  ) AS open_channel_followups,
  (
    SELECT COUNT(*)::integer FROM public.v_inventory_restock_followup_candidates fc
    WHERE fc.workflow_status = 'open'
      AND fc.followup_status IN ('needs_channel_review', 'needs_amazon_review', 'needs_ebay_review')
  ) AS sync_needed_after_restock,
  (
    SELECT COUNT(*)::integer FROM public.v_inventory_marketplace_restock_assist_queue_with_triage q
    WHERE q.queue_bucket IN ('manual_review', 'blocked')
      AND NOT q.is_actively_snoozed AND NOT q.is_dismissed
  ) AS blocked_manual_review,
  (
    SELECT COUNT(*)::integer FROM public.inventory_bundle_component_restock_actions ra
    WHERE ra.status = 'applied' AND ra.created_at > now() - interval '7 days'
  ) AS recent_restocks_count,
  COALESCE((
    SELECT SUM(ra.restock_qty)::integer FROM public.inventory_bundle_component_restock_actions ra
    WHERE ra.status = 'applied' AND ra.created_at > now() - interval '7 days'
  ), 0) AS recent_restocked_qty,
  (
    COALESCE(qs.ready_to_restock, 0)
    + COALESCE(qs.stale_observation, 0)
    + (
      SELECT COUNT(*)::integer FROM public.v_inventory_restock_followup_candidates fc
      WHERE fc.workflow_status = 'open'
        AND fc.followup_status IN ('needs_channel_review', 'needs_amazon_review', 'needs_ebay_review')
    )
    + (
      SELECT COUNT(*)::integer FROM public.v_inventory_bundle_component_return_workflow_guidance wg
      WHERE wg.workflow_status IN ('received', 'partially_received', 'inspected')
        AND wg.max_restockable_qty > 0
        AND wg.workflow_next_action IN ('restock_received', 'inspect_return')
    )
  )::integer AS dashboard_attention_count
FROM public.v_inventory_marketplace_restock_assist_queue_summary qs;

COMMENT ON VIEW public.v_inventory_returns_restock_dashboard_summary IS
  'Phase 10U: aggregate KPIs for returns/restock admin dashboard.';

GRANT SELECT ON public.v_inventory_returns_restock_dashboard_summary TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_inventory_returns_restock_dashboard_worklist AS
SELECT
  ('restock_assist:' || q.reservation_id::text) AS row_id,
  'restock_assist'::text AS row_type,
  q.queue_priority AS priority,
  q.source_channel,
  q.source_order_id,
  q.source_order_item_id,
  q.reservation_id,
  NULL::uuid AS restock_action_id,
  NULL::uuid AS audit_action_id,
  q.return_workflow_id AS workflow_id,
  q.observation_id,
  q.component_variant_id,
  q.parent_bundle_variant_id,
  q.component_sku,
  q.component_title,
  q.parent_bundle_sku,
  q.parent_bundle_title,
  q.queue_bucket AS status,
  q.assist_reason AS reason,
  CASE q.queue_bucket
    WHEN 'ready_to_restock' THEN 'Open Restock Assist Queue — confirm restock'
    WHEN 'needs_physical_confirmation' THEN 'Mark physical return confirmed'
    WHEN 'needs_rma' THEN 'Create return workflow'
    WHEN 'stale_observation' THEN 'Refresh marketplace observations'
    WHEN 'manual_review' THEN 'Manual review in Restock Assist Queue'
    WHEN 'blocked' THEN 'Review blocked row — do not auto-restock'
    ELSE 'Open Restock Assist Queue'
  END AS recommended_action,
  q.is_observation_stale,
  q.observation_age_hours,
  q.suggested_restock_qty,
  q.max_restockable_qty,
  NULL::timestamptz AS event_at
FROM public.v_inventory_marketplace_restock_assist_queue_with_triage q
WHERE NOT q.is_actively_snoozed
  AND NOT q.is_dismissed
  AND q.queue_bucket <> 'already_done'

UNION ALL

SELECT
  ('channel_followup:' || fc.restock_action_id::text),
  'channel_followup',
  CASE fc.followup_status
    WHEN 'needs_channel_review' THEN 150
    WHEN 'needs_amazon_review' THEN 180
    WHEN 'needs_ebay_review' THEN 190
    ELSE 250
  END,
  fc.source_channel,
  fc.source_order_id,
  fc.source_order_item_id,
  fc.reservation_id,
  fc.restock_action_id,
  NULL::uuid,
  fc.return_workflow_id,
  fc.observation_id,
  fc.component_variant_id,
  fc.parent_bundle_variant_id,
  fc.component_sku,
  fc.component_title,
  fc.parent_bundle_sku,
  fc.parent_bundle_title,
  fc.followup_status,
  fc.followup_reason,
  'Open channel follow-up checklist — review sync if needed',
  false,
  NULL::numeric,
  NULL::integer,
  fc.restocked_qty,
  fc.restock_created_at
FROM public.v_inventory_restock_followup_candidates fc
WHERE fc.workflow_status = 'open'
  AND fc.followup_status IN ('needs_channel_review', 'needs_amazon_review', 'needs_ebay_review')

UNION ALL

SELECT
  ('return_workflow:' || wg.reservation_id::text),
  'return_workflow',
  CASE wg.workflow_next_action
    WHEN 'restock_received' THEN 120
    WHEN 'inspect_return' THEN 200
    WHEN 'wait_for_return' THEN 280
    WHEN 'create_rma' THEN 220
    ELSE 350
  END,
  wg.order_channel,
  wg.source_order_id,
  wg.source_order_item_id,
  wg.reservation_id,
  NULL::uuid,
  NULL::uuid,
  wg.workflow_id,
  wg.marketplace_observation_id,
  wg.component_variant_id,
  wg.parent_bundle_variant_id,
  wg.component_sku,
  wg.component_product_label,
  NULL::text,
  wg.parent_bundle_label,
  COALESCE(wg.workflow_status, wg.workflow_next_action),
  COALESCE(wg.workflow_note, wg.marketplace_assist_reason, wg.refund_guidance_status_resolved),
  CASE wg.workflow_next_action
    WHEN 'create_rma' THEN 'Create RMA / return workflow'
    WHEN 'wait_for_return' THEN 'Wait for physical return'
    WHEN 'inspect_return' THEN 'Inspect received return'
    WHEN 'restock_received' THEN 'Open Bundle Return/Restock — confirm restock'
    WHEN 'manual_review' THEN 'Manual return/restock review'
    ELSE 'Open Bundle Return/Restock panel'
  END,
  false,
  NULL::numeric,
  wg.marketplace_suggested_restock_qty,
  wg.max_restockable_qty,
  wg.finalized_at
FROM public.v_inventory_bundle_component_return_workflow_guidance wg
WHERE wg.max_restockable_qty > 0
  AND (
    (wg.workflow_id IS NOT NULL AND wg.workflow_status NOT IN ('closed', 'canceled', 'restocked'))
    OR wg.workflow_next_action IN ('create_rma', 'restock_received', 'inspect_return', 'manual_review')
  )

UNION ALL

SELECT
  ('audit:' || a.action_id::text),
  'audit',
  500,
  a.source_channel,
  a.source_order_id,
  a.source_order_item_id,
  a.reservation_id,
  NULL::uuid,
  a.action_id,
  a.return_workflow_id,
  a.observation_id,
  a.component_variant_id,
  a.parent_bundle_variant_id,
  a.component_sku,
  a.component_title,
  a.parent_bundle_sku,
  a.parent_bundle_title,
  a.action_type,
  COALESCE(a.note, a.previous_status || ' → ' || a.next_status),
  'View audit / channel follow-up if needed',
  false,
  NULL::numeric,
  a.qty,
  NULL::integer,
  a.created_at
FROM public.v_inventory_marketplace_restock_assist_audit a
WHERE a.action_type = 'restock_confirmed'
  AND a.created_at > now() - interval '7 days'

UNION ALL

SELECT
  ('manual_review:' || q.reservation_id::text),
  'manual_review',
  400,
  q.source_channel,
  q.source_order_id,
  q.source_order_item_id,
  q.reservation_id,
  NULL::uuid,
  NULL::uuid,
  q.return_workflow_id,
  q.observation_id,
  q.component_variant_id,
  q.parent_bundle_variant_id,
  q.component_sku,
  q.component_title,
  q.parent_bundle_sku,
  q.parent_bundle_title,
  q.queue_bucket,
  q.assist_reason,
  'Manual review — use Restock Assist Queue or Returns panel',
  q.is_observation_stale,
  q.observation_age_hours,
  q.suggested_restock_qty,
  q.max_restockable_qty,
  q.observation_observed_at
FROM public.v_inventory_marketplace_restock_assist_queue_with_triage q
WHERE q.queue_bucket IN ('manual_review', 'blocked')
  AND NOT q.is_actively_snoozed
  AND NOT q.is_dismissed;

COMMENT ON VIEW public.v_inventory_returns_restock_dashboard_worklist IS
  'Phase 10U: unified returns/restock dashboard worklist (guidance-only).';

GRANT SELECT ON public.v_inventory_returns_restock_dashboard_worklist TO authenticated, service_role;


-- Patch v_inventory_issues with returns_restock_dashboard_attention

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
    ) AS restock_channel_followup_needed,
    (SELECT COALESCE(dashboard_attention_count, 0)::bigint
     FROM public.v_inventory_returns_restock_dashboard_summary) AS returns_restock_dashboard_attention
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
  'Grouped inventory issues including returns/restock dashboard attention (Phase 10U).';

GRANT SELECT ON public.v_inventory_issues TO authenticated, service_role;
