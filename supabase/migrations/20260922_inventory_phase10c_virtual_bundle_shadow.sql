-- Phase 10C — Virtual bundle cutover simulation + shadow mode.
-- Read-only simulation. No checkout, stock, reservation, ledger, or channel sync changes.

CREATE TABLE IF NOT EXISTS public.inventory_bundle_settings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key             text NOT NULL UNIQUE DEFAULT 'global',
  virtual_bundle_mode     text NOT NULL DEFAULT 'preview_only'
                          CHECK (virtual_bundle_mode IN ('preview_only', 'shadow', 'live')),
  allow_per_bundle_live   boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_bundle_settings IS
  'Global virtual bundle mode (Phase 10C). Default preview_only — no live deduction in 10C.';

INSERT INTO public.inventory_bundle_settings (setting_key, virtual_bundle_mode, allow_per_bundle_live)
VALUES ('global', 'preview_only', false)
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.inventory_bundle_variant_settings (
  bundle_variant_id               uuid PRIMARY KEY
                                  REFERENCES public.product_variants(id) ON DELETE CASCADE,
  is_virtual_enabled              boolean NOT NULL DEFAULT false,
  mode                            text NOT NULL DEFAULT 'preview_only'
                                  CHECK (mode IN ('preview_only', 'shadow', 'live')),
  independent_stock_acknowledged  boolean NOT NULL DEFAULT false,
  notes                           text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_bundle_variant_settings IS
  'Per-bundle virtual mode overrides (Phase 10C). Default preview_only.';

CREATE TABLE IF NOT EXISTS public.inventory_bundle_shadow_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type            text NOT NULL
                        CHECK (event_type IN ('checkout_simulation', 'reservation_shadow', 'finalize_shadow')),
  bundle_variant_id     uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity              numeric(12, 4) NOT NULL,
  source_order_id       text,
  source_order_item_id  text,
  simulation_result     jsonb NOT NULL,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_bundle_shadow_events_qty_positive CHECK (quantity > 0)
);

COMMENT ON TABLE public.inventory_bundle_shadow_events IS
  'Admin-recorded bundle simulation/shadow events (Phase 10C). No inventory side effects.';

CREATE INDEX IF NOT EXISTS idx_bundle_shadow_events_bundle
  ON public.inventory_bundle_shadow_events (bundle_variant_id);

CREATE INDEX IF NOT EXISTS idx_bundle_shadow_events_created
  ON public.inventory_bundle_shadow_events (created_at DESC);

ALTER TABLE public.inventory_bundle_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_bundle_variant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_bundle_shadow_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_bundle_settings_service_role_all
  ON public.inventory_bundle_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_bundle_settings_authenticated_select
  ON public.inventory_bundle_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_bundle_settings_authenticated_update
  ON public.inventory_bundle_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY inventory_bundle_variant_settings_service_role_all
  ON public.inventory_bundle_variant_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_bundle_variant_settings_authenticated_select
  ON public.inventory_bundle_variant_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_bundle_variant_settings_authenticated_insert
  ON public.inventory_bundle_variant_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY inventory_bundle_variant_settings_authenticated_update
  ON public.inventory_bundle_variant_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY inventory_bundle_shadow_events_service_role_all
  ON public.inventory_bundle_shadow_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_bundle_shadow_events_authenticated_select
  ON public.inventory_bundle_shadow_events FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_bundle_shadow_events_authenticated_insert
  ON public.inventory_bundle_shadow_events FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, UPDATE ON public.inventory_bundle_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inventory_bundle_variant_settings TO authenticated;
