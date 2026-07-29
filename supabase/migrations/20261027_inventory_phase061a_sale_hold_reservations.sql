-- Phase 061A — Sale-triggered KK inventory hold (reservation-first, no channel push).

CREATE TABLE IF NOT EXISTS public.inventory_sale_hold_actions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel              text NOT NULL,
  external_order_id    text NOT NULL,
  external_line_id     text NOT NULL,
  variant_id           uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_id           uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity             integer,
  reservation_id       uuid REFERENCES public.inventory_reservations(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'skipped'
                       CHECK (status IN ('success', 'skipped', 'failed')),
  skipped_reason       text,
  error_message        text,
  idempotency_key      text,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_sale_hold_actions IS
  'Audit log for automatic marketplace sale inventory holds (Phase 061A). No channel API calls.';

CREATE INDEX IF NOT EXISTS idx_inv_sale_hold_actions_created
  ON public.inventory_sale_hold_actions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inv_sale_hold_actions_order_line
  ON public.inventory_sale_hold_actions (external_order_id, external_line_id);

CREATE INDEX IF NOT EXISTS idx_inv_sale_hold_actions_idempotency
  ON public.inventory_sale_hold_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.inventory_sale_hold_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_sale_hold_actions_service_role_all
  ON public.inventory_sale_hold_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_sale_hold_actions_authenticated_select
  ON public.inventory_sale_hold_actions FOR SELECT TO authenticated USING (true);

GRANT ALL ON public.inventory_sale_hold_actions TO service_role;
GRANT SELECT ON public.inventory_sale_hold_actions TO authenticated;

CREATE OR REPLACE FUNCTION public.reserve_inventory_for_marketplace_sale(
  p_channel              text,
  p_external_order_id    text,
  p_external_line_id     text,
  p_variant_id           uuid,
  p_quantity             integer,
  p_idempotency_key      text,
  p_product_id           uuid DEFAULT NULL,
  p_metadata             jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel            text := lower(BTRIM(COALESCE(p_channel, '')));
  v_order_id           text := BTRIM(COALESCE(p_external_order_id, ''));
  v_line_id            text := BTRIM(COALESCE(p_external_line_id, ''));
  v_idempotency        text := NULLIF(BTRIM(COALESCE(p_idempotency_key, '')), '');
  v_variant            public.product_variants%ROWTYPE;
  v_product_id         uuid;
  v_refund_status      text;
  v_label_status       text;
  v_carrier            text;
  v_service            text;
  v_is_afn             boolean := false;
  v_existing_res_id    uuid;
  v_res_id             uuid;
  v_audit_id           uuid;
  v_skipped            text;
BEGIN
  IF v_channel NOT IN ('ebay', 'amazon', 'kk') THEN
    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', 'invalid_channel',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency
    );
  END IF;

  IF v_order_id = '' OR v_line_id = '' THEN
    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', 'invalid_order_ref',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency
    );
  END IF;

  IF p_variant_id IS NULL THEN
    INSERT INTO public.inventory_sale_hold_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      NULL, p_product_id, p_quantity, NULL,
      'skipped', 'unmapped_line', v_idempotency, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', 'unmapped_line',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  IF COALESCE(p_quantity, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', 'invalid_qty',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency
    );
  END IF;

  SELECT * INTO v_variant
  FROM public.product_variants pv
  WHERE pv.id = p_variant_id
    AND COALESCE(pv.is_active, true);

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', 'invalid_variant',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency
    );
  END IF;

  v_product_id := COALESCE(p_product_id, v_variant.product_id);

  IF v_idempotency IS NULL THEN
    v_idempotency := format(
      'sale:%s:%s:%s:reserve',
      v_channel,
      v_order_id,
      v_line_id
    );
  END IF;

  SELECT ir.id INTO v_existing_res_id
  FROM public.inventory_reservations ir
  WHERE ir.idempotency_key = v_idempotency
    AND ir.status IN ('reserved', 'finalized')
  LIMIT 1;

  IF v_existing_res_id IS NOT NULL THEN
    INSERT INTO public.inventory_sale_hold_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      p_variant_id, v_product_id, p_quantity, v_existing_res_id,
      'skipped', 'already_reserved', v_idempotency, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', 'already_reserved',
      'reservation_id', v_existing_res_id,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  SELECT ir.id INTO v_existing_res_id
  FROM public.inventory_reservations ir
  WHERE ir.order_id = v_order_id
    AND ir.order_item_id = v_line_id
    AND ir.status IN ('reserved', 'finalized')
    AND COALESCE(ir.is_shadow, false) = false
  LIMIT 1;

  IF v_existing_res_id IS NOT NULL THEN
    INSERT INTO public.inventory_sale_hold_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      p_variant_id, v_product_id, p_quantity, v_existing_res_id,
      'skipped', 'already_reserved', v_idempotency, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', 'already_reserved',
      'reservation_id', v_existing_res_id,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  SELECT
    o.refund_status,
    COALESCE(fs.label_status, 'pending'),
    fs.carrier,
    fs.service
  INTO v_refund_status, v_label_status, v_carrier, v_service
  FROM public.orders_raw o
  LEFT JOIN public.fulfillment_shipments fs
    ON fs.stripe_checkout_session_id = o.stripe_checkout_session_id
  WHERE o.stripe_checkout_session_id = v_order_id;

  IF NOT FOUND THEN
    v_refund_status := NULL;
    v_label_status := 'pending';
  END IF;

  v_is_afn := (
    v_channel = 'amazon'
    AND COALESCE(v_carrier, '') = 'Amazon'
    AND COALESCE(v_service, '') ILIKE '%Fulfilled by Amazon%'
  );

  IF v_is_afn THEN
    INSERT INTO public.inventory_sale_hold_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      p_variant_id, v_product_id, p_quantity, NULL,
      'skipped', 'afn_skip', v_idempotency, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', 'afn_skip',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  IF COALESCE(v_refund_status, '') = 'full' THEN
    v_skipped := 'canceled_or_refunded';
  ELSIF v_label_status IN ('cancelled', 'voided', 'canceled') THEN
    v_skipped := 'canceled_or_refunded';
  ELSIF v_label_status IN ('shipped', 'delivered') THEN
    v_skipped := 'already_shipped';
  ELSE
    v_skipped := NULL;
  END IF;

  IF v_skipped IS NOT NULL THEN
    INSERT INTO public.inventory_sale_hold_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      p_variant_id, v_product_id, p_quantity, NULL,
      'skipped', v_skipped, v_idempotency, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', v_skipped,
      'reservation_id', NULL,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  BEGIN
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
      v_channel,
      v_order_id,
      v_line_id,
      p_variant_id,
      v_product_id,
      p_quantity,
      'reserved',
      false,
      v_idempotency,
      'sale_hold_061a',
      format('Automatic sale hold (%s)', v_channel)
    )
    RETURNING id INTO v_res_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT ir.id INTO v_res_id
      FROM public.inventory_reservations ir
      WHERE ir.idempotency_key = v_idempotency
      LIMIT 1;

      INSERT INTO public.inventory_sale_hold_actions (
        channel, external_order_id, external_line_id,
        variant_id, product_id, quantity, reservation_id,
        status, skipped_reason, idempotency_key, metadata
      ) VALUES (
        v_channel, v_order_id, v_line_id,
        p_variant_id, v_product_id, p_quantity, v_res_id,
        'skipped', 'already_reserved', v_idempotency, p_metadata
      )
      RETURNING id INTO v_audit_id;

      RETURN jsonb_build_object(
        'reserved', false,
        'skipped_reason', 'already_reserved',
        'reservation_id', v_res_id,
        'idempotency_key', v_idempotency,
        'audit_id', v_audit_id
      );
  END;

  INSERT INTO public.inventory_sale_hold_actions (
    channel, external_order_id, external_line_id,
    variant_id, product_id, quantity, reservation_id,
    status, skipped_reason, idempotency_key, metadata
  ) VALUES (
    v_channel, v_order_id, v_line_id,
    p_variant_id, v_product_id, p_quantity, v_res_id,
    'success', NULL, v_idempotency, p_metadata
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'reserved', true,
    'skipped_reason', NULL,
    'reservation_id', v_res_id,
    'idempotency_key', v_idempotency,
    'audit_id', v_audit_id,
    'variant_id', p_variant_id,
    'quantity', p_quantity,
    'channel', v_channel
  );
EXCEPTION
  WHEN OTHERS THEN
    INSERT INTO public.inventory_sale_hold_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, error_message, idempotency_key, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      p_variant_id, v_product_id, p_quantity, NULL,
      'failed', 'sale_hold_failed', SQLERRM, v_idempotency, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'reserved', false,
      'skipped_reason', 'sale_hold_failed',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id,
      'error', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.reserve_inventory_for_marketplace_sale IS
  'Phase 061A: idempotent active reservation for mapped marketplace sale lines. No on-hand decrement, no channel APIs.';

GRANT EXECUTE ON FUNCTION public.reserve_inventory_for_marketplace_sale TO service_role;
