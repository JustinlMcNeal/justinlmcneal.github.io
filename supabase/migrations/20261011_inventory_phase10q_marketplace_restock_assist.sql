-- Phase 10Q — Marketplace restock assist candidates + physical return confirmation + stale obs issues.
-- Admin-confirmed restock only; no auto-restock from observations.

ALTER TABLE public.inventory_return_workflow
  ADD COLUMN IF NOT EXISTS physical_return_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS physical_return_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS physical_return_confirmed_note text;

COMMENT ON COLUMN public.inventory_return_workflow.physical_return_confirmed_at IS
  'Phase 10Q: admin confirmed physical return received — does not mutate stock.';

-- Extend workflow update RPC (no stock mutations).
CREATE OR REPLACE FUNCTION public.update_inventory_return_workflow(
  p_workflow_id                   uuid,
  p_status                        text DEFAULT NULL,
  p_condition                     text DEFAULT NULL,
  p_quantity_received             integer DEFAULT NULL,
  p_quantity_restocked            integer DEFAULT NULL,
  p_rma_number                    text DEFAULT NULL,
  p_tracking_number               text DEFAULT NULL,
  p_note                          text DEFAULT NULL,
  p_override_note                 text DEFAULT NULL,
  p_physical_return_confirmed     boolean DEFAULT NULL,
  p_physical_return_confirmed_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_admin   boolean := false;
  v_row     public.inventory_return_workflow%ROWTYPE;
  v_recv    integer;
  v_rest    integer;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_admin;
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_workflow_id IS NULL THEN
    RAISE EXCEPTION 'workflow_id is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.inventory_return_workflow WHERE id = p_workflow_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return workflow not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status IN ('closed', 'canceled') THEN
    RAISE EXCEPTION 'Cannot update a closed or canceled workflow' USING ERRCODE = 'P0001';
  END IF;

  v_recv := COALESCE(p_quantity_received, v_row.quantity_received);
  v_rest := COALESCE(p_quantity_restocked, v_row.quantity_restocked);

  IF v_recv > v_row.quantity_expected THEN
    RAISE EXCEPTION 'quantity_received cannot exceed quantity_expected' USING ERRCODE = 'P0001';
  END IF;

  IF v_rest > v_recv THEN
    IF p_override_note IS NULL OR btrim(p_override_note) = '' THEN
      RAISE EXCEPTION 'quantity_restocked exceeds quantity_received — provide override note' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_status IS NOT NULL AND btrim(p_status) <> '' THEN
    IF p_status NOT IN ('open', 'return_expected', 'received', 'partially_received', 'inspected', 'restocked', 'closed', 'canceled') THEN
      RAISE EXCEPTION 'Invalid workflow status' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_condition IS NOT NULL AND btrim(p_condition) <> '' THEN
    IF p_condition NOT IN ('unknown', 'resellable', 'damaged', 'missing', 'partial') THEN
      RAISE EXCEPTION 'Invalid workflow condition' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.inventory_return_workflow SET
    status = COALESCE(NULLIF(btrim(p_status), ''), status),
    condition = COALESCE(NULLIF(btrim(p_condition), ''), condition),
    quantity_received = v_recv,
    quantity_restocked = v_rest,
    rma_number = COALESCE(NULLIF(btrim(p_rma_number), ''), rma_number),
    tracking_number = COALESCE(NULLIF(btrim(p_tracking_number), ''), tracking_number),
    note = CASE
      WHEN p_note IS NOT NULL AND btrim(p_note) <> '' THEN
        CASE WHEN note IS NULL OR note = '' THEN btrim(p_note)
        ELSE note || E'\n' || btrim(p_note) END
      ELSE note
    END,
    physical_return_confirmed_at = CASE
      WHEN COALESCE(p_physical_return_confirmed, false) THEN COALESCE(physical_return_confirmed_at, now())
      ELSE physical_return_confirmed_at
    END,
    physical_return_confirmed_by = CASE
      WHEN COALESCE(p_physical_return_confirmed, false) THEN COALESCE(physical_return_confirmed_by, v_actor)
      ELSE physical_return_confirmed_by
    END,
    physical_return_confirmed_note = CASE
      WHEN COALESCE(p_physical_return_confirmed, false) AND p_physical_return_confirmed_note IS NOT NULL
        AND btrim(p_physical_return_confirmed_note) <> '' THEN btrim(p_physical_return_confirmed_note)
      WHEN COALESCE(p_physical_return_confirmed, false) THEN physical_return_confirmed_note
      ELSE physical_return_confirmed_note
    END,
    updated_by = v_actor,
    updated_at = now(),
    closed_at = CASE
      WHEN COALESCE(NULLIF(btrim(p_status), ''), status) IN ('closed', 'canceled') THEN now()
      ELSE closed_at
    END
  WHERE id = p_workflow_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'workflow_id', v_row.id,
    'status', v_row.status,
    'condition', v_row.condition,
    'quantity_received', v_row.quantity_received,
    'quantity_restocked', v_row.quantity_restocked,
    'physical_return_confirmed_at', v_row.physical_return_confirmed_at,
    'message', 'Return workflow updated — no stock changed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_inventory_return_workflow TO authenticated;

-- Marketplace restock assist candidates (guidance-only; restock via existing RPC).
CREATE OR REPLACE VIEW public.v_inventory_marketplace_restock_assist_candidates AS
WITH latest_workflow AS (
  SELECT DISTINCT ON (rw.reservation_id)
    rw.*
  FROM public.inventory_return_workflow rw
  WHERE rw.reservation_id IS NOT NULL
    AND rw.status NOT IN ('canceled')
  ORDER BY rw.reservation_id, rw.updated_at DESC
),
best_obs AS (
  SELECT DISTINCT ON (p.source_order_id, p.source_order_item_id)
    p.id AS observation_id,
    p.source_channel AS observation_source_channel,
    p.source_order_id,
    p.source_order_item_id,
    p.observation_kind,
    p.line_allocation_confidence AS observation_confidence,
    p.refund_amount_cents,
    p.refund_status AS observation_status,
    p.cancellation_status,
    p.return_status,
    p.quantity_returned,
    p.quantity_refunded,
    p.is_afn,
    p.observed_at,
    p.sync_source AS observation_sync_source,
    p.raw_payload
  FROM public.marketplace_refund_observations p
  WHERE p.source_order_item_id IS NOT NULL
  ORDER BY
    p.source_order_id,
    p.source_order_item_id,
    CASE p.line_allocation_confidence
      WHEN 'line_confirmed' THEN 1
      WHEN 'sku_inferred' THEN 2
      WHEN 'order_level' THEN 3
      ELSE 4
    END,
    p.observed_at DESC NULLS LAST,
    p.updated_at DESC
),
base AS (
  SELECT
    c.reservation_id,
    CASE
      WHEN c.source_order_id LIKE 'ebay%' THEN 'ebay'
      WHEN c.source_order_id LIKE 'amazon_%' THEN 'amazon'
      WHEN c.source_order_id LIKE 'cs_%' THEN 'stripe'
      ELSE 'kk'
    END AS source_channel,
    c.source_order_id,
    COALESCE(c.parent_order_item_id, c.source_order_item_id) AS source_order_item_id,
    c.parent_bundle_variant_id,
    c.component_variant_id,
    c.component_sku,
    c.component_product_label AS component_title,
    c.parent_bundle_label AS parent_bundle_title,
    c.quantity_finalized AS finalized_qty,
    c.quantity_already_restocked AS already_restocked_qty,
    c.quantity_available_to_restock AS max_restockable_qty,
    c.suggested_action,
    o.observation_id,
    o.observation_source_channel,
    o.observation_kind,
    o.observation_status,
    o.observation_confidence,
    o.refund_amount_cents,
    o.cancellation_status,
    o.return_status,
    o.quantity_returned,
    o.quantity_refunded,
    o.is_afn AS observation_is_afn,
    o.observed_at AS observation_observed_at,
    o.observation_sync_source,
    w.id AS workflow_id,
    w.status AS workflow_status,
    w.condition AS workflow_condition,
    w.physical_return_confirmed_at,
    w.physical_return_confirmed_by,
    w.physical_return_confirmed_note,
    CASE
      WHEN c.source_order_id LIKE 'amazon_%'
        AND (
          fs.service ILIKE '%Fulfilled by Amazon%'
          OR fs.carrier = 'Amazon'
          OR COALESCE(o.is_afn, false)
        )
      THEN true
      ELSE COALESCE(o.is_afn, false)
    END AS is_amazon_afn,
    CASE
      WHEN o.observation_confidence = 'line_confirmed'
        AND c.quantity_available_to_restock > 0
        AND c.suggested_action <> 'not_finalized' THEN
        LEAST(
          c.quantity_available_to_restock,
          GREATEST(
            COALESCE(o.quantity_returned, o.quantity_refunded, c.quantity_finalized, 1)::integer,
            1
          )
        )::integer
      ELSE NULL
    END AS suggested_restock_qty_raw
  FROM public.v_inventory_bundle_component_return_candidates c
  LEFT JOIN public.fulfillment_shipments fs
    ON fs.stripe_checkout_session_id = c.source_order_id
  LEFT JOIN best_obs o
    ON o.source_order_id = c.source_order_id
    AND o.source_order_item_id = COALESCE(c.parent_order_item_id, c.source_order_item_id)
  LEFT JOIN latest_workflow w ON w.reservation_id = c.reservation_id
  WHERE c.source_order_id LIKE 'ebay%'
    OR c.source_order_id LIKE 'amazon_%'
    OR o.observation_id IS NOT NULL
)
SELECT
  reservation_id,
  source_channel,
  source_order_id,
  source_order_item_id,
  parent_bundle_variant_id,
  component_variant_id,
  component_sku,
  component_title,
  parent_bundle_title,
  finalized_qty,
  already_restocked_qty,
  max_restockable_qty,
  observation_id,
  observation_source_channel,
  observation_status,
  observation_confidence,
  observation_kind,
  refund_amount_cents,
  cancellation_status,
  return_status,
  quantity_returned,
  quantity_refunded,
  CASE
    WHEN suggested_restock_qty_raw IS NULL THEN NULL
    ELSE LEAST(GREATEST(suggested_restock_qty_raw, 0), max_restockable_qty)::integer
  END AS suggested_restock_qty,
  workflow_id,
  workflow_status,
  workflow_condition,
  physical_return_confirmed_at,
  physical_return_confirmed_by,
  physical_return_confirmed_note,
  observation_observed_at,
  observation_sync_source,
  CASE
    WHEN suggested_action = 'not_finalized' THEN 'not_finalized'
    WHEN max_restockable_qty <= 0 THEN 'already_restocked'
    WHEN is_amazon_afn THEN 'afn_external_review'
    WHEN observation_confidence = 'sku_inferred' THEN 'sku_inferred_manual_review'
    WHEN observation_confidence IN ('order_level', 'manual_review') OR observation_id IS NULL THEN 'order_level_manual_review'
    WHEN observation_confidence = 'line_confirmed' AND workflow_id IS NULL THEN 'needs_rma_workflow'
    WHEN observation_confidence = 'line_confirmed'
      AND physical_return_confirmed_at IS NULL
      AND NOT (
        workflow_status = 'inspected' AND workflow_condition = 'resellable'
      ) THEN 'needs_physical_return_confirmation'
    WHEN observation_confidence = 'line_confirmed' THEN 'eligible_line_confirmed'
    ELSE 'order_level_manual_review'
  END AS assist_status,
  CASE
    WHEN suggested_action = 'not_finalized' THEN
      'Component reservation is not finalized — restock assist unavailable.'
    WHEN max_restockable_qty <= 0 THEN
      'All finalized component quantity has already been restocked.'
    WHEN is_amazon_afn THEN
      'Amazon AFN/FBA fulfillment — local restock requires external/manual review.'
    WHEN observation_confidence = 'sku_inferred' THEN
      'Marketplace line mapping is SKU-inferred — confirm line mapping before using suggested qty.'
    WHEN observation_confidence IN ('order_level', 'manual_review') OR observation_id IS NULL THEN
      'Marketplace observation is order-level or missing — manual review required; suggested qty not prefilled.'
    WHEN observation_confidence = 'line_confirmed' AND workflow_id IS NULL THEN
      'Line-confirmed marketplace observation — create return workflow to track physical return.'
    WHEN observation_confidence = 'line_confirmed'
      AND physical_return_confirmed_at IS NULL
      AND NOT (workflow_status = 'inspected' AND workflow_condition = 'resellable') THEN
      'Line-confirmed observation — confirm physical return received and resellable before restock.'
    WHEN observation_confidence = 'line_confirmed' THEN
      'Line-confirmed marketplace observation — suggested qty is advisory; admin must confirm restock.'
    ELSE
      'Manual review required for marketplace restock assist.'
  END AS assist_reason
FROM base;

COMMENT ON VIEW public.v_inventory_marketplace_restock_assist_candidates IS
  'Phase 10Q: admin-confirmed marketplace restock assist (line_confirmed only prefills suggested qty).';

GRANT SELECT ON public.v_inventory_marketplace_restock_assist_candidates TO authenticated, service_role;

-- Expose physical return fields on workflow guidance view.
CREATE OR REPLACE VIEW public.v_inventory_bundle_component_return_workflow_guidance AS
WITH latest_workflow AS (
  SELECT DISTINCT ON (rw.reservation_id)
    rw.*
  FROM public.inventory_return_workflow rw
  WHERE rw.reservation_id IS NOT NULL
    AND rw.status NOT IN ('canceled')
  ORDER BY rw.reservation_id, rw.updated_at DESC
)
SELECT
  g.*,
  w.condition AS workflow_condition,
  w.quantity_expected AS workflow_quantity_expected,
  w.quantity_received AS workflow_quantity_received,
  w.quantity_restocked AS workflow_quantity_restocked,
  w.rma_number AS workflow_rma_number,
  w.tracking_number AS workflow_tracking_number,
  w.note AS workflow_note,
  w.closed_at AS workflow_closed_at,
  w.physical_return_confirmed_at AS workflow_physical_return_confirmed_at,
  w.physical_return_confirmed_by AS workflow_physical_return_confirmed_by,
  w.physical_return_confirmed_note AS workflow_physical_return_confirmed_note,
  ma.assist_status AS marketplace_assist_status,
  ma.assist_reason AS marketplace_assist_reason,
  ma.suggested_restock_qty AS marketplace_suggested_restock_qty,
  ma.observation_confidence AS marketplace_observation_confidence,
  ma.observation_id AS marketplace_observation_id,
  CASE
    WHEN g.refund_guidance_status = 'afn_external_fulfillment_review' THEN 'manual_review'
    WHEN g.refund_guidance_status IN ('marketplace_refund_review', 'cancellation_detected', 'return_detected')
      AND g.refund_confidence IN ('low', 'manual_review') THEN 'manual_review'
    WHEN g.refund_guidance_status = 'no_refund' AND g.max_restockable_qty > 0 AND w.id IS NULL THEN 'create_rma'
    WHEN g.refund_guidance_status = 'full_refund_detected' AND w.id IS NULL THEN 'create_rma'
    WHEN g.refund_guidance_status IN ('partial_refund_detected', 'refund_restock_review_needed', 'marketplace_refund_review')
      AND g.refund_confidence IN ('low', 'manual_review') THEN 'manual_review'
    WHEN w.status IN ('open', 'return_expected') THEN 'wait_for_return'
    WHEN w.status IN ('received', 'partially_received') THEN 'inspect_return'
    WHEN w.status = 'inspected' AND w.condition = 'resellable' AND g.max_restockable_qty > 0 THEN 'restock_received'
    WHEN w.status IN ('restocked', 'closed') OR g.max_restockable_qty <= 0 THEN 'close_return'
    WHEN w.condition IN ('damaged', 'missing') THEN 'manual_review'
    WHEN ma.assist_status = 'eligible_line_confirmed' THEN 'restock_received'
    WHEN g.suggested_panel_action = 'restock_review' THEN 'restock_received'
    ELSE 'manual_review'
  END AS workflow_next_action,
  CASE
    WHEN g.refund_guidance_status = 'no_refund' THEN 'no_refund'
    WHEN g.refund_guidance_status = 'afn_external_fulfillment_review' THEN 'afn_external_fulfillment_review'
    WHEN g.refund_guidance_status = 'cancellation_detected' THEN 'cancellation_detected'
    WHEN g.refund_guidance_status = 'return_detected' THEN 'return_detected'
    WHEN g.refund_guidance_status = 'marketplace_refund_review' THEN 'marketplace_refund_review'
    WHEN g.refund_guidance_status = 'full_refund_detected' AND w.id IS NULL THEN 'refund_without_return_workflow'
    WHEN g.refund_guidance_status = 'full_refund_detected' AND w.id IS NOT NULL
      AND w.status NOT IN ('closed', 'canceled') THEN 'refund_with_return_workflow_open'
    WHEN g.refund_guidance_status = 'partial_refund_detected' THEN 'partial_refund_detected'
    WHEN g.refund_guidance_status = 'line_refund_confirmed' THEN 'line_refund_confirmed'
    WHEN g.max_restockable_qty > 0
      AND g.refund_guidance_status IN ('full_refund_detected', 'line_refund_confirmed', 'partial_refund_detected')
      AND g.suggested_panel_action = 'restock_review' THEN 'refund_restock_review_needed'
    WHEN ma.assist_status = 'eligible_line_confirmed' THEN 'marketplace_restock_assist_ready'
    ELSE g.refund_guidance_status
  END AS refund_guidance_status_resolved
FROM public.v_inventory_bundle_component_return_guidance g
LEFT JOIN latest_workflow w ON w.reservation_id = g.reservation_id
LEFT JOIN public.v_inventory_marketplace_restock_assist_candidates ma
  ON ma.reservation_id = g.reservation_id;

COMMENT ON VIEW public.v_inventory_bundle_component_return_workflow_guidance IS
  'Phase 10Q: return guidance + RMA workflow + marketplace restock assist overlay.';

GRANT SELECT ON public.v_inventory_bundle_component_return_workflow_guidance TO authenticated, service_role;

-- Extend issues with stale marketplace observations + line-confirmed assist ready.
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
    ) AS marketplace_observation_stale
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
) AS issues(issue_id, issue_type, issue_label, severity, description, affected_count, source, reference);

COMMENT ON VIEW public.v_inventory_issues IS
  'Grouped inventory issues including marketplace restock assist + stale observation warnings (Phase 10Q).';

GRANT SELECT ON public.v_inventory_issues TO authenticated, service_role;
