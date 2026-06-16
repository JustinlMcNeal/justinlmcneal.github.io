-- Phase 9A — Post-map workflow assist (read-only classification + navigation).
-- No auto reservation retry, manual finalize, stock/reservation/ledger, or channel API writes.

CREATE OR REPLACE VIEW public.v_inventory_post_mapping_workflow_candidates AS
WITH mapped_actions AS (
  SELECT
    a.id AS mapping_action_id,
    a.source_channel,
    split_part(a.source_reference, ':', 1) AS source_order_id,
    split_part(a.source_reference, ':', 2) AS source_order_item_id,
    a.selected_product_id AS product_id,
    a.selected_variant_id AS variant_id,
    a.source_sku,
    a.source_title,
    a.created_at AS mapped_at
  FROM public.inventory_mapping_assist_actions a
  WHERE a.status = 'success'
    AND a.action_type = 'order_line_variant'
    AND a.source_reference IS NOT NULL
    AND position(':' IN a.source_reference) > 0
),
with_batch AS (
  SELECT
    ma.*,
    (
      SELECT b.id
      FROM public.inventory_mapping_assist_batches b
      WHERE b.created_at BETWEEN ma.mapped_at - interval '2 seconds' AND ma.mapped_at + interval '30 seconds'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(b.results, '[]'::jsonb)) elem
          WHERE elem->>'source_order_id' = ma.source_order_id
            AND elem->>'source_order_item_id' = ma.source_order_item_id
        )
      ORDER BY b.created_at DESC
      LIMIT 1
    ) AS batch_id
  FROM mapped_actions ma
)
SELECT
  wb.mapping_action_id,
  wb.batch_id,
  wb.source_channel,
  wb.source_order_id,
  wb.source_order_item_id,
  wb.product_id,
  wb.variant_id,
  COALESCE(p.name, wb.source_title, 'Unknown') AS product_label,
  COALESCE(NULLIF(BTRIM(pv.sku), ''), NULLIF(BTRIM(wb.source_sku), ''), '—') AS internal_sku,
  wb.source_sku,
  wb.source_title,
  COALESCE(li.quantity, 0)::int AS quantity,
  COALESCE(rr.order_status, sfa.order_status, 'unknown') AS order_status,
  COALESCE(rr.payment_status, sfa.payment_status, 'unknown') AS payment_status,
  COALESCE(rr.fulfillment_status, sfa.fulfillment_status) AS fulfillment_status,
  COALESCE(rr.refund_status, sfa.refund_status) AS refund_status,
  sfa.fulfillment_channel,
  wb.mapped_at,
  CASE
    WHEN COALESCE(rr.suggested_action, '') = 'skip_afn'
      OR COALESCE(sfa.suggested_audit_status, '') = 'skipped_afn' THEN 'skipped_afn'
    WHEN COALESCE(rr.suggested_action, '') = 'skip_refunded'
      OR COALESCE(sfa.suggested_audit_status, '') = 'refunded_after_ship' THEN 'skipped_refunded'
    WHEN COALESCE(rr.suggested_action, '') = 'skip_canceled'
      OR COALESCE(sfa.order_status, '') = 'canceled' THEN 'skipped_canceled'
    WHEN COALESCE(sfa.suggested_audit_status, '') = 'accounted_for'
      OR COALESCE(rr.suggested_action, '') = 'already_reserved' THEN 'already_accounted_for'
    WHEN COALESCE(sfa.is_finalize_eligible, false) THEN 'manual_finalize_possible'
    WHEN sfa.source_order_id IS NOT NULL AND COALESCE(sfa.needs_audit_issue, false) THEN 'shipped_finalize_audit'
    WHEN COALESCE(rr.suggested_action, '') = 'create_reservation' THEN 'reservation_retry'
    ELSE 'manual_review'
  END AS next_step,
  CASE
    WHEN COALESCE(rr.suggested_action, '') = 'skip_afn'
      OR COALESCE(sfa.suggested_audit_status, '') = 'skipped_afn' THEN 'Amazon AFN/FBA — no local reservation or finalize expected'
    WHEN COALESCE(rr.suggested_action, '') = 'skip_refunded'
      OR COALESCE(sfa.suggested_audit_status, '') = 'refunded_after_ship' THEN 'Fully refunded — review order manually'
    WHEN COALESCE(rr.suggested_action, '') = 'skip_canceled'
      OR COALESCE(sfa.order_status, '') = 'canceled' THEN 'Canceled — no inventory action expected'
    WHEN COALESCE(sfa.suggested_audit_status, '') = 'accounted_for'
      OR COALESCE(rr.suggested_action, '') = 'already_reserved' THEN 'Reservation or ledger signal already present'
    WHEN COALESCE(sfa.is_finalize_eligible, false) THEN 'Eligible for admin manual finalize assist (confirm separately)'
    WHEN sfa.source_order_id IS NOT NULL AND COALESCE(sfa.needs_audit_issue, false) THEN COALESCE(sfa.reason, 'Shipped line needs finalize audit review')
    WHEN COALESCE(rr.suggested_action, '') = 'create_reservation' THEN COALESCE(rr.reason, 'Paid/unshipped — reservation retry available')
    WHEN COALESCE(rr.suggested_action, '') = 'manual_review' THEN COALESCE(rr.reason, 'Partial refund or ambiguous state — review manually')
    WHEN COALESCE(sfa.suggested_audit_status, '') = 'manual_review' THEN COALESCE(sfa.reason, 'Ambiguous shipped accounting — review manually')
    ELSE 'Review order line manually'
  END AS next_step_reason,
  CASE
    WHEN COALESCE(rr.suggested_action, '') = 'create_reservation' THEN 'reservation_retry'
    WHEN COALESCE(sfa.is_finalize_eligible, false) THEN 'manual_finalize_assist'
    WHEN sfa.source_order_id IS NOT NULL AND COALESCE(sfa.needs_audit_issue, false) THEN 'shipped_finalize_audit'
    WHEN COALESCE(sfa.suggested_audit_status, '') = 'accounted_for'
      OR COALESCE(rr.suggested_action, '') = 'already_reserved' THEN 'none'
    ELSE 'line_items_orders'
  END AS action_target
FROM with_batch wb
JOIN public.line_items_raw li
  ON li.stripe_checkout_session_id = wb.source_order_id
 AND li.stripe_line_item_id = wb.source_order_item_id
LEFT JOIN public.product_variants pv ON pv.id = wb.variant_id
LEFT JOIN public.products p ON p.id = wb.product_id
LEFT JOIN public.v_inventory_reservation_retry_candidates rr
  ON rr.source_order_id = wb.source_order_id
 AND rr.source_order_item_id = wb.source_order_item_id
LEFT JOIN public.v_inventory_shipped_finalize_audit sfa
  ON sfa.source_order_id = wb.source_order_id
 AND sfa.source_order_item_id = wb.source_order_item_id;

COMMENT ON VIEW public.v_inventory_post_mapping_workflow_candidates IS
  'Post-map next-step classification for mapped order lines (Phase 9A). Read-only guidance; no auto actions.';

GRANT SELECT ON public.v_inventory_post_mapping_workflow_candidates TO authenticated, service_role;
