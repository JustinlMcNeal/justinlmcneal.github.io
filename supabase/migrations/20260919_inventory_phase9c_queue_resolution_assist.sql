-- Phase 9C — Post-map queue resolution detection (read-only view).
-- No auto mark-done, stock/reservation/ledger, or channel writes.

CREATE OR REPLACE VIEW public.v_inventory_post_map_queue_with_resolution AS
WITH joined AS (
  SELECT
    q.id,
    q.source_channel,
    q.source_order_id,
    q.source_order_item_id,
    q.mapping_action_id,
    q.mapping_batch_id,
    q.product_id,
    q.variant_id,
    q.product_label,
    q.internal_sku,
    q.quantity,
    q.next_step,
    q.status,
    q.snoozed_until,
    q.reason,
    q.action_target,
    q.created_by,
    q.updated_by,
    q.created_at,
    q.updated_at,
    q.completed_at,
    rr.suggested_action AS retry_suggested_action,
    rr.is_eligible AS retry_is_eligible,
    rr.existing_reservation_id AS retry_reservation_id,
    rr.order_status AS retry_order_status,
    rr.payment_status AS retry_payment_status,
    rr.fulfillment_status AS retry_fulfillment_status,
    a.suggested_audit_status,
    a.needs_audit_issue,
    a.is_finalize_eligible,
    a.matching_ledger_id,
    a.matching_ledger_reason,
    a.reservation_status AS audit_reservation_status,
    a.existing_reservation_id AS audit_reservation_id,
    a.reason AS audit_reason,
    mf.id AS manual_finalize_action_id,
    mf.ledger_id AS manual_finalize_ledger_id,
    mf.status AS manual_finalize_status
  FROM public.inventory_post_map_action_queue q
  LEFT JOIN public.v_inventory_reservation_retry_candidates rr
    ON rr.source_channel = q.source_channel
   AND rr.source_order_id = q.source_order_id
   AND rr.source_order_item_id = q.source_order_item_id
  LEFT JOIN public.v_inventory_shipped_finalize_audit a
    ON a.source_order_id = q.source_order_id
   AND a.source_order_item_id = q.source_order_item_id
  LEFT JOIN LATERAL (
    SELECT m.id, m.ledger_id, m.status
    FROM public.inventory_manual_finalize_actions m
    WHERE m.source_order_id = q.source_order_id
      AND m.source_order_item_id = q.source_order_item_id
      AND m.status IN ('success', 'idempotent')
    ORDER BY m.created_at DESC
    LIMIT 1
  ) mf ON true
),
classified AS (
  SELECT
    j.*,
    CASE
      WHEN j.next_step = 'manual_review' THEN 'needs_manual_review'
      WHEN j.next_step = 'reservation_retry' AND (
        j.retry_reservation_id IS NOT NULL
        OR j.retry_suggested_action = 'already_reserved'
      ) THEN 'appears_completed'
      WHEN j.next_step = 'reservation_retry' AND j.retry_suggested_action IN ('skip_afn', 'skip_refunded', 'skip_canceled') THEN 'no_longer_applicable'
      WHEN j.next_step IN ('shipped_finalize_audit', 'manual_finalize_possible') AND (
        j.suggested_audit_status = 'accounted_for'
        OR j.manual_finalize_action_id IS NOT NULL
        OR j.matching_ledger_id IS NOT NULL
      ) THEN 'appears_completed'
      WHEN j.next_step IN ('shipped_finalize_audit', 'manual_finalize_possible') AND (
        j.suggested_audit_status IN ('skipped_afn', 'refunded_after_ship')
        OR (j.suggested_audit_status IS NOT NULL AND NOT COALESCE(j.needs_audit_issue, false) AND j.suggested_audit_status <> 'missing_variant')
      ) THEN 'no_longer_applicable'
      ELSE 'still_open'
    END AS detected_resolution_status,
    CASE
      WHEN j.next_step = 'reservation_retry' AND (
        j.retry_reservation_id IS NOT NULL OR j.retry_suggested_action = 'already_reserved'
      ) THEN 'reservation_exists'
      WHEN j.suggested_audit_status = 'accounted_for' THEN 'audit_accounted_for'
      WHEN j.matching_ledger_id IS NOT NULL OR j.manual_finalize_ledger_id IS NOT NULL THEN 'ledger_found'
      WHEN j.retry_suggested_action = 'skip_afn' OR j.suggested_audit_status = 'skipped_afn' THEN 'skipped_afn'
      WHEN j.retry_suggested_action IN ('skip_refunded', 'skip_canceled')
        OR j.suggested_audit_status = 'refunded_after_ship' THEN 'refunded_or_canceled'
      ELSE 'none'
    END AS underlying_signal
  FROM joined j
)
SELECT
  c.*,
  CASE
    WHEN c.detected_resolution_status = 'appears_completed' THEN 'mark_done'
    WHEN c.detected_resolution_status = 'no_longer_applicable' THEN 'ignore'
    WHEN c.detected_resolution_status = 'needs_manual_review' THEN 'review'
    ELSE 'keep_open'
  END AS suggested_status_action,
  CASE
    WHEN c.detected_resolution_status = 'appears_completed' AND c.underlying_signal = 'reservation_exists' THEN
      'Active reservation exists for this order line'
    WHEN c.detected_resolution_status = 'appears_completed' AND c.underlying_signal = 'audit_accounted_for' THEN
      'Shipped audit shows line is accounted for'
    WHEN c.detected_resolution_status = 'appears_completed' AND c.underlying_signal = 'ledger_found' THEN
      'Matching finalize ledger or manual finalize audit found'
    WHEN c.detected_resolution_status = 'no_longer_applicable' AND c.underlying_signal = 'skipped_afn' THEN
      'AFN/FBA line — no local inventory action expected'
    WHEN c.detected_resolution_status = 'no_longer_applicable' AND c.underlying_signal = 'refunded_or_canceled' THEN
      'Refunded or canceled — queue item may no longer apply'
    WHEN c.detected_resolution_status = 'needs_manual_review' THEN
      'Manual review required — no automatic completion'
    WHEN c.detected_resolution_status = 'still_open' THEN
      'Follow-up action still recommended'
    ELSE 'Review queue item'
  END AS detected_reason
