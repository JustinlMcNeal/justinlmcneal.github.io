-- Phase 10H — Partial refund / return guidance for live bundle component lines (read-only).

CREATE OR REPLACE VIEW public.v_inventory_bundle_component_return_guidance AS
WITH line_amounts AS (
  SELECT
    li.stripe_checkout_session_id,
    li.stripe_line_item_id,
    li.quantity AS parent_line_quantity,
    (
      COALESCE(li.quantity, 1)
      * COALESCE(li.post_discount_unit_price_cents, li.unit_price_cents, 0)
    )::integer AS line_total_cents
  FROM public.line_items_raw li
),
computed AS (
  SELECT
    c.reservation_id,
    c.parent_bundle_variant_id,
    c.parent_order_item_id,
    c.source_order_id,
    c.source_order_item_id,
    c.component_variant_id,
    c.component_product_label,
    c.component_sku,
    c.parent_bundle_label,
    c.quantity_finalized AS finalized_qty,
    c.quantity_already_restocked AS already_restocked_qty,
    c.quantity_available_to_restock AS max_restockable_qty,
    c.finalized_at,
    c.matching_ledger_id,
    c.refund_status,
    c.return_status,
    c.suggested_action,
    o.total_paid_cents AS order_total_cents,
    COALESCE(o.refund_amount_cents, 0)::integer AS refunded_amount_cents,
    la.line_total_cents,
    la.parent_line_quantity,
    CASE
      WHEN COALESCE(o.total_paid_cents, 0) > 0 AND COALESCE(o.refund_amount_cents, 0) > 0 THEN
        ROUND(o.refund_amount_cents::numeric / o.total_paid_cents::numeric, 4)
      ELSE NULL
    END AS estimated_refund_ratio,
    CASE
      WHEN c.quantity_available_to_restock <= 0 THEN 0
      WHEN COALESCE(o.refund_status, '') = 'full' THEN c.quantity_available_to_restock
      WHEN COALESCE(o.refund_status, '') = 'partial'
        AND la.line_total_cents IS NOT NULL
        AND COALESCE(o.refund_amount_cents, 0) >= la.line_total_cents THEN
        c.quantity_available_to_restock
      WHEN COALESCE(o.refund_status, '') IN ('', 'none') OR o.refund_status IS NULL THEN
        c.quantity_available_to_restock
      ELSE NULL
    END AS suggested_restock_qty_raw
  FROM public.v_inventory_bundle_component_return_candidates c
  LEFT JOIN public.orders_raw o ON o.stripe_checkout_session_id = c.source_order_id
  LEFT JOIN line_amounts la
    ON la.stripe_checkout_session_id = c.source_order_id
    AND la.stripe_line_item_id = COALESCE(c.parent_order_item_id, c.source_order_item_id)
)
SELECT
  reservation_id,
  parent_bundle_variant_id,
  parent_order_item_id,
  source_order_id,
  source_order_item_id,
  component_variant_id,
  component_product_label,
  component_sku,
  parent_bundle_label,
  finalized_qty,
  already_restocked_qty,
  max_restockable_qty,
  finalized_at,
  matching_ledger_id,
  refund_status,
  return_status,
  suggested_action,
  order_total_cents,
  refunded_amount_cents,
  line_total_cents,
  parent_line_quantity,
  estimated_refund_ratio,
  CASE
    WHEN suggested_restock_qty_raw IS NULL THEN NULL
    ELSE LEAST(GREATEST(suggested_restock_qty_raw, 0), max_restockable_qty)::integer
  END AS suggested_restock_qty,
  CASE
    WHEN suggested_action = 'not_finalized' THEN 'manual_review'
    WHEN max_restockable_qty <= 0 THEN 'already_restocked'
    WHEN COALESCE(refund_status, '') = 'full' AND max_restockable_qty > 0 THEN 'full_refund_after_finalize'
    WHEN COALESCE(refund_status, '') = 'partial' AND suggested_restock_qty_raw IS NULL THEN 'partial_refund_review'
    WHEN COALESCE(refund_status, '') IN ('', 'none') OR refund_status IS NULL THEN 'restock_available'
    WHEN suggested_restock_qty_raw IS NOT NULL AND max_restockable_qty > 0 THEN 'restock_available'
    ELSE 'manual_review'
  END AS guidance_status,
  CASE
    WHEN suggested_action = 'not_finalized' THEN
      'Reservation not finalized — release-only applies before shipment.'
    WHEN max_restockable_qty <= 0 THEN
      'All finalized component quantity has been restocked.'
    WHEN COALESCE(refund_status, '') = 'full' THEN
      'Full order refund after finalize — suggested restock equals remaining component qty; confirm physical return.'
    WHEN COALESCE(refund_status, '') = 'partial' AND suggested_restock_qty_raw IS NULL THEN
      'Partial refund detected — dollar amount alone does not prove line qty returned; manual review required.'
    WHEN COALESCE(refund_status, '') = 'partial' AND suggested_restock_qty_raw IS NOT NULL THEN
      'Partial order refund appears to cover full parent line — suggested qty is advisory only.'
    WHEN COALESCE(refund_status, '') IN ('', 'none') OR refund_status IS NULL THEN
      'No refund on order — restock only after confirming physical return.'
    ELSE
      'Manual review — confirm return condition before restock.'
  END AS guidance_reason
FROM computed;

COMMENT ON VIEW public.v_inventory_bundle_component_return_guidance IS
  'Phase 10H: refund context + suggested restock guidance for live bundle component returns (no auto-restock).';

GRANT SELECT ON public.v_inventory_bundle_component_return_guidance TO authenticated, service_role;
