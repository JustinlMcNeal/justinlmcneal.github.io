-- Phase 10O — Line-level marketplace refund mapping in return guidance.

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
persisted_agg AS (
  SELECT
    p.source_order_id,
    COUNT(*)::integer AS persisted_observation_count,
    MAX(p.observed_at) AS latest_persisted_obs_at,
    BOOL_OR(p.is_afn) AS persisted_is_afn,
    BOOL_OR(p.observation_kind = 'cancellation') AS has_persisted_cancellation,
    BOOL_OR(p.observation_kind = 'return') AS has_persisted_return
  FROM public.marketplace_refund_observations p
  GROUP BY p.source_order_id
),
persisted_latest AS (
  SELECT DISTINCT ON (p.source_order_id)
    p.source_order_id,
    p.sync_source AS marketplace_sync_source
  FROM public.marketplace_refund_observations p
  ORDER BY p.source_order_id, p.observed_at DESC NULLS LAST, p.updated_at DESC
),
line_obs_agg AS (
  SELECT
    p.source_order_id,
    p.source_order_item_id,
    MAX(p.line_allocation_confidence) AS line_allocation_confidence,
    MAX(p.observation_kind) AS observation_kind,
    MAX(p.sync_source) AS line_sync_source
  FROM public.marketplace_refund_observations p
  WHERE p.source_order_item_id IS NOT NULL
    AND p.line_allocation_confidence IN ('line_confirmed', 'sku_inferred')
  GROUP BY p.source_order_id, p.source_order_item_id
),
marketplace_agg AS (
  SELECT
    m.source_order_id,
    COUNT(*)::integer AS marketplace_observation_count,
    MAX(m.observed_at) AS latest_marketplace_obs_at,
    BOOL_OR(m.observation_kind = 'cancellation') AS has_marketplace_cancellation,
    BOOL_OR(m.observation_kind = 'return') AS has_marketplace_return,
    BOOL_OR(m.refund_source = 'ebay') AS has_ebay_observation,
    BOOL_OR(m.refund_source = 'amazon') AS has_amazon_observation
  FROM public.v_inventory_marketplace_refund_observations m
  WHERE m.refund_source IN ('ebay', 'amazon', 'marketplace')
  GROUP BY m.source_order_id
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
    o.refund_reason AS order_refund_reason,
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
      WHEN c.source_order_id LIKE 'cs_%' OR o.stripe_payment_intent_id IS NOT NULL THEN 'stripe'
      WHEN c.source_order_id LIKE 'ebay%' THEN 'ebay'
      WHEN c.source_order_id LIKE 'amazon_%' THEN 'amazon'
      ELSE 'kk'
    END AS order_channel,
    CASE
      WHEN COALESCE(pa.persisted_is_afn, false) THEN true
      WHEN c.source_order_id LIKE 'amazon_%'
        AND (
          fs.service ILIKE '%Fulfilled by Amazon%'
          OR fs.carrier = 'Amazon'
        )
      THEN true
      ELSE false
    END AS is_amazon_afn,
    COALESCE(ma.marketplace_observation_count, 0) AS marketplace_observation_count,
    COALESCE(pa.persisted_observation_count, 0) AS persisted_observation_count,
    ma.latest_marketplace_obs_at,
    pa.latest_persisted_obs_at,
    pl.marketplace_sync_source,
    loa.line_allocation_confidence AS marketplace_line_confidence,
    loa.line_sync_source AS marketplace_line_sync_source,
    COALESCE(ma.has_marketplace_cancellation, false) AS has_marketplace_cancellation,
    COALESCE(ma.has_marketplace_return, false) AS has_marketplace_return,
    COALESCE(ma.has_ebay_observation, false) AS has_ebay_observation,
    COALESCE(ma.has_amazon_observation, false) AS has_amazon_observation,
    CASE
      WHEN COALESCE(o.total_paid_cents, 0) > 0 AND COALESCE(o.refund_amount_cents, 0) > 0 THEN
        ROUND(o.refund_amount_cents::numeric / o.total_paid_cents::numeric, 4)
      ELSE NULL
    END AS estimated_refund_ratio,
    CASE
      WHEN c.quantity_available_to_restock <= 0 THEN 0
      WHEN COALESCE(ma.has_marketplace_cancellation, false)
        AND c.suggested_action = 'not_finalized' THEN NULL
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
      WHEN c.source_order_id LIKE 'amazon_%'
        AND (
          fs.service ILIKE '%Fulfilled by Amazon%'
          OR fs.carrier = 'Amazon'
        )
      THEN 'manual_review'
      WHEN COALESCE(ra.refund_detail_count, 0) > 0
        AND lra.line_confidence = 'line_confirmed' THEN 'line_confirmed'
      WHEN COALESCE(ra.refund_detail_count, 0) > 0
        AND lra.line_confidence = 'line_inferred' THEN 'line_inferred'
      WHEN COALESCE(ra.refund_detail_count, 0) > 0 THEN 'high'
      WHEN COALESCE(o.refund_status, '') IN ('', 'none') OR o.refund_status IS NULL THEN 'none'
      WHEN COALESCE(o.refund_status, '') = 'full'
        OR COALESCE(o.refund_amount_cents, 0) >= COALESCE(o.total_paid_cents, 0) THEN 'high'
      WHEN COALESCE(pa.persisted_observation_count, 0) > 0
        AND loa.line_allocation_confidence = 'line_confirmed' THEN 'line_confirmed'
      WHEN loa.line_allocation_confidence = 'sku_inferred' THEN 'manual_review'
      WHEN COALESCE(pa.persisted_observation_count, 0) > 0
        AND (c.source_order_id LIKE 'ebay%' OR c.source_order_id LIKE 'amazon_%') THEN 'manual_review'
      WHEN c.source_order_id LIKE 'ebay%' OR c.source_order_id LIKE 'amazon_%' THEN 'low'
      WHEN COALESCE(o.refund_status, '') = 'partial' THEN 'low'
      ELSE 'medium'
    END AS refund_confidence
  FROM public.v_inventory_bundle_component_return_candidates c
  LEFT JOIN public.orders_raw o ON o.stripe_checkout_session_id = c.source_order_id
  LEFT JOIN public.fulfillment_shipments fs ON fs.stripe_checkout_session_id = c.source_order_id
  LEFT JOIN line_amounts la
    ON la.stripe_checkout_session_id = c.source_order_id
    AND la.stripe_line_item_id = COALESCE(c.parent_order_item_id, c.source_order_item_id)
  LEFT JOIN refund_agg ra ON ra.source_order_id = c.source_order_id
  LEFT JOIN line_refund_agg lra
    ON lra.source_order_id = c.source_order_id
    AND lra.source_order_item_id = COALESCE(c.parent_order_item_id, c.source_order_item_id)
  LEFT JOIN marketplace_agg ma ON ma.source_order_id = c.source_order_id
  LEFT JOIN persisted_agg pa ON pa.source_order_id = c.source_order_id
  LEFT JOIN persisted_latest pl ON pl.source_order_id = c.source_order_id
  LEFT JOIN line_obs_agg loa
    ON loa.source_order_id = c.source_order_id
    AND loa.source_order_item_id = COALESCE(c.parent_order_item_id, c.source_order_item_id)
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
    order_refund_reason,
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
    order_channel,
    is_amazon_afn,
    marketplace_observation_count,
    persisted_observation_count,
    latest_marketplace_obs_at,
    latest_persisted_obs_at,
    marketplace_sync_source,
    marketplace_line_confidence,
    marketplace_line_sync_source,
    has_marketplace_cancellation,
    has_marketplace_return,
    has_ebay_observation,
    has_amazon_observation,
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
      WHEN COALESCE(b.refund_detail_count, 0) > 0 THEN 'stripe'
      WHEN b.order_channel = 'ebay' OR b.has_ebay_observation THEN 'ebay'
      WHEN b.order_channel = 'amazon' OR b.has_amazon_observation THEN 'amazon'
      WHEN b.order_channel IN ('stripe', 'kk') THEN 'stripe'
      ELSE 'none'
    END AS refund_source_channel,
    CASE
      WHEN b.is_amazon_afn
        AND (
          b.marketplace_observation_count > 0
          OR COALESCE(b.refund_status, '') NOT IN ('', 'none')
          OR b.order_refund_reason = 'returned'
        ) THEN 'afn_external_fulfillment_review'
      WHEN COALESCE(b.refund_detail_count, 0) > 0
        OR (
          b.order_channel IN ('stripe', 'kk')
          AND COALESCE(b.refund_status, '') NOT IN ('', 'none')
        ) THEN
        CASE
          WHEN COALESCE(b.refund_status, '') IN ('', 'none') OR b.refund_status IS NULL THEN 'no_refund'
          WHEN COALESCE(b.refund_status, '') = 'full'
            OR COALESCE(b.refunded_amount_cents, 0) >= COALESCE(b.order_total_cents, 0) THEN 'full_refund_detected'
          WHEN b.line_refund_cents IS NOT NULL AND b.line_confidence = 'line_confirmed' THEN 'line_refund_confirmed'
          WHEN COALESCE(b.refund_status, '') = 'partial' THEN 'partial_refund_detected'
          ELSE 'partial_refund_detected'
        END
      WHEN b.has_marketplace_cancellation
        AND b.suggested_action = 'not_finalized' THEN 'cancellation_detected'
      WHEN b.has_marketplace_cancellation
        OR b.order_refund_reason IN ('cancelled_before_ship', 'cancelled') THEN 'cancellation_detected'
      WHEN b.order_refund_reason = 'returned' OR b.has_marketplace_return THEN 'return_detected'
      WHEN b.order_channel IN ('ebay', 'amazon')
        AND (
          b.marketplace_observation_count > 0
          OR COALESCE(b.refund_status, '') NOT IN ('', 'none')
        ) THEN
        CASE
          WHEN COALESCE(b.refund_status, '') = 'full'
            OR COALESCE(b.refunded_amount_cents, 0) >= COALESCE(b.order_total_cents, 0) THEN 'full_refund_detected'
          WHEN COALESCE(b.refund_status, '') = 'partial' THEN 'partial_refund_detected'
          ELSE 'marketplace_refund_review'
        END
      WHEN COALESCE(b.refund_status, '') IN ('', 'none') OR b.refund_status IS NULL THEN 'no_refund'
      ELSE 'marketplace_refund_review'
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
  refund_source_channel,
  order_channel,
  is_amazon_afn,
  marketplace_observation_count,
  persisted_observation_count,
  latest_marketplace_obs_at,
  latest_persisted_obs_at,
  marketplace_sync_source,
  marketplace_line_confidence,
  CASE
    WHEN refund_guidance_status = 'afn_external_fulfillment_review' THEN
      'Amazon AFN/FBA order — local inventory return/restock requires manual review.'
    WHEN refund_guidance_status = 'cancellation_detected'
      AND suggested_action = 'not_finalized' THEN
      'Marketplace cancellation detected — no local finalize/restock action unless stock was already affected.'
    WHEN refund_guidance_status IN ('marketplace_refund_review', 'cancellation_detected', 'return_detected')
      AND refund_source_channel IN ('ebay', 'amazon') THEN
      'Marketplace refund/cancel signal detected. Confirm physical return before restocking. Data is observational and may be order-level.'
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
    WHEN refund_guidance_status = 'afn_external_fulfillment_review' THEN 'manual_review'
    WHEN refund_guidance_status IN ('marketplace_refund_review', 'cancellation_detected', 'return_detected')
      AND max_restockable_qty > 0 THEN 'manual_review'
    WHEN COALESCE(refund_status, '') IN ('', 'none') OR refund_status IS NULL THEN NULL
    WHEN workflow_id IS NULL
      AND refund_guidance_status = 'full_refund_detected'
      AND max_restockable_qty > 0 THEN 'create_return_workflow'
    WHEN workflow_id IS NOT NULL
      AND workflow_status NOT IN ('closed', 'canceled', 'restocked') THEN 'return_workflow_open'
    WHEN max_restockable_qty > 0
      AND refund_guidance_status IN ('full_refund_detected', 'line_refund_confirmed')
      AND suggested_restock_qty IS NOT NULL THEN 'restock_review'
    WHEN refund_guidance_status IN ('partial_refund_detected', 'marketplace_refund_review') THEN 'manual_review'
    ELSE NULL
  END AS suggested_panel_action
FROM with_refund_status;

COMMENT ON VIEW public.v_inventory_bundle_component_return_guidance IS
  'Phase 10O: persisted + line-level marketplace refund mapping (no auto-restock).';

GRANT SELECT ON public.v_inventory_bundle_component_return_guidance TO authenticated, service_role;

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
    ELSE g.refund_guidance_status
  END AS refund_guidance_status_resolved
FROM public.v_inventory_bundle_component_return_guidance g
LEFT JOIN latest_workflow w ON w.reservation_id = g.reservation_id;

COMMENT ON VIEW public.v_inventory_bundle_component_return_workflow_guidance IS
  'Phase 10N: return guidance + RMA workflow + persisted marketplace refund overlay.';

GRANT SELECT ON public.v_inventory_bundle_component_return_workflow_guidance TO authenticated, service_role;
