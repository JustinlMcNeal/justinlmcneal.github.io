-- Phase 10F — Live virtual bundle: availability view + finalize idempotency + audit action types.

ALTER TABLE public.inventory_bundle_live_readiness_actions
  DROP CONSTRAINT IF EXISTS inventory_bundle_live_readiness_actions_action_type_check;

ALTER TABLE public.inventory_bundle_live_readiness_actions
  ADD CONSTRAINT inventory_bundle_live_readiness_actions_action_type_check
  CHECK (action_type IN (
    'independent_stock_acknowledged',
    'live_requested',
    'live_request_cancelled',
    'allow_per_bundle_live_enabled',
    'virtual_enabled',
    'live_enabled',
    'live_reverted'
  ));

CREATE OR REPLACE VIEW public.v_kk_variant_available_stock AS
WITH variant_reserved AS (
  SELECT
    ir.variant_id,
    COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
  FROM public.inventory_reservations ir
  WHERE ir.status = 'reserved'
    AND ir.variant_id IS NOT NULL
    AND COALESCE(ir.is_shadow, false) = false
  GROUP BY ir.variant_id
),
live_virtual AS (
  SELECT
    s.bundle_variant_id,
    GREATEST(COALESCE(s.virtual_bundle_available, 0), 0)::integer AS virtual_avail
  FROM public.v_inventory_bundle_summary_preview s
  WHERE public.is_bundle_live_deduction_enabled(s.bundle_variant_id)
)
SELECT
  pv.id AS variant_id,
  pv.product_id,
  NULLIF(BTRIM(pv.sku), '') AS sku,
  NULLIF(BTRIM(pv.option_value), '') AS option_value,
  COALESCE(pv.stock, 0) AS on_hand,
  COALESCE(vr.reserved_qty, 0) AS reserved,
  CASE
    WHEN lv.bundle_variant_id IS NOT NULL THEN lv.virtual_avail
    ELSE COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0)
  END AS available,
  CASE
    WHEN lv.bundle_variant_id IS NOT NULL THEN lv.virtual_avail
    ELSE GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0)
  END AS available_display,
  CASE
    WHEN lv.bundle_variant_id IS NOT NULL THEN (lv.virtual_avail > 0)
    ELSE (GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) > 0)
  END AS is_available,
  CASE
    WHEN lv.bundle_variant_id IS NOT NULL THEN (lv.virtual_avail > 0 AND lv.virtual_avail <= 3)
    ELSE (
      GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) > 0
      AND GREATEST(COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0), 0) <= 3
    )
  END AS low_stock,
  (
    SELECT MAX(ir.updated_at)
    FROM public.inventory_reservations ir
    WHERE ir.variant_id = pv.id
      AND ir.status = 'reserved'
      AND COALESCE(ir.is_shadow, false) = false
  ) AS updated_at
FROM public.product_variants pv
LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
LEFT JOIN live_virtual lv ON lv.bundle_variant_id = pv.id
JOIN public.products p ON p.id = pv.product_id
WHERE COALESCE(pv.is_active, true) = true
  AND COALESCE(p.is_active, true) = true;

COMMENT ON VIEW public.v_kk_variant_available_stock IS
  'Phase 10F: live-enabled Model B bundles use virtual component availability; others use on_hand - reserved.';

GRANT SELECT ON public.v_kk_variant_available_stock TO anon, authenticated, service_role;

-- Finalize with bundle_component idempotency + ledger source.
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
  v_ledger_source         text;
  v_ledger_ref_type       text;
  v_ledger_note           text;