GRANT SELECT, INSERT ON public.inventory_bundle_shadow_events TO authenticated;
GRANT ALL ON public.inventory_bundle_settings TO service_role;
GRANT ALL ON public.inventory_bundle_variant_settings TO service_role;
GRANT ALL ON public.inventory_bundle_shadow_events TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_bundle_settings_set_updated_at') THEN
    CREATE TRIGGER inventory_bundle_settings_set_updated_at
      BEFORE UPDATE ON public.inventory_bundle_settings
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_bundle_variant_settings_set_updated_at') THEN
    CREATE TRIGGER inventory_bundle_variant_settings_set_updated_at
      BEFORE UPDATE ON public.inventory_bundle_variant_settings
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- Read-only virtual bundle order simulation (no writes).
CREATE OR REPLACE FUNCTION public.simulate_virtual_bundle_order(
  p_bundle_variant_id uuid,
  p_quantity            numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty                 numeric;
  v_global_mode         text := 'preview_only';
  v_bundle_mode         text := 'preview_only';
  v_bundle_label        text;
  v_bundle_sku          text;
  v_on_hand             integer := 0;
  v_reserved            integer := 0;
  v_available           integer := 0;
  v_virtual_avail       integer;
  v_rule_count          integer := 0;
  v_self_ref            boolean := false;
  v_missing_component   boolean := false;
  v_any_shortage        boolean := false;
  v_independent_warning boolean := false;
  v_can_fulfill         boolean := true;
  v_result              text := 'can_fulfill_virtual';
  v_components          jsonb := '[]'::jsonb;
  v_res_preview         jsonb := '[]'::jsonb;
  v_ledger_preview      jsonb := '[]'::jsonb;
BEGIN
  v_qty := COALESCE(p_quantity, 0);
  IF p_bundle_variant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bundle_variant_id required');
  END IF;
  IF v_qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quantity must be positive');
  END IF;

  SELECT COALESCE(s.virtual_bundle_mode, 'preview_only')
  INTO v_global_mode
  FROM public.inventory_bundle_settings s
  WHERE s.setting_key = 'global';

  SELECT
    COALESCE(vs.mode, 'preview_only'),
    COALESCE(p.name, 'Unknown'),
    COALESCE(NULLIF(BTRIM(pv.sku), ''), NULLIF(BTRIM(pv.title), ''), pv.option_value, '—'),
    COALESCE(pv.stock, 0),
    COALESCE(vr.reserved_qty, 0),
    COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0)
  INTO v_bundle_mode, v_bundle_label, v_bundle_sku, v_on_hand, v_reserved, v_available
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  LEFT JOIN public.inventory_bundle_variant_settings vs ON vs.bundle_variant_id = pv.id
  LEFT JOIN (
    SELECT ir.variant_id, COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
    FROM public.inventory_reservations ir
    WHERE ir.status = 'reserved' AND ir.variant_id IS NOT NULL
      AND COALESCE(ir.is_shadow, false) = false
    GROUP BY ir.variant_id
  ) vr ON vr.variant_id = pv.id
  WHERE pv.id = p_bundle_variant_id;

  IF v_bundle_label IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bundle variant not found');
  END IF;

  SELECT COUNT(*)::integer, BOOL_OR(bundle_variant_id = component_variant_id)
  INTO v_rule_count, v_self_ref
  FROM public.inventory_bundle_rules
  WHERE bundle_variant_id = p_bundle_variant_id AND is_active;

  IF v_self_ref THEN
    RETURN jsonb_build_object(
      'ok', true,
      'simulation_only', true,
      'bundle_variant_id', p_bundle_variant_id,
      'bundle_label', v_bundle_label,
      'bundle_sku', v_bundle_sku,
      'requested_quantity', v_qty,
      'bundle_on_hand', v_on_hand,
      'bundle_reserved', v_reserved,
      'bundle_available', v_available,
      'virtual_availability', NULL,
      'global_mode', v_global_mode,
      'bundle_mode', v_bundle_mode,
      'result', 'self_reference_error',
      'can_fulfill_virtual', false,
      'component_shortage', false,
      'missing_rules', false,
      'self_reference_error', true,
      'independent_stock_warning', false,
      'components', '[]'::jsonb,
      'preview_reservations', '[]'::jsonb,
      'preview_ledger', '[]'::jsonb
    );
  END IF;

  IF v_rule_count = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'simulation_only', true,
      'bundle_variant_id', p_bundle_variant_id,
      'bundle_label', v_bundle_label,
      'bundle_sku', v_bundle_sku,
      'requested_quantity', v_qty,
      'bundle_on_hand', v_on_hand,
      'bundle_reserved', v_reserved,
      'bundle_available', v_available,
      'virtual_availability', NULL,
      'global_mode', v_global_mode,
      'bundle_mode', v_bundle_mode,
      'result', 'missing_rules',
      'can_fulfill_virtual', false,
      'component_shortage', false,
      'missing_rules', true,
      'self_reference_error', false,
      'independent_stock_warning', v_on_hand > 0,
      'components', '[]'::jsonb,
      'preview_reservations', '[]'::jsonb,
      'preview_ledger', '[]'::jsonb
    );
  END IF;

  v_independent_warning := v_on_hand > 0;

  WITH variant_reserved AS (
    SELECT ir.variant_id, COALESCE(SUM(ir.quantity), 0)::integer AS reserved_qty
    FROM public.inventory_reservations ir
    WHERE ir.status = 'reserved' AND ir.variant_id IS NOT NULL
      AND COALESCE(ir.is_shadow, false) = false
    GROUP BY ir.variant_id
  ),
  variant_levels AS (
    SELECT
      pv.id AS variant_id,
      COALESCE(NULLIF(BTRIM(pv.sku), ''), NULLIF(BTRIM(pv.title), ''), NULLIF(BTRIM(pv.option_value), ''), '—') AS sku_label,
      COALESCE(pv.stock, 0) AS on_hand,
      COALESCE(vr.reserved_qty, 0) AS reserved,
      COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0) AS available,
      COALESCE(pv.is_active, true) AS is_active
    FROM public.product_variants pv
    LEFT JOIN variant_reserved vr ON vr.variant_id = pv.id
  ),
  rule_rows AS (
    SELECT
      br.component_variant_id,
      cv.sku_label AS component_sku,
      cv.available AS component_available,
      br.component_qty::numeric AS component_qty,
      (v_qty * br.component_qty)::numeric AS required_qty,
      GREATEST(0::numeric, (v_qty * br.component_qty) - cv.available) AS shortage_qty,
      CASE
        WHEN cv.variant_id IS NULL OR cv.is_active = false THEN true
        ELSE false
      END AS is_missing,
      FLOOR(GREATEST(cv.available, 0) / NULLIF(br.component_qty, 0))::integer AS max_bundles_from_component
    FROM public.inventory_bundle_rules br
    LEFT JOIN variant_levels cv ON cv.variant_id = br.component_variant_id
    WHERE br.bundle_variant_id = p_bundle_variant_id AND br.is_active
  ),
  agg AS (
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'component_variant_id', rr.component_variant_id,
        'component_sku', rr.component_sku,
        'component_available', rr.component_available,
        'component_qty_per_bundle', rr.component_qty,
        'required_qty', rr.required_qty,
        'shortage_qty', rr.shortage_qty,
        'would_reserve_qty', CASE WHEN rr.shortage_qty <= 0 THEN rr.required_qty ELSE 0 END,
        'would_finalize_qty', CASE WHEN rr.shortage_qty <= 0 THEN rr.required_qty ELSE 0 END,
        'is_missing', rr.is_missing
      ) ORDER BY rr.component_sku), '[]'::jsonb) AS components,
      BOOL_OR(rr.is_missing) AS any_missing,
      BOOL_OR(rr.shortage_qty > 0) AS any_shortage,
      MIN(rr.max_bundles_from_component) AS virtual_avail
    FROM rule_rows rr
  )
  SELECT a.components, a.any_missing, a.any_shortage, a.virtual_avail
  INTO v_components, v_missing_component, v_any_shortage, v_virtual_avail
  FROM agg a;

  v_can_fulfill := NOT COALESCE(v_missing_component, false)
    AND NOT COALESCE(v_any_shortage, false)
    AND v_qty <= COALESCE(v_virtual_avail, 0);

  IF v_missing_component THEN
    v_result := 'missing_component';
    v_can_fulfill := false;
  ELSIF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_components) elem
    WHERE (elem->>'shortage_qty')::numeric > 0
  ) THEN
    v_result := 'component_shortage';
    v_can_fulfill := false;
  ELSIF v_independent_warning THEN
    v_result := 'independent_stock_warning';
  ELSE
    v_result := 'can_fulfill_virtual';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'variant_id', elem->>'component_variant_id',
    'quantity', (elem->>'would_reserve_qty')::numeric,
    'status', 'reserved',
    'role', 'component',
    'bundle_variant_id', p_bundle_variant_id,
    'preview_only', true
  )), '[]'::jsonb)
  INTO v_res_preview
  FROM jsonb_array_elements(v_components) elem
  WHERE (elem->>'would_reserve_qty')::numeric > 0;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'variant_id', elem->>'component_variant_id',
    'change', -((elem->>'would_finalize_qty')::numeric),
    'reason', 'order_finalized_preview',
    'role', 'component',
    'bundle_variant_id', p_bundle_variant_id,
    'preview_only', true
  )), '[]'::jsonb)
  INTO v_ledger_preview
  FROM jsonb_array_elements(v_components) elem
  WHERE (elem->>'would_finalize_qty')::numeric > 0;

  RETURN jsonb_build_object(
    'ok', true,
    'simulation_only', true,
    'bundle_variant_id', p_bundle_variant_id,
    'bundle_label', v_bundle_label,
    'bundle_sku', v_bundle_sku,
    'requested_quantity', v_qty,
    'bundle_on_hand', v_on_hand,
    'bundle_reserved', v_reserved,
    'bundle_available', v_available,
    'virtual_availability', v_virtual_avail,
    'global_mode', v_global_mode,
    'bundle_mode', v_bundle_mode,
    'result', v_result,
    'can_fulfill_virtual', v_can_fulfill,
    'component_shortage', v_result = 'component_shortage',
    'missing_rules', false,
    'self_reference_error', false,
    'independent_stock_warning', v_independent_warning,
    'components', v_components,
    'preview_reservations', v_res_preview,
    'preview_ledger', v_ledger_preview
  );