FROM classified c;

COMMENT ON VIEW public.v_inventory_post_map_queue_with_resolution IS
  'Post-map queue rows with read-only resolution detection (Phase 9C). Suggestions only.';

GRANT SELECT ON public.v_inventory_post_map_queue_with_resolution TO authenticated, service_role;

-- Bulk workflow-only status updates (no inventory mutations).
CREATE OR REPLACE FUNCTION public.update_post_map_queue_items_bulk(
  p_ids             uuid[],
  p_status          text,
  p_snoozed_until   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_is_admin boolean := false;
  v_updated integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('open', 'reviewed', 'snoozed', 'done', 'ignored') THEN
    RAISE EXCEPTION 'Invalid status' USING ERRCODE = 'P0001';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'updated_count', 0);
  END IF;

  UPDATE public.inventory_post_map_action_queue
  SET
    status = p_status,
    snoozed_until = CASE WHEN p_status = 'snoozed' THEN p_snoozed_until ELSE NULL END,
    updated_by = v_actor,
    updated_at = now(),
    completed_at = CASE
      WHEN p_status IN ('done', 'ignored') THEN COALESCE(completed_at, now())
      ELSE NULL
    END
  WHERE id = ANY (p_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated_count', v_updated);
END;
$$;

COMMENT ON FUNCTION public.update_post_map_queue_items_bulk IS
  'Admin-only bulk queue status update. Workflow only — no inventory mutations.';

GRANT EXECUTE ON FUNCTION public.update_post_map_queue_items_bulk TO authenticated;
