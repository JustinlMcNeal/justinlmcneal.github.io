-- Phase 10D — Virtual bundle checkout shadow hook (read-only shadow events only).

ALTER TABLE public.inventory_bundle_shadow_events
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bundle_shadow_events_idempotency
  ON public.inventory_bundle_shadow_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.inventory_bundle_shadow_events.idempotency_key IS
  'Dedup key for webhook retries, e.g. bundle_shadow:reservation:{session}:{line}';

-- Effective shadow mode for a bundle variant (never returns live as actionable in 10D).
CREATE OR REPLACE FUNCTION public.get_bundle_effective_shadow_mode(p_bundle_variant_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_global text := 'preview_only';
  v_bundle text := 'preview_only';
  v_enabled boolean := false;
BEGIN
  SELECT COALESCE(s.virtual_bundle_mode, 'preview_only')
  INTO v_global
  FROM public.inventory_bundle_settings s
  WHERE s.setting_key = 'global';

  SELECT COALESCE(vs.mode, 'preview_only'), COALESCE(vs.is_virtual_enabled, false)
  INTO v_bundle, v_enabled
  FROM public.inventory_bundle_variant_settings vs
  WHERE vs.bundle_variant_id = p_bundle_variant_id;

  IF v_global = 'shadow' THEN
    RETURN 'shadow';
  END IF;

  IF v_enabled AND v_bundle = 'shadow' THEN
    RETURN 'shadow';
  END IF;

  RETURN 'preview_only';
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bundle_effective_shadow_mode TO authenticated, service_role;

-- Admin: update global mode (live blocked in Phase 10D).
CREATE OR REPLACE FUNCTION public.update_inventory_bundle_global_mode(p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_mode NOT IN ('preview_only', 'shadow') THEN
    RAISE EXCEPTION 'Invalid mode — live is not available in Phase 10D' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.inventory_bundle_settings
  SET virtual_bundle_mode = p_mode, updated_at = now()
  WHERE setting_key = 'global';

  RETURN jsonb_build_object('ok', true, 'global_mode', p_mode);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_inventory_bundle_global_mode TO authenticated;

-- Admin: update per-bundle mode (live blocked in Phase 10D).
CREATE OR REPLACE FUNCTION public.update_inventory_bundle_variant_mode(
  p_bundle_variant_id uuid,
  p_mode              text,
  p_is_virtual_enabled boolean DEFAULT NULL
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
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_mode NOT IN ('preview_only', 'shadow') THEN
    RAISE EXCEPTION 'Invalid mode — live is not available in Phase 10D' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.inventory_bundle_variant_settings (
    bundle_variant_id, is_virtual_enabled, mode
  ) VALUES (
    p_bundle_variant_id,
    COALESCE(p_is_virtual_enabled, p_mode = 'shadow'),
    p_mode
  )
  ON CONFLICT (bundle_variant_id) DO UPDATE SET
    mode = EXCLUDED.mode,
    is_virtual_enabled = COALESCE(p_is_virtual_enabled, inventory_bundle_variant_settings.is_virtual_enabled),
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'bundle_variant_id', p_bundle_variant_id,
    'bundle_mode', p_mode
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_inventory_bundle_variant_mode TO authenticated;

-- Service/webhook: idempotent shadow event with mode guard + simulation (no inventory writes).
CREATE OR REPLACE FUNCTION public.try_record_inventory_bundle_shadow_event(
  p_event_type            text,
  p_bundle_variant_id     uuid,
  p_quantity              numeric,
  p_idempotency_key       text,
  p_source_order_id       text DEFAULT NULL,
  p_source_order_item_id  text DEFAULT NULL,
  p_metadata              jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing    uuid;
  v_mode        text;
  v_rule_count  integer := 0;
  v_sim         jsonb;
  v_meta        jsonb;
  v_id          uuid;
BEGIN
  IF p_event_type NOT IN ('checkout_simulation', 'reservation_shadow', 'finalize_shadow') THEN
    RETURN jsonb_build_object('ok', false, 'inserted', false, 'reason', 'invalid_event_type');
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'inserted', false, 'reason', 'invalid_quantity');
  END IF;

  IF p_idempotency_key IS NULL OR BTRIM(p_idempotency_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'inserted', false, 'reason', 'idempotency_key_required');
  END IF;

  SELECT id INTO v_existing
  FROM public.inventory_bundle_shadow_events
  WHERE idempotency_key = p_idempotency_key;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'inserted', false, 'reason', 'duplicate', 'shadow_event_id', v_existing);
  END IF;

  v_mode := public.get_bundle_effective_shadow_mode(p_bundle_variant_id);
  IF v_mode <> 'shadow' THEN
    RETURN jsonb_build_object('ok', true, 'inserted', false, 'reason', 'mode_not_shadow', 'effective_mode', v_mode);
  END IF;

  SELECT COUNT(*)::integer INTO v_rule_count
  FROM public.inventory_bundle_rules
  WHERE bundle_variant_id = p_bundle_variant_id AND is_active;

  IF v_rule_count = 0 THEN
    RETURN jsonb_build_object('ok', true, 'inserted', false, 'reason', 'no_active_rules');
  END IF;

  v_sim := public.simulate_virtual_bundle_order(p_bundle_variant_id, p_quantity);

  v_meta := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'no_inventory_side_effects', true,
    'effective_mode', v_mode,
    'hook_phase', '10d'
  );

  INSERT INTO public.inventory_bundle_shadow_events (
    event_type, bundle_variant_id, quantity,
    source_order_id, source_order_item_id,
    simulation_result, metadata, idempotency_key, created_by
  ) VALUES (
    p_event_type, p_bundle_variant_id, p_quantity,
    p_source_order_id, p_source_order_item_id,
    v_sim, v_meta, p_idempotency_key, NULL
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', true,
    'shadow_event_id', v_id,
    'simulation_result', v_sim
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_existing
    FROM public.inventory_bundle_shadow_events
    WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', true, 'inserted', false, 'reason', 'duplicate', 'shadow_event_id', v_existing);
END;
$$;

COMMENT ON FUNCTION public.try_record_inventory_bundle_shadow_event IS
  'Phase 10D: idempotent checkout/fulfillment bundle shadow log — simulation only, no inventory mutation.';

GRANT EXECUTE ON FUNCTION public.try_record_inventory_bundle_shadow_event TO service_role;

-- Recent shadow events for admin UI.
CREATE OR REPLACE VIEW public.v_inventory_bundle_shadow_events_recent AS
SELECT
  e.id,
  e.event_type,
  e.bundle_variant_id,
  COALESCE(p.name, 'Unknown') || ' · ' ||
    COALESCE(NULLIF(BTRIM(pv.sku), ''), NULLIF(BTRIM(pv.title), ''), pv.option_value, '—') AS bundle_label,
  e.quantity,
  e.source_order_id,
  e.source_order_item_id,
  e.simulation_result->>'result' AS simulation_result_code,
  COALESCE((e.simulation_result->>'can_fulfill_virtual')::boolean, false) AS can_fulfill_virtual,
  COALESCE((e.simulation_result->>'independent_stock_warning')::boolean, false) AS independent_stock_warning,
  e.metadata,
  e.idempotency_key,
  e.created_at
FROM public.inventory_bundle_shadow_events e
JOIN public.product_variants pv ON pv.id = e.bundle_variant_id
JOIN public.products p ON p.id = pv.product_id;

GRANT SELECT ON public.v_inventory_bundle_shadow_events_recent TO authenticated, service_role;

-- Readiness view: shadow counts + shadow mode active.
DROP VIEW IF EXISTS public.v_inventory_bundle_cutover_readiness;

CREATE VIEW public.v_inventory_bundle_cutover_readiness AS
WITH global_cfg AS (
  SELECT COALESCE(virtual_bundle_mode, 'preview_only') AS global_mode,
         COALESCE(allow_per_bundle_live, false) AS allow_per_bundle_live
  FROM public.inventory_bundle_settings
  WHERE setting_key = 'global'
  LIMIT 1
),
shadow_stats AS (
  SELECT
    bundle_variant_id,
    COUNT(*)::integer AS shadow_event_count,
    MAX(created_at) AS last_shadow_event_at
  FROM public.inventory_bundle_shadow_events
  GROUP BY bundle_variant_id
),
bundle_base AS (
  SELECT DISTINCT br.bundle_variant_id
  FROM public.inventory_bundle_rules br
  WHERE br.is_active
)
SELECT
  s.bundle_variant_id,
  s.bundle_label,
  COALESCE(vs.mode, 'preview_only') AS bundle_mode,
  COALESCE(g.global_mode, 'preview_only') AS global_mode,
  public.get_bundle_effective_shadow_mode(s.bundle_variant_id) AS effective_shadow_mode,
  (
    COALESCE(g.global_mode, 'preview_only') = 'shadow'
    OR (COALESCE(vs.is_virtual_enabled, false) AND COALESCE(vs.mode, 'preview_only') = 'shadow')
  ) AS shadow_mode_active,
  s.component_count AS component_count,
  (s.component_count > 0) AS has_active_rules,
  (s.preview_status = 'self_reference_error') AS has_self_reference,
  (s.preview_status = 'component_shortage') AS has_component_shortage,
  COALESCE(s.has_independent_stock_warning, false) AS has_independent_stock_warning,
  COALESCE(vs.independent_stock_acknowledged, false) AS independent_stock_acknowledged,
  s.virtual_bundle_available AS virtual_available,
  s.bundle_available AS current_bundle_available,
  COALESCE(ss.shadow_event_count, 0) AS shadow_event_count,
  ss.last_shadow_event_at,
  (
    s.component_count > 0
    AND s.preview_status NOT IN ('self_reference_error', 'missing_component')
    AND COALESCE(g.global_mode, 'preview_only') IN ('preview_only', 'shadow')
  ) AS is_ready_for_shadow,
  (
    s.component_count > 0
    AND s.preview_status = 'ready'
    AND (
      NOT COALESCE(s.has_independent_stock_warning, false)
      OR COALESCE(vs.independent_stock_acknowledged, false)
    )
    AND COALESCE(g.global_mode, 'preview_only') = 'live'
    AND COALESCE(g.allow_per_bundle_live, false)
    AND COALESCE(vs.mode, 'preview_only') = 'live'
    AND COALESCE(vs.is_virtual_enabled, false)
  ) AS is_ready_for_live,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN s.component_count = 0 THEN 'no_active_rules' END,
    CASE WHEN s.preview_status = 'self_reference_error' THEN 'self_reference' END,
    CASE WHEN s.preview_status = 'missing_component' THEN 'missing_component' END,
    CASE WHEN s.preview_status = 'component_shortage' THEN 'component_shortage' END,
    CASE WHEN COALESCE(s.has_independent_stock_warning, false)
      AND NOT COALESCE(vs.independent_stock_acknowledged, false) THEN 'independent_stock_not_acknowledged' END,
    CASE WHEN COALESCE(g.global_mode, 'preview_only') <> 'live' THEN 'global_mode_not_live' END,
    CASE WHEN NOT COALESCE(g.allow_per_bundle_live, false) THEN 'per_bundle_live_disabled' END,
    CASE WHEN NOT COALESCE(vs.is_virtual_enabled, false) THEN 'bundle_virtual_not_enabled' END
  ], NULL) AS blocker_reasons
FROM public.v_inventory_bundle_summary_preview s
JOIN bundle_base bb ON bb.bundle_variant_id = s.bundle_variant_id
CROSS JOIN global_cfg g
LEFT JOIN public.inventory_bundle_variant_settings vs ON vs.bundle_variant_id = s.bundle_variant_id
LEFT JOIN shadow_stats ss ON ss.bundle_variant_id = s.bundle_variant_id;

COMMENT ON VIEW public.v_inventory_bundle_cutover_readiness IS
  'Advisory cutover readiness + shadow stats (Phase 10D).';

GRANT SELECT ON public.v_inventory_bundle_cutover_readiness TO authenticated, service_role;
