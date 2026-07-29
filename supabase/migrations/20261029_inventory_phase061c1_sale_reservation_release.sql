-- Phase 061C.1 — Release active sale reservations on cancel/refund before ship (no on-hand change, no channel push).

CREATE TABLE IF NOT EXISTS public.inventory_sale_release_actions (
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
  reason               text,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_sale_release_actions IS
  'Audit log for automatic marketplace sale reservation releases (Phase 061C.1). No channel API calls.';

CREATE INDEX IF NOT EXISTS idx_inv_sale_release_actions_created
  ON public.inventory_sale_release_actions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inv_sale_release_actions_order_line
  ON public.inventory_sale_release_actions (external_order_id, external_line_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_sale_release_actions_idempotency
  ON public.inventory_sale_release_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.inventory_sale_release_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_sale_release_actions_service_role_all
  ON public.inventory_sale_release_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_sale_release_actions_authenticated_select
  ON public.inventory_sale_release_actions FOR SELECT TO authenticated USING (true);

GRANT ALL ON public.inventory_sale_release_actions TO service_role;
GRANT SELECT ON public.inventory_sale_release_actions TO authenticated;

CREATE OR REPLACE FUNCTION public.release_marketplace_sale_reservation(
  p_channel              text,
  p_external_order_id    text,
  p_external_line_id     text,
  p_idempotency_key      text DEFAULT NULL,
  p_reservation_id       uuid DEFAULT NULL,
  p_reason               text DEFAULT NULL,
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
  v_res                public.inventory_reservations%ROWTYPE;
  v_res_id             uuid;
  v_label_status       text;
  v_carrier            text;
  v_service            text;
  v_is_afn             boolean := false;
  v_audit_id           uuid;
  v_prior_audit        uuid;
  v_rows               integer;
BEGIN
  IF v_channel NOT IN ('ebay', 'amazon', 'kk') THEN
    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'invalid_channel',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency
    );
  END IF;

  IF v_order_id = '' OR v_line_id = '' THEN
    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'invalid_order_ref',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency
    );
  END IF;

  IF v_idempotency IS NULL THEN
    v_idempotency := format(
      'sale:%s:%s:%s:release',
      v_channel,
      v_order_id,
      v_line_id
    );
  END IF;

  SELECT id INTO v_prior_audit
  FROM public.inventory_sale_release_actions
  WHERE idempotency_key = v_idempotency
    AND status = 'success'
  LIMIT 1;

  IF v_prior_audit IS NOT NULL THEN
    SELECT ir.id INTO v_res_id
    FROM public.inventory_reservations ir
    WHERE ir.idempotency_key IN (
      format('sale:%s:%s:%s:reserve', v_channel, v_order_id, v_line_id),
      format('kk:%s:%s:reserve', v_order_id, v_line_id)
    )
    OR (ir.order_id = v_order_id AND ir.order_item_id = v_line_id AND ir.channel = v_channel)
    ORDER BY ir.created_at DESC NULLS LAST
    LIMIT 1;

    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'already_released',
      'reservation_id', v_res_id,
      'idempotency_key', v_idempotency,
      'audit_id', v_prior_audit
    );
  END IF;

  IF p_reservation_id IS NOT NULL THEN
    SELECT * INTO v_res
    FROM public.inventory_reservations ir
    WHERE ir.id = p_reservation_id
      AND COALESCE(ir.is_shadow, false) = false
    FOR UPDATE;
  ELSE
    SELECT * INTO v_res
    FROM public.inventory_reservations ir
    WHERE COALESCE(ir.is_shadow, false) = false
      AND ir.channel = v_channel
      AND ir.order_id = v_order_id
      AND ir.order_item_id = v_line_id
    ORDER BY
      CASE ir.status
        WHEN 'reserved' THEN 0
        WHEN 'released' THEN 1
        WHEN 'finalized' THEN 2
        ELSE 3
      END,
      ir.created_at DESC NULLS LAST
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.inventory_sale_release_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, reason, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      NULL, NULL, NULL, NULL,
      'skipped', 'no_active_reservation', v_idempotency, p_reason, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'no_active_reservation',
      'reservation_id', NULL,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  IF v_res.status = 'finalized' THEN
    INSERT INTO public.inventory_sale_release_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, reason, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      v_res.variant_id, v_res.product_id, v_res.quantity, v_res.id,
      'skipped', 'already_finalized', v_idempotency, p_reason, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'already_finalized',
      'reservation_id', v_res.id,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  IF v_res.status IN ('released', 'canceled') THEN
    INSERT INTO public.inventory_sale_release_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, reason, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      v_res.variant_id, v_res.product_id, v_res.quantity, v_res.id,
      'skipped', 'already_released', v_idempotency, p_reason, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'already_released',
      'reservation_id', v_res.id,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  SELECT
    COALESCE(fs.label_status, 'pending'),
    fs.carrier,
    fs.service
  INTO v_label_status, v_carrier, v_service
  FROM public.fulfillment_shipments fs
  WHERE fs.stripe_checkout_session_id = v_order_id;

  IF NOT FOUND THEN
    v_label_status := 'pending';
  END IF;

  IF v_label_status IN ('shipped', 'delivered') THEN
    INSERT INTO public.inventory_sale_release_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, reason, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      v_res.variant_id, v_res.product_id, v_res.quantity, v_res.id,
      'skipped', 'already_finalized', v_idempotency, p_reason, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'already_finalized',
      'reservation_id', v_res.id,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  v_is_afn := (
    v_channel = 'amazon'
    AND COALESCE(v_carrier, '') = 'Amazon'
    AND COALESCE(v_service, '') ILIKE '%Fulfilled by Amazon%'
  );

  IF v_is_afn THEN
    INSERT INTO public.inventory_sale_release_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, reason, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      v_res.variant_id, v_res.product_id, v_res.quantity, v_res.id,
      'skipped', 'afn_skip', v_idempotency, p_reason, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'afn_skip',
      'reservation_id', v_res.id,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  IF v_res.status <> 'reserved' THEN
    INSERT INTO public.inventory_sale_release_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, reason, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      v_res.variant_id, v_res.product_id, v_res.quantity, v_res.id,
      'skipped', 'no_active_reservation', v_idempotency, p_reason, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'no_active_reservation',
      'reservation_id', v_res.id,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id
    );
  END IF;

  BEGIN
    UPDATE public.inventory_reservations
    SET
      status = 'released',
      notes = COALESCE(
        NULLIF(BTRIM(p_reason), ''),
        format('Sale reservation released (%s)', v_channel)
      )
    WHERE id = v_res.id
      AND status = 'reserved';

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows = 0 THEN
      INSERT INTO public.inventory_sale_release_actions (
        channel, external_order_id, external_line_id,
        variant_id, product_id, quantity, reservation_id,
        status, skipped_reason, idempotency_key, reason, metadata
      ) VALUES (
        v_channel, v_order_id, v_line_id,
        v_res.variant_id, v_res.product_id, v_res.quantity, v_res.id,
        'skipped', 'already_released', v_idempotency, p_reason, p_metadata
      )
      RETURNING id INTO v_audit_id;

      RETURN jsonb_build_object(
        'released', false,
        'skipped_reason', 'already_released',
        'reservation_id', v_res.id,
        'idempotency_key', v_idempotency,
        'audit_id', v_audit_id
      );
    END IF;

    INSERT INTO public.inventory_sale_release_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, idempotency_key, reason, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      v_res.variant_id, v_res.product_id, v_res.quantity, v_res.id,
      'success', NULL, v_idempotency, p_reason, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'released', true,
      'skipped_reason', NULL,
      'reservation_id', v_res.id,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id,
      'variant_id', v_res.variant_id,
      'quantity', v_res.quantity,
      'channel', v_channel
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_prior_audit
      FROM public.inventory_sale_release_actions
      WHERE idempotency_key = v_idempotency
        AND status = 'success'
      LIMIT 1;

      RETURN jsonb_build_object(
        'released', false,
        'skipped_reason', 'already_released',
        'reservation_id', v_res.id,
        'idempotency_key', v_idempotency,
        'audit_id', v_prior_audit
      );
  END;
EXCEPTION
  WHEN OTHERS THEN
    INSERT INTO public.inventory_sale_release_actions (
      channel, external_order_id, external_line_id,
      variant_id, product_id, quantity, reservation_id,
      status, skipped_reason, error_message, idempotency_key, reason, metadata
    ) VALUES (
      v_channel, v_order_id, v_line_id,
      v_res.variant_id, v_res.product_id, v_res.quantity, v_res.id,
      'failed', 'sale_release_failed', SQLERRM, v_idempotency, p_reason, p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN jsonb_build_object(
      'released', false,
      'skipped_reason', 'sale_release_failed',
      'reservation_id', v_res.id,
      'idempotency_key', v_idempotency,
      'audit_id', v_audit_id,
      'error', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.release_marketplace_sale_reservation IS
  'Phase 061C.1: idempotent release of active unfinalized sale reservations. No on-hand increment, no channel APIs.';

GRANT EXECUTE ON FUNCTION public.release_marketplace_sale_reservation TO service_role;
