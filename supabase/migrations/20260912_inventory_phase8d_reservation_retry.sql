-- Phase 8D — reservation retry candidates view, audit log, admin RPC.
-- Creates reservations only (no on-hand decrement, no channel API writes).

CREATE TABLE IF NOT EXISTS public.inventory_reservation_retry_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel      text NOT NULL,
  source_order_id     text NOT NULL,
  source_order_item_id text NOT NULL,
  variant_id          uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity            integer,
  reservation_id      uuid REFERENCES public.inventory_reservations(id) ON DELETE SET NULL,
  action              text NOT NULL DEFAULT 'create_reservation',
  status              text NOT NULL DEFAULT 'success'
                      CHECK (status IN ('success', 'failed', 'skipped')),
  error_message       text,
  note                text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_reservation_retry_actions IS
  'Audit log for admin reservation retry after order-line mapping (Phase 8D).';

CREATE INDEX IF NOT EXISTS idx_inv_res_retry_actions_created
  ON public.inventory_reservation_retry_actions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inv_res_retry_actions_order
  ON public.inventory_reservation_retry_actions (source_order_id, source_order_item_id);

ALTER TABLE public.inventory_reservation_retry_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_reservation_retry_actions_service_role_all
  ON public.inventory_reservation_retry_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_reservation_retry_actions_authenticated_select
  ON public.inventory_reservation_retry_actions FOR SELECT TO authenticated USING (true);

CREATE POLICY inventory_reservation_retry_actions_authenticated_insert
  ON public.inventory_reservation_retry_actions FOR INSERT TO authenticated WITH CHECK (true);

GRANT ALL ON public.inventory_reservation_retry_actions TO service_role;
GRANT SELECT, INSERT ON public.inventory_reservation_retry_actions TO authenticated;

CREATE OR REPLACE VIEW public.v_inventory_reservation_retry_candidates AS
WITH line_enriched AS (
  SELECT
    li.stripe_checkout_session_id AS source_order_id,
    li.stripe_line_item_id AS source_order_item_id,
    li.variant_id,
    pv.product_id,
    COALESCE(p.name, li.product_name, 'Unknown') AS product_label,
    COALESCE(NULLIF(BTRIM(pv.sku), ''), NULLIF(BTRIM(li.product_id), ''), '—') AS sku,
    li.product_name AS title,
    li.quantity,
    o.refund_status,
    fs.label_status AS fulfillment_status,
    CASE
      WHEN COALESCE(o.refund_status, '') = 'full' THEN 'refunded'
      WHEN COALESCE(o.refund_status, '') = 'partial' THEN 'partial_refund'
      ELSE 'paid'
    END AS payment_status,
    CASE
      WHEN COALESCE(fs.label_status, 'pending') IN ('shipped', 'delivered') THEN 'shipped'
      WHEN COALESCE(fs.label_status, 'pending') IN ('cancelled', 'voided') THEN 'canceled'
      ELSE COALESCE(fs.label_status, 'pending')
    END AS order_status,
    CASE
      WHEN o.stripe_checkout_session_id LIKE 'ebay_%' THEN 'ebay'
      WHEN o.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
      ELSE 'kk'
    END AS source_channel,
    (
      o.stripe_checkout_session_id LIKE 'amazon_%'
      AND fs.carrier = 'Amazon'
      AND COALESCE(fs.service, '') ILIKE '%Fulfilled by Amazon%'
    ) AS is_afn,
    (
      SELECT a.action_type || ':' || a.id::text
      FROM public.inventory_mapping_assist_actions a
      WHERE a.status = 'success'
        AND a.action_type = 'order_line_variant'
        AND a.source_reference = li.stripe_checkout_session_id || ':' || li.stripe_line_item_id
      ORDER BY a.created_at DESC
      LIMIT 1
    ) AS mapping_source,
    (
      SELECT ir.id
      FROM public.inventory_reservations ir
      WHERE ir.order_id = li.stripe_checkout_session_id
        AND ir.order_item_id = li.stripe_line_item_id
        AND ir.status IN ('reserved', 'finalized')
        AND COALESCE(ir.is_shadow, false) = false
      LIMIT 1
    ) AS existing_reservation_id
  FROM public.line_items_raw li
  JOIN public.orders_raw o
    ON o.stripe_checkout_session_id = li.stripe_checkout_session_id
  LEFT JOIN public.fulfillment_shipments fs
    ON fs.stripe_checkout_session_id = li.stripe_checkout_session_id
  JOIN public.product_variants pv ON pv.id = li.variant_id
  JOIN public.products p ON p.id = pv.product_id
  WHERE li.variant_id IS NOT NULL
    AND COALESCE(li.quantity, 0) > 0
    AND COALESCE(pv.is_active, true)
),
classified AS (
  SELECT
    le.*,
    CASE
      WHEN le.is_afn THEN 'skip_afn'
      WHEN COALESCE(le.refund_status, '') = 'full' THEN 'skip_refunded'
      WHEN le.order_status = 'canceled' THEN 'skip_canceled'
      WHEN le.order_status = 'shipped' THEN 'skip_shipped'
      WHEN le.existing_reservation_id IS NOT NULL THEN 'already_reserved'
      WHEN COALESCE(le.refund_status, '') = 'partial' THEN 'manual_review'
      ELSE 'create_reservation'
    END AS suggested_action
  FROM line_enriched le
)
SELECT
  source_channel,
  source_order_id,
  source_order_item_id,
  variant_id,
  product_id,
  product_label,
  sku,
  title,
  quantity,
  order_status,
  fulfillment_status,
  payment_status,
  refund_status,
  mapping_source,
  existing_reservation_id,
  suggested_action,
  CASE suggested_action
    WHEN 'create_reservation' THEN 'Eligible — paid/unshipped line with variant mapping'
    WHEN 'already_reserved' THEN 'Active reservation already exists'
    WHEN 'skip_shipped' THEN 'Order already shipped — use finalize audit flow later'
    WHEN 'skip_refunded' THEN 'Order fully refunded'
    WHEN 'skip_canceled' THEN 'Order/fulfillment canceled'
    WHEN 'skip_afn' THEN 'Amazon AFN/FBA — no local reservation'
    WHEN 'manual_review' THEN 'Partial refund — manual review required'
    ELSE 'Not eligible'
  END AS reason,
  (suggested_action = 'create_reservation') AS is_eligible
