-- Phase 10K — Stripe refund detail cache + enhanced return guidance (read-only / observational).

CREATE TABLE IF NOT EXISTS public.order_refund_details (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel          text NOT NULL DEFAULT 'kk',
  source_order_id         text NOT NULL,
  source_order_item_id    text,
  stripe_refund_id        text,
  stripe_payment_intent_id text,
  stripe_charge_id        text,
  refund_amount_cents     integer NOT NULL CHECK (refund_amount_cents >= 0),
  currency                text NOT NULL DEFAULT 'usd',
  refund_status           text,
  refund_reason           text,
  line_allocation_confidence text NOT NULL DEFAULT 'order_level'
    CHECK (line_allocation_confidence IN ('order_level', 'line_inferred', 'line_confirmed', 'none')),
  refund_created_at       timestamptz,
  raw_payload             jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_refund_details_stripe_refund
  ON public.order_refund_details (stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_refund_details_order
  ON public.order_refund_details (source_order_id, refund_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_refund_details_order_line
  ON public.order_refund_details (source_order_id, source_order_item_id)
  WHERE source_order_item_id IS NOT NULL;

ALTER TABLE public.order_refund_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_refund_details_service_all
  ON public.order_refund_details FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY order_refund_details_authenticated_select
  ON public.order_refund_details FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.order_refund_details TO authenticated;
GRANT ALL ON public.order_refund_details TO service_role;

COMMENT ON TABLE public.order_refund_details IS
  'Phase 10K: observational Stripe refund cache — does not mutate stock, reservations, or return workflow.';

-- Enhanced return guidance (replaces Phase 10H view with refund-detail awareness).
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
refund_agg AS (
  SELECT
    source_order_id,
    COUNT(*)::integer AS refund_detail_count,
    COALESCE(SUM(refund_amount_cents), 0)::integer AS detail_refund_total_cents,
    MAX(refund_created_at) AS latest_refund_at
  FROM public.order_refund_details
  GROUP BY source_order_id
),
line_refund_agg AS (
  SELECT
    source_order_id,
    source_order_item_id,
    COALESCE(SUM(refund_amount_cents), 0)::integer AS line_refund_cents,
    MAX(line_allocation_confidence) AS line_confidence
  FROM public.order_refund_details
  WHERE source_order_item_id IS NOT NULL
  GROUP BY source_order_id, source_order_item_id
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
    o.refunded_at AS order_refunded_at,
    la.line_total_cents,
    la.parent_line_quantity,
    ra.refund_detail_count,
    ra.detail_refund_total_cents,
    ra.latest_refund_at,
    lra.line_refund_cents,
    lra.line_confidence,
    wf.id AS workflow_id,
    wf.status AS workflow_status,
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
        AND COALESCE(o.refund_amount_cents, 0) >= la.line_total_cents
        AND lra.line_confidence IN ('line_confirmed', 'line_inferred') THEN
        c.quantity_available_to_restock
      WHEN COALESCE(o.refund_status, '') IN ('', 'none') OR o.refund_status IS NULL THEN
        c.quantity_available_to_restock
      ELSE NULL
    END AS suggested_restock_qty_raw,
    CASE
      WHEN COALESCE(o.refund_status, '') IN ('', 'none') OR o.refund_status IS NULL THEN 'none'
      WHEN COALESCE(o.refund_status, '') = 'full'
        OR COALESCE(o.refund_amount_cents, 0) >= COALESCE(o.total_paid_cents, 0) THEN 'high'
      WHEN lra.line_confidence = 'line_confirmed' THEN 'high'
      WHEN lra.line_confidence = 'line_inferred' THEN 'medium'
      WHEN COALESCE(o.refund_status, '') = 'partial' THEN 'low'
      ELSE 'medium'
    END AS refund_confidence
  FROM public.v_inventory_bundle_component_return_candidates c
  LEFT JOIN public.orders_raw o ON o.stripe_checkout_session_id = c.source_order_id
  LEFT JOIN line_amounts la
    ON la.stripe_checkout_session_id = c.source_order_id
    AND la.stripe_line_item_id = COALESCE(c.parent_order_item_id, c.source_order_item_id)
  LEFT JOIN refund_agg ra ON ra.source_order_id = c.source_order_id
  LEFT JOIN line_refund_agg lra
    ON lra.source_order_id = c.source_order_id
    AND lra.source_order_item_id = COALESCE(c.parent_order_item_id, c.source_order_item_id)
  LEFT JOIN LATERAL (
    SELECT rw.id, rw.status
    FROM public.inventory_return_workflow rw
    WHERE rw.reservation_id = c.reservation_id
      AND rw.status NOT IN ('closed', 'canceled')
    ORDER BY rw.updated_at DESC
    LIMIT 1
  ) wf ON true
),
base_guidance AS (
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
    order_refunded_at,
    line_total_cents,
    parent_line_quantity,
    estimated_refund_ratio,
    refund_detail_count,
    detail_refund_total_cents,
    latest_refund_at,
    line_refund_cents,
    line_confidence,
    refund_confidence,
    workflow_id,
    workflow_status,
    suggested_restock_qty_raw,
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
    END AS guidance_status
  FROM computed
),
with_refund_status AS (
  SELECT
    b.*,
    CASE
      WHEN COALESCE(b.refund_status, '') IN ('', 'none') OR b.refund_status IS NULL THEN 'no_refund'
      WHEN COALESCE(b.refund_status, '') = 'full'
        OR COALESCE(b.refunded_amount_cents, 0) >= COALESCE(b.order_total_cents, 0) THEN 'full_refund_detected'
      WHEN b.line_refund_cents IS NOT NULL AND b.line_confidence = 'line_confirmed' THEN 'line_refund_confirmed'
      WHEN COALESCE(b.refund_status, '') = 'partial' THEN 'partial_refund_detected'
      ELSE 'partial_refund_detected'
    END AS refund_guidance_status
  FROM base_guidance b
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
  order_refunded_at,
  line_total_cents,
  parent_line_quantity,
  estimated_refund_ratio,
  refund_detail_count,
  detail_refund_total_cents,
  latest_refund_at,
  line_refund_cents,
  refund_confidence,
  workflow_id,
  workflow_status,
  suggested_restock_qty,
  guidance_status,
  refund_guidance_status,
  CASE
    WHEN COALESCE(refund_status, '') IN ('', 'none') OR refund_status IS NULL THEN
      'No refund on order — restock only after confirming physical return.'
    WHEN max_restockable_qty <= 0 THEN
      'All finalized component quantity has been restocked.'
    WHEN COALESCE(refund_status, '') = 'full' THEN
      'Full order refund after finalize — suggested restock equals remaining component qty; confirm physical return.'
    WHEN refund_guidance_status = 'line_refund_confirmed' THEN
      'Line-level refund data available — suggested qty is advisory; confirm physical return condition.'
    WHEN COALESCE(refund_status, '') = 'partial' AND suggested_restock_qty IS NULL THEN
      'Partial refund detected — dollar amount alone does not prove line qty returned; manual review required.'
    WHEN COALESCE(refund_status, '') = 'partial' AND suggested_restock_qty IS NOT NULL THEN
      'Partial order refund appears to cover full parent line — suggested qty is advisory only.'
    ELSE
      'Manual review — confirm return condition before restock.'
  END AS guidance_reason,
  CASE
    WHEN COALESCE(refund_status, '') IN ('', 'none') OR refund_status IS NULL THEN NULL
    WHEN workflow_id IS NULL
      AND refund_guidance_status = 'full_refund_detected'
      AND max_restockable_qty > 0 THEN 'create_return_workflow'
    WHEN workflow_id IS NOT NULL
      AND workflow_status NOT IN ('closed', 'canceled', 'restocked') THEN 'return_workflow_open'
    WHEN max_restockable_qty > 0
      AND refund_guidance_status IN ('full_refund_detected', 'line_refund_confirmed')
      AND suggested_restock_qty IS NOT NULL THEN 'restock_review'
    WHEN refund_guidance_status = 'partial_refund_detected' THEN 'manual_review'
    ELSE NULL
  END AS suggested_panel_action
FROM with_refund_status;

COMMENT ON VIEW public.v_inventory_bundle_component_return_guidance IS
  'Phase 10K: refund context + Stripe detail cache + suggested restock guidance (no auto-restock).';

GRANT SELECT ON public.v_inventory_bundle_component_return_guidance TO authenticated, service_role;

-- Recreate workflow overlay (depends on enhanced guidance columns).
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
  CASE
    WHEN g.refund_guidance_status = 'no_refund' AND g.max_restockable_qty > 0 AND w.id IS NULL THEN 'create_rma'
    WHEN g.refund_guidance_status = 'full_refund_detected' AND w.id IS NULL THEN 'create_rma'
    WHEN g.refund_guidance_status IN ('partial_refund_detected', 'refund_restock_review_needed')
      AND g.refund_confidence = 'low' THEN 'manual_review'
    WHEN w.status IN ('open', 'return_expected') THEN 'wait_for_return'
    WHEN w.status IN ('received', 'partially_received') THEN 'inspect_return'
    WHEN w.status = 'inspected' AND w.condition = 'resellable' AND g.max_restockable_qty > 0 THEN 'restock_received'
    WHEN w.status IN ('restocked', 'closed') OR g.max_restockable_qty <= 0 THEN 'close_return'
    WHEN w.condition IN ('damaged', 'missing') THEN 'manual_review'
    WHEN g.suggested_panel_action = 'restock_review' THEN 'restock_received'
    ELSE 'manual_review'
  END AS workflow_next_action,
  CASE
    WHEN g.refund_guidance_status = 'no_refund' THEN 'no_refund'
    WHEN g.refund_guidance_status = 'full_refund_detected' AND w.id IS NULL THEN 'refund_without_return_workflow'
    WHEN g.refund_guidance_status = 'full_refund_detected' AND w.id IS NOT NULL
      AND w.status NOT IN ('closed', 'canceled') THEN 'refund_with_return_workflow_open'
    WHEN g.refund_guidance_status = 'partial_refund_detected' THEN 'partial_refund_detected'
    WHEN g.refund_guidance_status = 'line_refund_confirmed' THEN 'line_refund_confirmed'
    WHEN g.max_restockable_qty > 0
      AND g.refund_guidance_status IN ('full_refund_detected', 'line_refund_confirmed', 'partial_refund_detected')
      AND g.suggested_panel_action = 'restock_review' THEN 'refund_restock_review_needed'
    ELSE g.refund_guidance_status
  END AS refund_guidance_status_resolved
FROM public.v_inventory_bundle_component_return_guidance g
LEFT JOIN latest_workflow w ON w.reservation_id = g.reservation_id;

COMMENT ON VIEW public.v_inventory_bundle_component_return_workflow_guidance IS
  'Phase 10K: return guidance + RMA workflow + Stripe refund guidance overlay.';

GRANT SELECT ON public.v_inventory_bundle_component_return_workflow_guidance TO authenticated, service_role;
