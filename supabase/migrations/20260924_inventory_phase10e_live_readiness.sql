-- Phase 10E — Virtual bundle live readiness + guardrails (no live inventory behavior).

-- Extend per-bundle settings for acknowledgement + live request staging.
ALTER TABLE public.inventory_bundle_variant_settings
  ADD COLUMN IF NOT EXISTS independent_stock_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS independent_stock_acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS independent_stock_ack_note text,
  ADD COLUMN IF NOT EXISTS live_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS live_request_note text,
  ADD COLUMN IF NOT EXISTS live_ready_acknowledged boolean NOT NULL DEFAULT false;

ALTER TABLE public.inventory_bundle_variant_settings
  DROP CONSTRAINT IF EXISTS inventory_bundle_variant_settings_mode_check;

ALTER TABLE public.inventory_bundle_variant_settings
  ADD CONSTRAINT inventory_bundle_variant_settings_mode_check
  CHECK (mode IN ('preview_only', 'shadow', 'live_requested', 'live'));

COMMENT ON COLUMN public.inventory_bundle_variant_settings.live_requested_at IS
  'Phase 10E: staged live request — no inventory behavior until Phase 10F wiring.';

CREATE TABLE IF NOT EXISTS public.inventory_bundle_live_readiness_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_variant_id   uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  action_type         text NOT NULL
                      CHECK (action_type IN (
                        'independent_stock_acknowledged',
                        'live_requested',
                        'live_request_cancelled',
                        'allow_per_bundle_live_enabled',
                        'virtual_enabled'
                      )),
  actor_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note                text,
  readiness_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bundle_live_readiness_actions_bundle
  ON public.inventory_bundle_live_readiness_actions (bundle_variant_id, created_at DESC);

ALTER TABLE public.inventory_bundle_live_readiness_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_bundle_live_readiness_actions_service_role_all
  ON public.inventory_bundle_live_readiness_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_bundle_live_readiness_actions_authenticated_select
  ON public.inventory_bundle_live_readiness_actions FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_bundle_live_readiness_actions_authenticated_insert
  ON public.inventory_bundle_live_readiness_actions FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON public.inventory_bundle_live_readiness_actions TO authenticated;
GRANT ALL ON public.inventory_bundle_live_readiness_actions TO service_role;