FROM classified;

COMMENT ON VIEW public.v_inventory_reservation_retry_candidates IS
  'Mapped order lines eligible for admin reservation retry (Phase 8D). Read-only.';

GRANT SELECT ON public.v_inventory_reservation_retry_candidates TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.retry_inventory_reservation_for_order_line(
  p_source_channel      text,
  p_source_order_id     text,
  p_source_order_item_id text,
  p_expected_variant_id uuid DEFAULT NULL,
  p_note                text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor           uuid := auth.uid();
  v_is_admin        boolean := false;
  v_candidate       public.v_inventory_reservation_retry_candidates%ROWTYPE;
  v_idempotency     text;
  v_res_id          uuid;
  v_audit_id        uuid;
  v_now             timestamptz := now();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_candidate
  FROM public.v_inventory_reservation_retry_candidates c
  WHERE c.source_channel = p_source_channel
    AND c.source_order_id = p_source_order_id
    AND c.source_order_item_id = p_source_order_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order line not found in retry candidates' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_candidate.is_eligible OR v_candidate.suggested_action <> 'create_reservation' THEN
    RAISE EXCEPTION 'Line not eligible: %', v_candidate.reason USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_variant_id IS NOT NULL AND p_expected_variant_id <> v_candidate.variant_id THEN
    RAISE EXCEPTION 'Variant mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF v_candidate.existing_reservation_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'reservation_id', v_candidate.existing_reservation_id,
      'message', 'Reservation already exists'
    );
  END IF;

  v_idempotency := format(
    'retry_reserve:%s:%s:%s',
    p_source_channel,
    p_source_order_id,
    p_source_order_item_id
  );

  IF EXISTS (
    SELECT 1 FROM public.inventory_reservations ir
    WHERE ir.idempotency_key = v_idempotency
      AND ir.status IN ('reserved', 'finalized')
  ) THEN
    SELECT ir.id INTO v_res_id
    FROM public.inventory_reservations ir
    WHERE ir.idempotency_key = v_idempotency
    LIMIT 1;

    INSERT INTO public.inventory_reservation_retry_actions (
      source_channel, source_order_id, source_order_item_id,
      variant_id, quantity, reservation_id, action, status, note, created_by
    ) VALUES (
      p_source_channel, p_source_order_id, p_source_order_item_id,
      v_candidate.variant_id, v_candidate.quantity, v_res_id,
      'create_reservation', 'skipped', COALESCE(p_note, 'Idempotent — reservation already exists'), v_actor
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'reservation_id', v_res_id,
      'audit_id', v_audit_id
    );
  END IF;

  INSERT INTO public.inventory_reservations (
    channel,
    order_id,
    order_item_id,
    variant_id,
    product_id,
    quantity,
    status,
    is_shadow,
    idempotency_key,
    source_reference,
    notes
  ) VALUES (
    p_source_channel,
    p_source_order_id,
    p_source_order_item_id,
    v_candidate.variant_id,
    v_candidate.product_id,
    v_candidate.quantity,
    'reserved',
    false,
    v_idempotency,
    'reservation_retry_8d',
    COALESCE(p_note, 'Admin reservation retry after mapping assist')
  )
  RETURNING id INTO v_res_id;

  INSERT INTO public.inventory_reservation_retry_actions (
    source_channel, source_order_id, source_order_item_id,
    variant_id, quantity, reservation_id, action, status, note, created_by
  ) VALUES (
    p_source_channel, p_source_order_id, p_source_order_item_id,
    v_candidate.variant_id, v_candidate.quantity, v_res_id,
    'create_reservation', 'success', p_note, v_actor
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'reservation_id', v_res_id,
    'audit_id', v_audit_id,
    'variant_id', v_candidate.variant_id,
    'quantity', v_candidate.quantity,
    'channel', p_source_channel
  );
END;
$$;

COMMENT ON FUNCTION public.retry_inventory_reservation_for_order_line IS
  'Admin-only: create reserved row for eligible mapped order line. No on-hand decrement.';

GRANT EXECUTE ON FUNCTION public.retry_inventory_reservation_for_order_line TO authenticated;