BEGIN
  IF p_order_id IS NULL OR btrim(p_order_id) = '' THEN
    RAISE EXCEPTION 'p_order_id is required' USING ERRCODE = 'P0001';
  END IF;

  IF p_order_id LIKE 'ebay%' OR p_order_id LIKE 'amazon%' THEN
    RETURN jsonb_build_object(
      'finalized_count', 0, 'finalized_units', 0,
      'skipped_already_finalized', 0, 'missing_reservations', 0,
      'affected_variants', '[]'::jsonb,
      'note', 'Non-KK order session — skipped'
    );
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
    IF NOT v_is_admin THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001'; END IF;
  END IF;

  v_ref := COALESCE(NULLIF(btrim(p_reference_id), ''), p_order_id);

  FOR v_res IN
    SELECT ir.*
    FROM public.inventory_reservations ir
    WHERE ir.channel = 'kk'
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
      v_idempotency_key := format(
        'finalize:kk:%s:%s:%s',
        v_res.order_id,
        COALESCE(v_res.order_item_id, v_res.id::text),
        v_ref
      );
      v_ledger_source := COALESCE(NULLIF(btrim(p_source), ''), 'fulfillment');
      v_ledger_ref_type := 'kk_order_fulfillment';
      v_ledger_note := 'Reservation finalized on shipment; on-hand decremented';
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

    v_stock_after := v_stock_before - v_res.quantity;

    UPDATE public.product_variants SET stock = v_stock_after WHERE id = v_res.variant_id;

    INSERT INTO public.stock_ledger (
      variant_id, product_id, change, reason, reference_id,
      stock_before, stock_after, note, source, reference_type, idempotency_key
    ) VALUES (
      v_res.variant_id, v_res.product_id, -v_res.quantity, 'order_finalized', v_ref,
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
    'reference_id', v_ref
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_kk_order_reservations(text, text, text, uuid) IS
  'Phase 10F: bundle_component reservations use distinct idempotency keys and ledger source.';

-- Fix enable_bundle_live_mode audit action type (replaces core migration call).
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
    is_virtual_enabled = true, mode = 'live', updated_at = now();

  PERFORM public.log_inventory_bundle_live_readiness_action(
    p_bundle_variant_id, 'live_enabled', p_note,
    v_eval || jsonb_build_object('action', 'live_enabled')
  );

  RETURN jsonb_build_object(
    'ok', true, 'bundle_mode', 'live',
    'message', 'Live enabled — bundle sales will reserve and finalize component inventory.'
  );
END;
$$;

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

-- Break evaluate ↔ is_bundle_live_deduction_enabled recursion (Phase 10F).
CREATE OR REPLACE FUNCTION public.evaluate_bundle_live_readiness(
  p_bundle_variant_id uuid,
  p_for_live_request    boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary           record;
  v_vs                record;
  v_global_mode       text := 'preview_only';
  v_allow_live        boolean := false;
  v_sim               jsonb;
  v_shadow_used       boolean := false;
  v_shadow_count      integer := 0;
  v_shortage_count    integer := 0;
  v_checklist         jsonb := '[]'::jsonb;
  v_blockers          text[] := ARRAY[]::text[];
  v_warnings          text[] := ARRAY[]::text[];
  v_passed            integer := 0;
  v_required          integer := 0;
  v_ready_request     boolean := false;
  v_ready_live        boolean := false;
BEGIN
  SELECT * INTO v_summary
  FROM public.v_inventory_bundle_summary_preview s
  WHERE s.bundle_variant_id = p_bundle_variant_id;

  IF v_summary IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bundle_not_found');
  END IF;

  SELECT * INTO v_vs
  FROM public.inventory_bundle_variant_settings vs
  WHERE vs.bundle_variant_id = p_bundle_variant_id;

  SELECT COALESCE(s.virtual_bundle_mode, 'preview_only'), COALESCE(s.allow_per_bundle_live, false)
  INTO v_global_mode, v_allow_live
  FROM public.inventory_bundle_settings s WHERE s.setting_key = 'global';

  v_shadow_used := v_global_mode = 'shadow'
    OR (COALESCE(v_vs.is_virtual_enabled, false) AND COALESCE(v_vs.mode, 'preview_only') = 'shadow');

  SELECT COUNT(*)::integer,
         COUNT(*) FILTER (WHERE COALESCE(e.simulation_result->>'result', '') = 'component_shortage')::integer
  INTO v_shadow_count, v_shortage_count
  FROM public.inventory_bundle_shadow_events e
  WHERE e.bundle_variant_id = p_bundle_variant_id
    AND e.event_type IN ('reservation_shadow', 'finalize_shadow', 'checkout_simulation');

  v_sim := public.simulate_virtual_bundle_order(p_bundle_variant_id, 1);

  v_checklist := jsonb_build_array(
    jsonb_build_object('key', 'active_rules', 'label', 'Active bundle rules',
      'passed', COALESCE(v_summary.component_count, 0) > 0, 'required', true, 'warning', false),
    jsonb_build_object('key', 'no_self_reference', 'label', 'No self-reference',
      'passed', v_summary.preview_status <> 'self_reference_error', 'required', true, 'warning', false),
    jsonb_build_object('key', 'no_missing_components', 'label', 'No missing/inactive components',
      'passed', v_summary.preview_status <> 'missing_component', 'required', true, 'warning', false),
    jsonb_build_object('key', 'valid_component_qty', 'label', 'Component quantities valid',
      'passed', v_summary.preview_status NOT IN ('self_reference_error', 'missing_component'), 'required', true, 'warning', false),
    jsonb_build_object('key', 'virtual_availability_ok', 'label', 'Virtual availability calculation succeeds',
      'passed', COALESCE(v_sim->>'ok', 'false')::boolean AND v_sim->>'virtual_availability' IS NOT NULL,
      'required', true, 'warning', false),
    jsonb_build_object('key', 'independent_stock_acknowledged', 'label', 'Independent stock acknowledged (if applicable)',
      'passed', NOT COALESCE(v_summary.has_independent_stock_warning, false)
        OR COALESCE(v_vs.independent_stock_acknowledged, false),
      'required', COALESCE(v_summary.has_independent_stock_warning, false), 'warning', false),
    jsonb_build_object('key', 'shadow_evidence_present', 'label', 'Shadow evidence recorded (if shadow mode used)',
      'passed', NOT v_shadow_used OR v_shadow_count > 0, 'required', v_shadow_used, 'warning', false),
    jsonb_build_object('key', 'no_recent_shortage_shadow', 'label', 'No shortage shadow events',
      'passed', v_shortage_count = 0, 'required', false, 'warning', v_shortage_count > 0),
    jsonb_build_object('key', 'virtual_enabled', 'label', 'Virtual bundle enabled',
      'passed', COALESCE(v_vs.is_virtual_enabled, false), 'required', true, 'warning', false)
  );

  IF NOT p_for_live_request THEN
    v_checklist := v_checklist || jsonb_build_array(
      jsonb_build_object('key', 'global_allows_live', 'label', 'Global per-bundle live allowed',
        'passed', v_allow_live, 'required', true, 'warning', false),
      jsonb_build_object('key', 'global_mode_live', 'label', 'Global mode is live',
        'passed', v_global_mode = 'live', 'required', true, 'warning', false),
      jsonb_build_object('key', 'bundle_mode_live', 'label', 'Bundle mode is live',
        'passed', COALESCE(v_vs.mode, 'preview_only') = 'live', 'required', true, 'warning', false)
    );
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE (elem->>'required')::boolean AND (elem->>'passed')::boolean)::integer,
    COUNT(*) FILTER (WHERE (elem->>'required')::boolean)::integer
  INTO v_passed, v_required
  FROM jsonb_array_elements(v_checklist) elem;

  IF v_shortage_count > 0 THEN v_warnings := array_append(v_warnings, 'shortage_shadow_events'); END IF;
  IF COALESCE(v_summary.component_count, 0) = 0 THEN v_blockers := array_append(v_blockers, 'no_active_rules'); END IF;
  IF v_summary.preview_status = 'self_reference_error' THEN v_blockers := array_append(v_blockers, 'self_reference'); END IF;
  IF v_summary.preview_status = 'missing_component' THEN v_blockers := array_append(v_blockers, 'missing_component'); END IF;
  IF v_summary.preview_status = 'component_shortage' THEN v_blockers := array_append(v_blockers, 'component_shortage'); END IF;
  IF COALESCE(v_summary.has_independent_stock_warning, false)
    AND NOT COALESCE(v_vs.independent_stock_acknowledged, false) THEN
    v_blockers := array_append(v_blockers, 'independent_stock_not_acknowledged');
  END IF;
  IF v_shadow_used AND v_shadow_count = 0 THEN v_blockers := array_append(v_blockers, 'no_shadow_evidence'); END IF;
  IF NOT COALESCE(v_vs.is_virtual_enabled, false) THEN v_blockers := array_append(v_blockers, 'bundle_virtual_not_enabled'); END IF;

  IF NOT p_for_live_request THEN
    IF NOT v_allow_live THEN v_blockers := array_append(v_blockers, 'per_bundle_live_disabled'); END IF;
    IF v_global_mode <> 'live' THEN v_blockers := array_append(v_blockers, 'global_mode_not_live'); END IF;
    IF COALESCE(v_vs.mode, 'preview_only') <> 'live' THEN v_blockers := array_append(v_blockers, 'bundle_mode_not_live'); END IF;
  END IF;

  v_ready_request := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_checklist) elem
    WHERE (elem->>'required')::boolean AND NOT (elem->>'passed')::boolean
      AND (elem->>'key') NOT IN ('global_allows_live', 'global_mode_live', 'bundle_mode_live')
  );

  v_ready_live := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_checklist) elem
    WHERE (elem->>'required')::boolean AND NOT (elem->>'passed')::boolean
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bundle_variant_id', p_bundle_variant_id,
    'for_live_request', p_for_live_request,
    'checklist', v_checklist,
    'checklist_passed', v_passed,
    'checklist_required', v_required,
    'blocker_reasons', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings),
    'is_ready_for_live_request', v_ready_request,
    'is_ready_for_live', v_ready_live,
    'live_deduction_enabled', CASE WHEN p_for_live_request THEN false ELSE v_ready_live END,
    'shadow_event_count', v_shadow_count,
    'shortage_shadow_count', v_shortage_count,
    'shadow_mode_was_used', v_shadow_used
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_bundle_live_readiness TO authenticated, service_role;