END;
$$;

COMMENT ON FUNCTION public.simulate_virtual_bundle_order IS
  'Read-only virtual bundle order simulation (Phase 10C). No stock/reservation/ledger writes.';

GRANT EXECUTE ON FUNCTION public.simulate_virtual_bundle_order TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_inventory_bundle_shadow_event(
  p_event_type            text,
  p_bundle_variant_id     uuid,
  p_quantity              numeric,
  p_simulation_result     jsonb,
  p_source_order_id       text DEFAULT NULL,
  p_source_order_item_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_is_admin boolean := false;
  v_mode     text := 'preview_only';
  v_id       uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_event_type NOT IN ('checkout_simulation', 'reservation_shadow', 'finalize_shadow') THEN
    RAISE EXCEPTION 'Invalid event_type' USING ERRCODE = 'P0001';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(s.virtual_bundle_mode, 'preview_only') INTO v_mode
  FROM public.inventory_bundle_settings s WHERE s.setting_key = 'global';

  IF v_mode = 'live' THEN
    RAISE EXCEPTION 'Live mode not enabled in Phase 10C' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.inventory_bundle_shadow_events (
    event_type, bundle_variant_id, quantity,
    source_order_id, source_order_item_id, simulation_result, created_by
  ) VALUES (
    p_event_type, p_bundle_variant_id, p_quantity,
    p_source_order_id, p_source_order_item_id, p_simulation_result, v_actor
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'shadow_event_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_inventory_bundle_shadow_event TO authenticated;

CREATE OR REPLACE VIEW public.v_inventory_bundle_cutover_readiness AS
WITH global_cfg AS (
  SELECT COALESCE(virtual_bundle_mode, 'preview_only') AS global_mode,
         COALESCE(allow_per_bundle_live, false) AS allow_per_bundle_live
  FROM public.inventory_bundle_settings
  WHERE setting_key = 'global'
  LIMIT 1
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
  s.component_count AS component_count,
  (s.component_count > 0) AS has_active_rules,
  (s.preview_status = 'self_reference_error') AS has_self_reference,
  (s.preview_status = 'component_shortage') AS has_component_shortage,
  COALESCE(s.has_independent_stock_warning, false) AS has_independent_stock_warning,
  COALESCE(vs.independent_stock_acknowledged, false) AS independent_stock_acknowledged,
  s.virtual_bundle_available AS virtual_available,
  s.bundle_available AS current_bundle_available,
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
LEFT JOIN public.inventory_bundle_variant_settings vs ON vs.bundle_variant_id = s.bundle_variant_id;

COMMENT ON VIEW public.v_inventory_bundle_cutover_readiness IS
  'Advisory cutover readiness for virtual bundles (Phase 10C).';

GRANT SELECT ON public.v_inventory_bundle_cutover_readiness TO authenticated, service_role;
