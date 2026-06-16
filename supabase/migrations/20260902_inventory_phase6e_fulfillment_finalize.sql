-- 20260902_inventory_phase6e_fulfillment_finalize.sql
--
-- Phase 6E — finalize KK reservations on shipment; decrement on-hand once.

-- ════════════════════════════════════════════════════════════════
-- finalize_kk_order_reservations — idempotent shipment finalization
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.finalize_kk_order_reservations(
  p_order_id         text,
  p_reference_id     text DEFAULT NULL,
  p_source           text DEFAULT 'fulfillment',
  p_reservation_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin              boolean := false;
  v_ref                   text;
  v_res                   record;
  v_finalized_count       integer := 0;
  v_finalized_units       integer := 0;
  v_skipped               integer := 0;
  v_missing               integer := 0;
  v_variant_ids           uuid[] := ARRAY[]::uuid[];
  v_idempotency_key       text;
  v_existing_ledger       uuid;
  v_stock_before          integer;
  v_stock_after           integer;
  v_ledger_id             uuid;
  v_found                 boolean := false;
BEGIN
  IF p_order_id IS NULL OR btrim(p_order_id) = '' THEN
    RAISE EXCEPTION 'p_order_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_order_id LIKE 'ebay%' OR p_order_id LIKE 'amazon%' THEN
    RETURN jsonb_build_object(
      'finalized_count', 0,
      'finalized_units', 0,
      'skipped_already_finalized', 0,
      'missing_reservations', 0,
      'affected_variants', '[]'::jsonb,
      'note', 'Non-KK order session — skipped'
    );
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Admin only'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_ref := COALESCE(NULLIF(btrim(p_reference_id), ''), p_order_id);

  FOR v_res IN
    SELECT ir.*
    FROM public.inventory_reservations ir
    WHERE ir.channel = 'kk'
      AND ir.order_id = p_order_id
      AND COALESCE(ir.is_shadow, false) = false
      AND (p_reservation_id IS NULL OR ir.id = p_reservation_id)
    ORDER BY ir.created_at, ir.id
    FOR UPDATE
  LOOP
    v_found := true;

    IF v_res.status = 'finalized' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_res.status <> 'reserved' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_res.variant_id IS NULL OR v_res.quantity IS NULL OR v_res.quantity <= 0 THEN
      v_missing := v_missing + 1;
      CONTINUE;
    END IF;

    v_idempotency_key := format(
      'finalize:kk:%s:%s:%s',
      v_res.order_id,
      COALESCE(v_res.order_item_id, v_res.id::text),
      v_ref
    );

    SELECT sl.id INTO v_existing_ledger
    FROM public.stock_ledger sl
    WHERE sl.idempotency_key = v_idempotency_key
    LIMIT 1;

    IF v_existing_ledger IS NOT NULL THEN
      UPDATE public.inventory_reservations
      SET
        status = 'finalized',
        finalize_ledger_id = COALESCE(finalize_ledger_id, v_existing_ledger),
        updated_at = now()
      WHERE id = v_res.id
        AND status = 'reserved';

      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(pv.stock, 0) INTO v_stock_before
    FROM public.product_variants pv
    WHERE pv.id = v_res.variant_id
    FOR UPDATE;

    v_stock_after := v_stock_before - v_res.quantity;

    UPDATE public.product_variants
    SET stock = v_stock_after
    WHERE id = v_res.variant_id;

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
      idempotency_key
    ) VALUES (
      v_res.variant_id,
      v_res.product_id,
      -v_res.quantity,
      'order_finalized',
      v_ref,
      v_stock_before,
      v_stock_after,
      'Reservation finalized on shipment; on-hand decremented',
      COALESCE(NULLIF(btrim(p_source), ''), 'fulfillment'),
      'kk_order_fulfillment',
      v_idempotency_key
    )
    RETURNING id INTO v_ledger_id;

    UPDATE public.inventory_reservations
    SET
      status = 'finalized',
      finalize_ledger_id = v_ledger_id,
      updated_at = now()
    WHERE id = v_res.id;

    v_finalized_count := v_finalized_count + 1;
    v_finalized_units := v_finalized_units + v_res.quantity;
    v_variant_ids := array_append(v_variant_ids, v_res.variant_id);
  END LOOP;

  IF NOT v_found THEN
    v_missing := 1;
  END IF;

  RETURN jsonb_build_object(
    'finalized_count', v_finalized_count,
    'finalized_units', v_finalized_units,
    'skipped_already_finalized', v_skipped,
    'missing_reservations', CASE WHEN v_found THEN 0 ELSE 1 END,
    'affected_variants', (
      SELECT COALESCE(jsonb_agg(DISTINCT to_jsonb(v)), '[]'::jsonb)
      FROM unnest(v_variant_ids) AS v
    ),
    'order_id', p_order_id,
    'reference_id', v_ref
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) IS
  'Phase 6E: finalize KK active reservations on shipment — decrement on_hand once per reservation line. Idempotent via stock_ledger idempotency_key.';

