-- 20261111_inventory_marketplace_ship_finalize.sql
--
-- Extend finalize_kk_order_reservations so eBay/Amazon sale holds finalize on
-- Shippo TRANSIT/DELIVERED (same timing as KK website). Removes session skip
-- and selects reservations by resolved channel (kk | ebay | amazon).

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
  v_channel               text;
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
  v_stock_change          integer;
  v_ledger_id             uuid;
  v_found                 boolean := false;
  v_ledger_source         text;
  v_ledger_ref_type       text;
  v_ledger_note           text;
BEGIN
  IF p_order_id IS NULL OR btrim(p_order_id) = '' THEN
    RAISE EXCEPTION 'p_order_id is required' USING ERRCODE = 'P0001';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
    IF NOT v_is_admin THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001'; END IF;
  END IF;

  -- Resolve reservation channel from order session prefix.
  IF p_order_id LIKE 'ebay%' THEN
    v_channel := 'ebay';
  ELSIF p_order_id LIKE 'amazon%' THEN
    v_channel := 'amazon';
  ELSE
    v_channel := 'kk';
  END IF;

  v_ref := COALESCE(NULLIF(btrim(p_reference_id), ''), p_order_id);

  FOR v_res IN
    SELECT ir.*
    FROM public.inventory_reservations ir
    WHERE ir.channel = v_channel
      AND ir.order_id = p_order_id
      AND COALESCE(ir.is_shadow, false) = false
      AND ir.reservation_kind <> 'bundle_parent'
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

    IF v_res.reservation_kind = 'bundle_component' THEN
      v_idempotency_key := format(
        'bundle_component_finalize:%s:%s:%s:%s',
        v_res.order_id,
        COALESCE(v_res.order_item_id, v_res.id::text),
        v_res.variant_id,
        v_ref
      );
      v_ledger_source := 'bundle_component_finalize';
      v_ledger_ref_type := 'bundle_component_order_line';
      v_ledger_note := format(
        'Bundle component finalize (parent bundle %s, line %s)',
        COALESCE(v_res.parent_bundle_variant_id::text, '?'),
        COALESCE(v_res.order_item_id, '?')
      );
    ELSE
      -- Channel-aware key; KK keeps finalize:kk:... for existing ledger compatibility.
      v_idempotency_key := format(
        'finalize:%s:%s:%s:%s',
        v_channel,
        v_res.order_id,
        COALESCE(v_res.order_item_id, v_res.id::text),
        v_ref
      );
      v_ledger_source := COALESCE(NULLIF(btrim(p_source), ''), 'fulfillment');
      IF v_channel = 'kk' THEN
        v_ledger_ref_type := 'kk_order_fulfillment';
      ELSE
        v_ledger_ref_type := 'marketplace_order_fulfillment';
      END IF;
      v_ledger_note := format(
        'Reservation finalized on shipment (%s); on-hand decremented',
        v_channel
      );
    END IF;

    SELECT sl.id INTO v_existing_ledger
    FROM public.stock_ledger sl
    WHERE sl.idempotency_key = v_idempotency_key
    LIMIT 1;

    IF v_existing_ledger IS NOT NULL THEN
      UPDATE public.inventory_reservations
      SET status = 'finalized',
          finalize_ledger_id = COALESCE(finalize_ledger_id, v_existing_ledger),
          updated_at = now()
      WHERE id = v_res.id AND status = 'reserved';
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(pv.stock, 0) INTO v_stock_before
    FROM public.product_variants pv
    WHERE pv.id = v_res.variant_id
    FOR UPDATE;

    -- Clamp at zero: stock may already be depleted if adjusted manually while hold lingered.
    v_stock_after := GREATEST(0, v_stock_before - v_res.quantity);
    v_stock_change := v_stock_after - v_stock_before;

    UPDATE public.product_variants SET stock = v_stock_after WHERE id = v_res.variant_id;

    IF v_stock_change = 0 AND v_res.quantity > 0 THEN
      v_ledger_note := v_ledger_note || ' (on-hand already 0; cleared reservation without further decrement)';
    END IF;

    INSERT INTO public.stock_ledger (
      variant_id, product_id, change, reason, reference_id,
      stock_before, stock_after, note, source, reference_type, idempotency_key
    ) VALUES (
      v_res.variant_id, v_res.product_id, v_stock_change, 'order_finalized', v_ref,
      v_stock_before, v_stock_after, v_ledger_note, v_ledger_source, v_ledger_ref_type,
      v_idempotency_key
    )
    RETURNING id INTO v_ledger_id;

    UPDATE public.inventory_reservations
    SET status = 'finalized', finalize_ledger_id = v_ledger_id, updated_at = now()
    WHERE id = v_res.id;

    v_finalized_count := v_finalized_count + 1;
    v_finalized_units := v_finalized_units + v_res.quantity;
    v_variant_ids := array_append(v_variant_ids, v_res.variant_id);
  END LOOP;

  IF NOT v_found THEN v_missing := 1; END IF;

  RETURN jsonb_build_object(
    'finalized_count', v_finalized_count,
    'finalized_units', v_finalized_units,
    'skipped_already_finalized', v_skipped,
    'missing_reservations', CASE WHEN v_found THEN 0 ELSE 1 END,
    'affected_variants', (
      SELECT COALESCE(jsonb_agg(DISTINCT to_jsonb(v)), '[]'::jsonb) FROM unnest(v_variant_ids) AS v
    ),
    'order_id', p_order_id,
    'reference_id', v_ref,
    'channel', v_channel
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) IS
  'Finalize active reservations on shipment for kk/ebay/amazon sessions; decrement on_hand once per line. Idempotent via stock_ledger.';

REVOKE ALL ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) TO service_role;