CREATE OR REPLACE FUNCTION public.log_inventory_bundle_live_readiness_action(
  p_bundle_variant_id uuid,
  p_action_type       text,
  p_note              text DEFAULT NULL,
  p_readiness_snapshot jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.inventory_bundle_live_readiness_actions (
    bundle_variant_id, action_type, actor_id, note, readiness_snapshot
  ) VALUES (
    p_bundle_variant_id, p_action_type, auth.uid(), p_note, COALESCE(p_readiness_snapshot, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_inventory_bundle_live_readiness_action TO authenticated;

-- Phase 10E guard: live mode in DB must not enable checkout deduction yet.
CREATE OR REPLACE FUNCTION public.is_bundle_live_deduction_enabled(p_bundle_variant_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT false;
$$;

COMMENT ON FUNCTION public.is_bundle_live_deduction_enabled IS
  'Phase 10E: always false until Phase 10F live wiring. Checkout must consult this before component deduction.';

GRANT EXECUTE ON FUNCTION public.is_bundle_live_deduction_enabled TO authenticated, service_role;

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
         COUNT(*) FILTER (
           WHERE COALESCE(e.simulation_result->>'result', '') = 'component_shortage'
         )::integer
  INTO v_shadow_count, v_shortage_count
  FROM public.inventory_bundle_shadow_events e
  WHERE e.bundle_variant_id = p_bundle_variant_id
    AND e.event_type IN ('reservation_shadow', 'finalize_shadow', 'checkout_simulation');

  v_sim := public.simulate_virtual_bundle_order(p_bundle_variant_id, 1);

  v_checklist := jsonb_build_array(
    jsonb_build_object(
      'key', 'active_rules', 'label', 'Active bundle rules',
      'passed', COALESCE(v_summary.component_count, 0) > 0, 'required', true, 'warning', false
    ),
    jsonb_build_object(
      'key', 'no_self_reference', 'label', 'No self-reference',
      'passed', v_summary.preview_status <> 'self_reference_error', 'required', true, 'warning', false
    ),
    jsonb_build_object(
      'key', 'no_missing_components', 'label', 'No missing/inactive components',
      'passed', v_summary.preview_status <> 'missing_component', 'required', true, 'warning', false
    ),
    jsonb_build_object(
      'key', 'valid_component_qty', 'label', 'Component quantities valid',
      'passed', v_summary.preview_status NOT IN ('self_reference_error', 'missing_component'), 'required', true, 'warning', false
    ),
    jsonb_build_object(
      'key', 'virtual_availability_ok', 'label', 'Virtual availability calculation succeeds',
      'passed', COALESCE(v_sim->>'ok', 'false')::boolean AND v_sim->>'virtual_availability' IS NOT NULL,
      'required', true, 'warning', false
    ),
    jsonb_build_object(
      'key', 'independent_stock_acknowledged', 'label', 'Independent stock acknowledged (if applicable)',
      'passed', NOT COALESCE(v_summary.has_independent_stock_warning, false)
        OR COALESCE(v_vs.independent_stock_acknowledged, false),
      'required', COALESCE(v_summary.has_independent_stock_warning, false), 'warning', false
    ),
    jsonb_build_object(
      'key', 'shadow_evidence_present', 'label', 'Shadow evidence recorded (if shadow mode used)',
      'passed', NOT v_shadow_used OR v_shadow_count > 0,
      'required', v_shadow_used, 'warning', false
    ),
    jsonb_build_object(
      'key', 'no_recent_shortage_shadow', 'label', 'No shortage shadow events',
      'passed', v_shortage_count = 0, 'required', false, 'warning', v_shortage_count > 0
    ),
    jsonb_build_object(
      'key', 'virtual_enabled', 'label', 'Virtual bundle enabled',
      'passed', COALESCE(v_vs.is_virtual_enabled, false), 'required', true, 'warning', false
    )
  );

  IF NOT p_for_live_request THEN
    v_checklist := v_checklist || jsonb_build_array(
      jsonb_build_object(
        'key', 'global_allows_live', 'label', 'Global per-bundle live allowed',
        'passed', v_allow_live, 'required', true, 'warning', false
      ),
      jsonb_build_object(
        'key', 'global_mode_live', 'label', 'Global mode is live',
        'passed', v_global_mode = 'live', 'required', true, 'warning', false
      ),
      jsonb_build_object(
        'key', 'bundle_mode_live', 'label', 'Bundle mode is live',
        'passed', COALESCE(v_vs.mode, 'preview_only') = 'live', 'required', true, 'warning', false
      )
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
    WHERE (elem->>'required')::boolean
      AND NOT (elem->>'passed')::boolean
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
    'live_deduction_enabled', public.is_bundle_live_deduction_enabled(p_bundle_variant_id),
    'shadow_event_count', v_shadow_count,
    'shortage_shadow_count', v_shortage_count,
    'shadow_mode_was_used', v_shadow_used
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_bundle_live_readiness TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.acknowledge_independent_bundle_stock(
  p_bundle_variant_id uuid,
  p_note                text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_has_warning boolean := false;
  v_eval jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001'; END IF;

  SELECT COALESCE(s.has_independent_stock_warning, false) INTO v_has_warning
  FROM public.v_inventory_bundle_summary_preview s
  WHERE s.bundle_variant_id = p_bundle_variant_id;

  IF NOT v_has_warning THEN
    RAISE EXCEPTION 'Bundle has no independent stock warning to acknowledge' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.inventory_bundle_variant_settings (bundle_variant_id, independent_stock_acknowledged)
  VALUES (p_bundle_variant_id, true)
  ON CONFLICT (bundle_variant_id) DO UPDATE SET
    independent_stock_acknowledged = true,
    independent_stock_acknowledged_at = now(),
    independent_stock_acknowledged_by = v_actor,
    independent_stock_ack_note = NULLIF(BTRIM(p_note), ''),
    updated_at = now();

  v_eval := public.evaluate_bundle_live_readiness(p_bundle_variant_id, true);

  PERFORM public.log_inventory_bundle_live_readiness_action(
    p_bundle_variant_id, 'independent_stock_acknowledged', p_note, v_eval
  );

  RETURN jsonb_build_object('ok', true, 'readiness', v_eval);
END;
$$;

GRANT EXECUTE ON FUNCTION public.acknowledge_independent_bundle_stock TO authenticated;

CREATE OR REPLACE FUNCTION public.request_bundle_live_enablement(
  p_bundle_variant_id uuid,
  p_note                text DEFAULT NULL
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

  v_eval := public.evaluate_bundle_live_readiness(p_bundle_variant_id, true);

  IF NOT COALESCE((v_eval->>'is_ready_for_live_request')::boolean, false) THEN
    RAISE EXCEPTION 'Live request blocked: %', v_eval->'blocker_reasons' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.inventory_bundle_variant_settings (
    bundle_variant_id, is_virtual_enabled, mode,
    live_requested_at, live_requested_by, live_request_note, live_ready_acknowledged
  ) VALUES (
    p_bundle_variant_id, true, 'live_requested',
    now(), v_actor, NULLIF(BTRIM(p_note), ''), true
  )
  ON CONFLICT (bundle_variant_id) DO UPDATE SET
    is_virtual_enabled = true,
    mode = 'live_requested',
    live_requested_at = now(),
    live_requested_by = v_actor,
    live_request_note = NULLIF(BTRIM(p_note), ''),
    live_ready_acknowledged = true,
    updated_at = now();

  PERFORM public.log_inventory_bundle_live_readiness_action(
    p_bundle_variant_id, 'live_requested', p_note, v_eval
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bundle_mode', 'live_requested',
    'readiness', v_eval,
    'message', 'Live requested — no inventory behavior changes until Phase 10F live wiring is deployed.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_bundle_live_enablement TO authenticated;

CREATE OR REPLACE FUNCTION public.set_inventory_bundle_allow_per_bundle_live(p_allow boolean)
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

  UPDATE public.inventory_bundle_settings
  SET allow_per_bundle_live = COALESCE(p_allow, false), updated_at = now()
  WHERE setting_key = 'global';

  RETURN jsonb_build_object('ok', true, 'allow_per_bundle_live', COALESCE(p_allow, false));
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_inventory_bundle_allow_per_bundle_live TO authenticated;

CREATE OR REPLACE FUNCTION public.enable_bundle_virtual_flag(p_bundle_variant_id uuid)
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

  INSERT INTO public.inventory_bundle_variant_settings (bundle_variant_id, is_virtual_enabled)
  VALUES (p_bundle_variant_id, true)
  ON CONFLICT (bundle_variant_id) DO UPDATE SET
    is_virtual_enabled = true, updated_at = now();

  PERFORM public.log_inventory_bundle_live_readiness_action(
    p_bundle_variant_id, 'virtual_enabled', NULL,
    public.evaluate_bundle_live_readiness(p_bundle_variant_id, true)
  );

  RETURN jsonb_build_object('ok', true, 'is_virtual_enabled', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enable_bundle_virtual_flag TO authenticated;
