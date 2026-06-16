-- Phase 10F — Live virtual bundle inventory (core: guard, reserve, release, enable).

ALTER TABLE public.inventory_reservations
  ADD COLUMN IF NOT EXISTS parent_bundle_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_order_item_id text,
  ADD COLUMN IF NOT EXISTS reservation_kind text NOT NULL DEFAULT 'normal';

ALTER TABLE public.inventory_reservations
  DROP CONSTRAINT IF EXISTS inventory_reservations_kind_check;

ALTER TABLE public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_kind_check
  CHECK (reservation_kind IN ('normal', 'bundle_component', 'bundle_parent'));

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_parent_bundle
  ON public.inventory_reservations (parent_bundle_variant_id)
  WHERE parent_bundle_variant_id IS NOT NULL;

COMMENT ON COLUMN public.inventory_reservations.reservation_kind IS
  'Phase 10F: bundle_component reservations deduct from component variants for live virtual bundles.';

CREATE OR REPLACE FUNCTION public.is_bundle_live_deduction_enabled(p_bundle_variant_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global_mode text := 'preview_only';
  v_allow       boolean := false;
  v_vs          record;
  v_rule_count  integer := 0;
  v_eval        jsonb;
  v_status      text;
BEGIN
  IF p_bundle_variant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(s.virtual_bundle_mode, 'preview_only'), COALESCE(s.allow_per_bundle_live, false)
  INTO v_global_mode, v_allow
  FROM public.inventory_bundle_settings s
  WHERE s.setting_key = 'global';

  IF v_global_mode <> 'live' OR NOT v_allow THEN
    RETURN false;
  END IF;

  SELECT * INTO v_vs
  FROM public.inventory_bundle_variant_settings vs
  WHERE vs.bundle_variant_id = p_bundle_variant_id;

  IF NOT COALESCE(v_vs.is_virtual_enabled, false) THEN RETURN false; END IF;
  IF COALESCE(v_vs.mode, 'preview_only') <> 'live' THEN RETURN false; END IF;

  SELECT COUNT(*)::integer INTO v_rule_count
  FROM public.inventory_bundle_rules br
  WHERE br.bundle_variant_id = p_bundle_variant_id AND br.is_active;

  IF v_rule_count = 0 THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_bundle_rules br
    WHERE br.bundle_variant_id = p_bundle_variant_id AND br.is_active
      AND br.bundle_variant_id = br.component_variant_id
  ) THEN RETURN false; END IF;

  SELECT s.preview_status INTO v_status
  FROM public.v_inventory_bundle_summary_preview s
  WHERE s.bundle_variant_id = p_bundle_variant_id;

  IF v_status IN ('missing_component', 'self_reference_error') THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.v_inventory_bundle_summary_preview s
    WHERE s.bundle_variant_id = p_bundle_variant_id
      AND COALESCE(s.has_independent_stock_warning, false)
      AND NOT COALESCE(v_vs.independent_stock_acknowledged, false)
  ) THEN RETURN false; END IF;

  v_eval := public.evaluate_bundle_live_readiness(p_bundle_variant_id, false);
  IF NOT COALESCE((v_eval->>'is_ready_for_live')::boolean, false) THEN RETURN false; END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_bundle_live_deduction_enabled IS
  'Phase 10F: true only when global+bundle live readiness passes — gates component reserve/finalize.';

CREATE OR REPLACE FUNCTION public.reserve_live_bundle_components(
  p_order_id            text,
  p_order_item_id       text,
  p_bundle_variant_id   uuid,
  p_quantity            integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty           integer;
  v_rule          record;
  v_comp_avail    integer;
  v_needed        integer;
  v_reserved      integer := 0;
  v_skipped       integer := 0;
  v_failed        integer := 0;
  v_idem          text;
  v_ins           uuid;
  v_issues        jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_bundle_live_deduction_enabled(p_bundle_variant_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'live_deduction_not_enabled');
  END IF;

  v_qty := GREATEST(COALESCE(p_quantity, 0), 0);
  IF v_qty <= 0 OR p_order_id IS NULL OR p_order_item_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  FOR v_rule IN
    SELECT br.component_variant_id, br.component_qty::integer AS component_qty, pv.product_id
    FROM public.inventory_bundle_rules br
    JOIN public.product_variants pv ON pv.id = br.component_variant_id
    WHERE br.bundle_variant_id = p_bundle_variant_id AND br.is_active
    ORDER BY br.component_variant_id
  LOOP
    v_needed := v_qty * v_rule.component_qty;

    SELECT GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0)::integer
    INTO v_comp_avail
    FROM public.product_variants pv
    LEFT JOIN (
      SELECT ir.variant_id, COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
      FROM public.inventory_reservations ir
      WHERE ir.status = 'reserved' AND COALESCE(ir.is_shadow, false) = false
      GROUP BY ir.variant_id
    ) vr ON vr.variant_id = pv.id
    WHERE pv.id = v_rule.component_variant_id;

    v_idem := format('bundle_component_reserve:%s:%s:%s', p_order_id, p_order_item_id, v_rule.component_variant_id);

    IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE idempotency_key = v_idem) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_comp_avail < v_needed THEN
      v_failed := v_failed + 1;
      v_issues := v_issues || jsonb_build_object(
        'component_variant_id', v_rule.component_variant_id,
        'required', v_needed,
        'available', v_comp_avail,
        'reason', 'component_shortage_live'
      );
      CONTINUE;
    END IF;

    INSERT INTO public.inventory_reservations (
      channel, order_id, order_item_id, variant_id, product_id, quantity, status,
      is_shadow, idempotency_key, source_reference, reservation_kind,
      parent_bundle_variant_id, parent_order_item_id, notes
    ) VALUES (
      'kk', p_order_id, p_order_item_id, v_rule.component_variant_id, v_rule.product_id,
      v_needed, 'reserved', false, v_idem, p_order_id, 'bundle_component',
      p_bundle_variant_id, p_order_item_id,
      format('Live bundle component reserve (bundle %s qty %s)', p_bundle_variant_id, v_qty)
    )
    RETURNING id INTO v_ins;

    v_reserved := v_reserved + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', v_failed = 0,
    'reserved_components', v_reserved,
    'skipped_duplicate', v_skipped,
    'failed_components', v_failed,
    'issues', v_issues
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_live_bundle_components TO service_role;

