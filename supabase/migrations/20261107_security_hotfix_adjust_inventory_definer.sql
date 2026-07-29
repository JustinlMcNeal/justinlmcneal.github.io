-- 20261107_security_hotfix_adjust_inventory_definer.sql
--
-- Hotfix: restore Admin Inventory manual adjust after security phase 3/4 table grants.
-- adjust_inventory was SECURITY INVOKER; authenticated role only has SELECT on
-- product_variants and stock_ledger, so UPDATE/INSERT failed with 403 via PostgREST.
--
-- Fix: SECURITY DEFINER + is_admin() gate (same pattern as other admin write RPCs).
-- Does not widen anon access; EXECUTE remains authenticated + service_role only.

BEGIN;

CREATE OR REPLACE FUNCTION public.adjust_inventory(
  p_variant_id        uuid,
  p_delta_qty         integer,
  p_reason            text,
  p_note              text,
  p_reference_type    text DEFAULT 'manual_adjust',
  p_reference_id      text DEFAULT NULL,
  p_idempotency_key   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor           uuid := auth.uid();
  v_is_admin        boolean := false;
  v_variant         public.product_variants%ROWTYPE;
  v_stock_before    integer;
  v_stock_after     integer;
  v_reason          text;
  v_note            text;
  v_ledger_id       uuid;
  v_existing        public.stock_ledger%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_variant_id IS NULL THEN
    RAISE EXCEPTION 'variant_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_delta_qty IS NULL OR p_delta_qty = 0 THEN
    RAISE EXCEPTION 'delta_qty must be a non-zero integer'
      USING ERRCODE = 'P0001';
  END IF;

  IF abs(p_delta_qty) > 100000 THEN
    RAISE EXCEPTION 'delta_qty exceeds manual adjustment limit (100000)'
      USING ERRCODE = 'P0001';
  END IF;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_reason NOT IN (
    'count_correction',
    'damaged',
    'lost',
    'found',
    'returned_to_stock',
    'other'
  ) THEN
    RAISE EXCEPTION 'Invalid adjustment reason: %', v_reason
      USING ERRCODE = 'P0001';
  END IF;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'note is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT *
    INTO v_existing
    FROM public.stock_ledger sl
    WHERE sl.idempotency_key = btrim(p_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'variant_id', v_existing.variant_id,
        'product_id', v_existing.product_id,
        'delta', v_existing.change,
        'stock_before', v_existing.stock_before,
        'stock_after', v_existing.stock_after,
        'ledger_id', v_existing.id,
        'created_at', v_existing.created_at,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT *
  INTO v_variant
  FROM public.product_variants pv
  WHERE pv.id = p_variant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Variant not found: %', p_variant_id
      USING ERRCODE = 'P0001';
  END IF;

  v_stock_before := coalesce(v_variant.stock, 0);
  v_stock_after := v_stock_before + p_delta_qty;

  UPDATE public.product_variants
  SET stock = v_stock_after
  WHERE id = p_variant_id;

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
    p_variant_id,
    v_variant.product_id,
    p_delta_qty,
    'manual_adjustment',
    coalesce(nullif(btrim(p_reference_id), ''), v_reason),
    v_stock_before,
    v_stock_after,
    v_note,
    'admin_inventory',
    coalesce(nullif(btrim(p_reference_type), ''), 'manual_adjust'),
    nullif(btrim(p_idempotency_key), ''),
    v_actor
  )
  RETURNING id INTO v_ledger_id;

  RETURN jsonb_build_object(
    'variant_id', p_variant_id,
    'product_id', v_variant.product_id,
    'delta', p_delta_qty,
    'stock_before', v_stock_before,
    'stock_after', v_stock_after,
    'ledger_id', v_ledger_id,
    'created_at', now(),
    'adjustment_reason', v_reason,
    'idempotent_replay', false
  );
END;
$$;

COMMENT ON FUNCTION public.adjust_inventory(uuid, integer, text, text, text, text, text) IS
  'Admin-only manual stock adjustment (SECURITY DEFINER). Updates product_variants.stock and inserts stock_ledger. Requires JWT app_metadata.is_admin.';

REVOKE ALL ON FUNCTION public.adjust_inventory(uuid, integer, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_inventory(uuid, integer, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(uuid, integer, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(uuid, integer, text, text, text, text, text) TO service_role;

COMMIT;
