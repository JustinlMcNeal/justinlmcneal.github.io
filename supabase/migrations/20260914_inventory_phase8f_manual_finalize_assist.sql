-- Phase 8F — manual finalize assist for mapped shipped marketplace lines.
-- Admin-confirmed, idempotent on-hand decrement + order_finalized ledger. No channel writes.

CREATE TABLE IF NOT EXISTS public.inventory_manual_finalize_actions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel       text NOT NULL,
  source_order_id      text NOT NULL,
  source_order_item_id text NOT NULL,
  variant_id           uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity             integer,
  ledger_id            uuid REFERENCES public.stock_ledger(id) ON DELETE SET NULL,
  reservation_id       uuid REFERENCES public.inventory_reservations(id) ON DELETE SET NULL,
  stock_before         integer,
  stock_after          integer,
  status               text NOT NULL DEFAULT 'success'
                       CHECK (status IN ('success', 'failed', 'idempotent')),
  note                 text,
  error_message        text,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_manual_finalize_actions IS
  'Audit log for admin manual finalize of shipped order lines (Phase 8F).';

CREATE INDEX IF NOT EXISTS idx_inv_manual_finalize_created
  ON public.inventory_manual_finalize_actions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inv_manual_finalize_order
  ON public.inventory_manual_finalize_actions (source_order_id, source_order_item_id);

ALTER TABLE public.inventory_manual_finalize_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_manual_finalize_actions_service_role_all
  ON public.inventory_manual_finalize_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_manual_finalize_actions_authenticated_select
  ON public.inventory_manual_finalize_actions FOR SELECT TO authenticated USING (true);

CREATE POLICY inventory_manual_finalize_actions_authenticated_insert
  ON public.inventory_manual_finalize_actions FOR INSERT TO authenticated WITH CHECK (true);