CREATE OR REPLACE FUNCTION public.release_live_bundle_component_reservations(
  p_order_id      text,
  p_order_item_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.inventory_reservations ir
  SET status = 'released',
      notes = COALESCE(ir.notes, '') || ' · released on refund (bundle components)',
      updated_at = now()
  WHERE ir.order_id = p_order_id
    AND ir.reservation_kind = 'bundle_component'
    AND ir.status = 'reserved'
    AND (p_order_item_id IS NULL OR ir.order_item_id = p_order_item_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'released_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_live_bundle_component_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.enable_inventory_bundle_global_live_mode()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_bundle_settings
    WHERE setting_key = 'global' AND COALESCE(allow_per_bundle_live, false)
  ) THEN
    RAISE EXCEPTION 'allow_per_bundle_live must be enabled first' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.inventory_bundle_settings
  SET virtual_bundle_mode = 'live', updated_at = now()
  WHERE setting_key = 'global';

  RETURN jsonb_build_object('ok', true, 'global_mode', 'live');
END;
$$;

GRANT EXECUTE ON FUNCTION public.enable_inventory_bundle_global_live_mode TO authenticated;

CREATE OR REPLACE FUNCTION public.enable_bundle_live_mode(
  p_bundle_variant_id uuid,
  p_note              text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_eval jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001'; END IF;

  v_eval := public.evaluate_bundle_live_readiness(p_bundle_variant_id, false);
  IF NOT COALESCE((v_eval->>'is_ready_for_live')::boolean, false) THEN
    RAISE EXCEPTION 'Live enablement blocked: %', v_eval->'blocker_reasons' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_bundle_settings
    WHERE setting_key = 'global' AND virtual_bundle_mode = 'live' AND allow_per_bundle_live
  ) THEN
    RAISE EXCEPTION 'Global live mode and allow_per_bundle_live required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.inventory_bundle_variant_settings (
    bundle_variant_id, is_virtual_enabled, mode
  ) VALUES (p_bundle_variant_id, true, 'live')
  ON CONFLICT (bundle_variant_id) DO UPDATE SET
    is_virtual_enabled = true,
    mode = 'live',
    updated_at = now();

  PERFORM public.log_inventory_bundle_live_readiness_action(
    p_bundle_variant_id, 'live_enabled', p_note,
    v_eval || jsonb_build_object('action', 'live_enabled')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bundle_mode', 'live',
    'message', 'Live enabled — bundle sales will reserve and finalize component inventory.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enable_bundle_live_mode TO authenticated;

CREATE OR REPLACE FUNCTION public.revert_bundle_live_mode(
  p_bundle_variant_id uuid,
  p_target_mode       text DEFAULT 'shadow',
  p_note              text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001'; END IF;

  IF p_target_mode NOT IN ('preview_only', 'shadow', 'live_requested') THEN
    RAISE EXCEPTION 'Invalid target mode' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.inventory_bundle_variant_settings
  SET mode = p_target_mode, updated_at = now()
  WHERE bundle_variant_id = p_bundle_variant_id;

  PERFORM public.log_inventory_bundle_live_readiness_action(
    p_bundle_variant_id, 'live_reverted', p_note,
    jsonb_build_object('reverted_to', p_target_mode)
  );

  RETURN jsonb_build_object('ok', true, 'bundle_mode', p_target_mode);
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_bundle_live_mode TO authenticated;