REVOKE ALL ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) TO service_role;

-- ════════════════════════════════════════════════════════════════
-- v_inventory_reservation_audit — reservation + ledger cross-ref
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_reservation_audit AS
SELECT
  ir.id AS reservation_id,
  ir.channel,
  ir.order_id,
  ir.order_item_id,
  ir.variant_id,
  p.id AS product_id,
  COALESCE(p.name, 'Unknown') AS product_label,
  COALESCE(
    NULLIF(BTRIM(pv.title), ''),
    NULLIF(BTRIM(pv.option_value), ''),
    NULLIF(BTRIM(pv.sku), ''),
    'Default'
  ) AS variant_label,
  ir.quantity,
  ir.status,
  ir.is_shadow,
  ir.idempotency_key,
  ir.source_reference,
  ir.notes,
  ir.reserve_ledger_id,
  ir.finalize_ledger_id,
  ir.release_ledger_id,
  ir.created_at,
  ir.updated_at,
  fs.label_status AS fulfillment_status,
  fs.tracking_number,
  fs.shipped_at
FROM public.inventory_reservations ir
LEFT JOIN public.product_variants pv ON pv.id = ir.variant_id
LEFT JOIN public.products p ON p.id = COALESCE(ir.product_id, pv.product_id)
LEFT JOIN public.fulfillment_shipments fs
  ON fs.stripe_checkout_session_id = ir.order_id;

COMMENT ON VIEW public.v_inventory_reservation_audit IS
  'Reservation audit with product labels and fulfillment shipment context.';

GRANT SELECT ON public.v_inventory_reservation_audit TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════
-- v_inventory_ledger_recent — include order_finalized label
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_inventory_ledger_recent AS
SELECT
  sl.id,
  sl.created_at AS entry_time,
  COALESCE(p.name, 'Unknown product') AS product_name,
  NULLIF(
    TRIM(
      COALESCE(
        NULLIF(pv.title, ''),
        NULLIF(pv.option_value, ''),
        NULLIF(pv.sku, ''),
        ''
      )
    ),
    ''
  ) AS variant_label,
  sl.change,
  sl.reason,
  CASE
    WHEN sl.reason = 'order' THEN 'KK Store'
    WHEN sl.reason = 'order_finalized' THEN 'Fulfillment'
    WHEN sl.reason = 'refund' THEN 'KK Store'
    WHEN sl.reason = 'parcel_receive' THEN 'Parcel Import'
    WHEN sl.reason = 'cutover_backfill' THEN 'Inventory Cutover'
    WHEN sl.reason = 'manual_adjustment' THEN 'Admin Inventory'
    ELSE COALESCE(NULLIF(sl.source, ''), 'System')
  END AS source,
  sl.reference_id,
  sl.stock_before,
  sl.stock_after,
  sl.variant_id,
  sl.product_id,
  sl.reference_type,
  sl.note
FROM public.stock_ledger sl
LEFT JOIN public.product_variants pv ON pv.id = sl.variant_id
LEFT JOIN public.products p ON p.id = sl.product_id;

COMMENT ON VIEW public.v_inventory_ledger_recent IS
  'Recent stock_ledger entries with product/variant labels for Inventory admin footer panel.';

GRANT SELECT ON public.v_inventory_ledger_recent TO authenticated, service_role;