-- Extend audit view with finalize eligibility flag.
CREATE OR REPLACE VIEW public.v_inventory_shipped_finalize_audit AS
WITH line_enriched AS (
  SELECT
    li.stripe_checkout_session_id AS source_order_id,
    li.stripe_line_item_id AS source_order_item_id,
    li.variant_id,
    pv.product_id,
    li.product_id AS line_product_code,
    COALESCE(p.name, li.product_name, 'Unknown') AS product_label,
    COALESCE(NULLIF(BTRIM(pv.sku), ''), NULLIF(BTRIM(li.product_id), ''), '—') AS sku,
    li.product_name AS title,
    li.quantity,
    o.refund_status,
    o.kk_order_id,
    fs.label_status AS fulfillment_status,
    fs.carrier,
    fs.service,
    CASE
      WHEN COALESCE(o.refund_status, '') = 'full' THEN 'refunded'
      WHEN COALESCE(o.refund_status, '') = 'partial' THEN 'partial_refund'
      ELSE 'paid'
    END AS payment_status,
    CASE
      WHEN COALESCE(fs.label_status, 'pending') IN ('shipped', 'delivered') THEN fs.label_status
      WHEN COALESCE(fs.label_status, 'pending') IN ('cancelled', 'voided') THEN 'canceled'
      ELSE COALESCE(fs.label_status, 'pending')
    END AS order_status,
    CASE
      WHEN o.stripe_checkout_session_id LIKE 'ebay_%' THEN 'ebay'
      WHEN o.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon'
      ELSE 'kk'
    END AS source_channel,
    CASE
      WHEN o.stripe_checkout_session_id LIKE 'amazon_%'
        AND fs.carrier = 'Amazon'
        AND COALESCE(fs.service, '') ILIKE '%Fulfilled by Amazon%'
        THEN 'afn'
      WHEN o.stripe_checkout_session_id LIKE 'amazon_%' THEN 'amazon_mfn'
      WHEN o.stripe_checkout_session_id LIKE 'ebay_%' THEN 'ebay'
      ELSE 'kk'
    END AS fulfillment_channel,
    (
      o.stripe_checkout_session_id LIKE 'amazon_%'
      AND fs.carrier = 'Amazon'
      AND COALESCE(fs.service, '') ILIKE '%Fulfilled by Amazon%'
    ) AS is_afn
  FROM public.line_items_raw li
  JOIN public.orders_raw o
    ON o.stripe_checkout_session_id = li.stripe_checkout_session_id
  LEFT JOIN public.fulfillment_shipments fs
    ON fs.stripe_checkout_session_id = li.stripe_checkout_session_id
  LEFT JOIN public.product_variants pv ON pv.id = li.variant_id
  LEFT JOIN public.products p ON p.id = pv.product_id
  WHERE COALESCE(fs.label_status, 'pending') IN ('shipped', 'delivered')
),
with_signals AS (
  SELECT
    le.*,
    ir.id AS existing_reservation_id,
    ir.status AS reservation_status,
    ir.finalize_ledger_id,
    CASE WHEN ir.status = 'finalized' THEN ir.updated_at END AS finalized_at,
    sl.id AS matching_ledger_id,
    sl.reason AS matching_ledger_reason
  FROM line_enriched le
  LEFT JOIN LATERAL (
    SELECT r.id, r.status, r.finalize_ledger_id, r.updated_at
    FROM public.inventory_reservations r
    WHERE r.order_id = le.source_order_id
      AND r.order_item_id = le.source_order_item_id
      AND COALESCE(r.is_shadow, false) = false
    ORDER BY r.created_at DESC
    LIMIT 1
  ) ir ON true
  LEFT JOIN LATERAL (
    SELECT sl2.id, sl2.reason
    FROM public.stock_ledger sl2
    WHERE le.variant_id IS NOT NULL
      AND sl2.variant_id = le.variant_id
      AND sl2.change < 0
      AND sl2.reason IN ('order', 'order_finalized')
      AND (
        sl2.reference_id = le.source_order_id
        OR sl2.reference_id = le.kk_order_id
        OR sl2.reference_id = le.source_order_item_id
      )
    ORDER BY sl2.created_at DESC
    LIMIT 1
  ) sl ON true
),
classified AS (
  SELECT
    ws.*,
    CASE
      WHEN ws.is_afn THEN 'skipped_afn'
      WHEN ws.variant_id IS NULL THEN 'missing_variant'
      WHEN COALESCE(ws.refund_status, '') = 'full' THEN 'refunded_after_ship'
      WHEN ws.order_status = 'canceled' THEN 'manual_review'
      WHEN ws.reservation_status = 'finalized' OR ws.finalize_ledger_id IS NOT NULL THEN 'accounted_for'
      WHEN ws.matching_ledger_id IS NOT NULL THEN 'accounted_for'
      WHEN ws.reservation_status = 'reserved' THEN 'missing_finalize_record'
      WHEN ws.existing_reservation_id IS NULL AND ws.matching_ledger_id IS NULL THEN 'missing_finalize_record'
      ELSE 'manual_review'
    END AS suggested_audit_status
  FROM with_signals ws
),
finalized AS (
  SELECT
    c.*,
    (
      c.variant_id IS NOT NULL
      AND NOT c.is_afn
      AND COALESCE(c.refund_status, '') <> 'full'
      AND c.order_status <> 'canceled'
      AND c.suggested_audit_status IN ('missing_finalize_record', 'missing_ledger')
    ) AS needs_audit_issue
  FROM classified c
)
SELECT
  source_channel,
  source_order_id,
  source_order_item_id,
  product_id,
  variant_id,
  product_label,
  sku,
  title,
  quantity,
  order_status,
  fulfillment_status,
  payment_status,
  refund_status,
  fulfillment_channel,
  existing_reservation_id,
  reservation_status,
  finalized_at,
  matching_ledger_id,
  matching_ledger_reason,
  suggested_audit_status,
  CASE suggested_audit_status
    WHEN 'accounted_for' THEN 'low'
    WHEN 'skipped_afn' THEN 'low'
    WHEN 'refunded_after_ship' THEN 'low'
    WHEN 'missing_finalize_record' THEN 'high'
    WHEN 'missing_ledger' THEN 'high'
    WHEN 'missing_variant' THEN 'medium'
    ELSE 'medium'
  END AS severity,
  CASE suggested_audit_status
    WHEN 'accounted_for' THEN 'Finalized reservation or matching stock ledger decrement found'
    WHEN 'skipped_afn' THEN 'Amazon AFN/FBA — external fulfillment, no local deduction expected'
    WHEN 'missing_finalize_record' THEN 'Shipped line lacks finalized reservation and ledger signal'
    WHEN 'missing_variant' THEN 'Shipped line has no variant_id — map before auditing inventory impact'
    WHEN 'refunded_after_ship' THEN 'Fully refunded after shipment — review manually'
    WHEN 'manual_review' THEN 'Ambiguous accounting — review reservation and ledger history'
    ELSE 'Review manually'
  END AS reason,
  needs_audit_issue,
  (
    needs_audit_issue
    AND quantity > 0
    AND matching_ledger_id IS NULL
    AND reservation_status IS DISTINCT FROM 'finalized'
    AND finalize_ledger_id IS NULL
  ) AS is_finalize_eligible
FROM finalized;

COMMENT ON VIEW public.v_inventory_shipped_finalize_audit IS
  'Shipped/delivered order-line inventory audit with manual finalize eligibility (Phase 8F).';

GRANT SELECT ON public.v_inventory_shipped_finalize_audit TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.manual_finalize_shipped_order_line(
  p_source_channel       text,
  p_source_order_id      text,
  p_source_order_item_id text,
  p_expected_variant_id  uuid,
  p_note                 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor            uuid := auth.uid();
  v_is_admin         boolean := false;
  v_row              public.v_inventory_shipped_finalize_audit%ROWTYPE;
  v_idempotency      text;
  v_res_idempotency  text;
  v_ledger_id        uuid;
  v_res_id           uuid;
  v_audit_id         uuid;
  v_stock_before     integer;
  v_stock_after      integer;
  v_ledger_note      text;
  v_existing_res     public.inventory_reservations%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'Admin note is required' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_variant_id IS NULL THEN
    RAISE EXCEPTION 'expected_variant_id is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM public.v_inventory_shipped_finalize_audit a
  WHERE a.source_channel = p_source_channel
    AND a.source_order_id = p_source_order_id
    AND a.source_order_item_id = p_source_order_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order line not found in shipped finalize audit' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_row.is_finalize_eligible THEN
    RAISE EXCEPTION 'Line not eligible for manual finalize: %', v_row.reason USING ERRCODE = 'P0001';
  END IF;

  IF v_row.variant_id IS DISTINCT FROM p_expected_variant_id THEN
    RAISE EXCEPTION 'Variant mismatch' USING ERRCODE = 'P0001';
  END IF;

  v_idempotency := format(
    'manual_finalize:%s:%s:%s',
    p_source_channel,
    p_source_order_id,
    p_source_order_item_id
  );
  v_res_idempotency := format(
    'manual_finalize_res:%s:%s:%s',
    p_source_channel,
    p_source_order_id,
    p_source_order_item_id
  );

  SELECT sl.id INTO v_ledger_id
  FROM public.stock_ledger sl
  WHERE sl.idempotency_key = v_idempotency
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    SELECT ir.id INTO v_res_id
    FROM public.inventory_reservations ir
    WHERE ir.idempotency_key = v_res_idempotency
       OR (ir.order_id = p_source_order_id AND ir.order_item_id = p_source_order_item_id AND ir.status = 'finalized')
    LIMIT 1;

    INSERT INTO public.inventory_manual_finalize_actions (
      source_channel, source_order_id, source_order_item_id,
      variant_id, quantity, ledger_id, reservation_id,
      stock_before, stock_after, status, note, created_by
    ) VALUES (
      p_source_channel, p_source_order_id, p_source_order_item_id,
      v_row.variant_id, v_row.quantity, v_ledger_id, v_res_id,
      NULL, NULL, 'idempotent', p_note, v_actor
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'ledger_id', v_ledger_id,
      'reservation_id', v_res_id,
      'audit_id', v_audit_id,
      'audit_status', 'accounted_for',
      'message', 'Manual finalize already applied'
    );
  END IF;

  SELECT COALESCE(pv.stock, 0) INTO v_stock_before
  FROM public.product_variants pv
  WHERE pv.id = v_row.variant_id
  FOR UPDATE;

  v_stock_after := v_stock_before - v_row.quantity;
  v_ledger_note := format(
    'Manual finalize assist (admin confirmed). %s',
    btrim(p_note)
  );

  UPDATE public.product_variants
  SET stock = v_stock_after
  WHERE id = v_row.variant_id;

  INSERT INTO public.stock_ledger (
    variant_id,
    product_id,
    change,
    reason,
    reference_id,
    stock_before,
    stock_after,
    note,
    source,
    reference_type,
    idempotency_key,
    created_by
  ) VALUES (
    v_row.variant_id,
    v_row.product_id,
    -v_row.quantity,
    'order_finalized',
    p_source_order_id,
    v_stock_before,
    v_stock_after,
    v_ledger_note,
    'manual_finalize_assist',
    'manual_shipped_order_line',
    v_idempotency,
    v_actor
  )
  RETURNING id INTO v_ledger_id;

  IF v_row.existing_reservation_id IS NOT NULL THEN
    SELECT * INTO v_existing_res
    FROM public.inventory_reservations ir
    WHERE ir.id = v_row.existing_reservation_id
    FOR UPDATE;

    IF v_existing_res.status = 'reserved' THEN
      UPDATE public.inventory_reservations
      SET
        status = 'finalized',
        finalize_ledger_id = v_ledger_id,
        updated_at = now(),
        notes = COALESCE(notes, '') || ' · Manual finalize assist (Phase 8F)'
      WHERE id = v_existing_res.id;
      v_res_id := v_existing_res.id;
    ELSIF v_existing_res.status = 'finalized' THEN
      v_res_id := v_existing_res.id;
    END IF;
  END IF;

  IF v_res_id IS NULL THEN
    INSERT INTO public.inventory_reservations (
      channel,
      order_id,
      order_item_id,
      variant_id,
      product_id,
      quantity,
      status,
      is_shadow,
      finalize_ledger_id,
      idempotency_key,
      source_reference,
      notes
    ) VALUES (
      p_source_channel,
      p_source_order_id,
      p_source_order_item_id,
      v_row.variant_id,
      v_row.product_id,
      v_row.quantity,
      'finalized',
      false,
      v_ledger_id,
      v_res_idempotency,
      'manual_finalize_assist_8f',
      v_ledger_note
    )
    RETURNING id INTO v_res_id;
  END IF;

  INSERT INTO public.inventory_manual_finalize_actions (
    source_channel, source_order_id, source_order_item_id,
    variant_id, quantity, ledger_id, reservation_id,
    stock_before, stock_after, status, note, created_by
  ) VALUES (
    p_source_channel, p_source_order_id, p_source_order_item_id,
    v_row.variant_id, v_row.quantity, v_ledger_id, v_res_id,
    v_stock_before, v_stock_after, 'success', p_note, v_actor
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'ledger_id', v_ledger_id,
    'reservation_id', v_res_id,
    'audit_id', v_audit_id,
    'variant_id', v_row.variant_id,
    'quantity', v_row.quantity,
    'stock_before', v_stock_before,
    'stock_after', v_stock_after,
    'audit_status', 'accounted_for',
    'channel', p_source_channel
  );
END;
$$;

COMMENT ON FUNCTION public.manual_finalize_shipped_order_line IS
  'Admin-only: manually finalize a shipped mapped order line — decrement on-hand once, write order_finalized ledger. Idempotent.';

GRANT EXECUTE ON FUNCTION public.manual_finalize_shipped_order_line TO authenticated;
