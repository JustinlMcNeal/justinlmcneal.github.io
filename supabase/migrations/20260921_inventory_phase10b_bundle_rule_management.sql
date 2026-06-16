-- Phase 10B — Bundle rule management polish + config audit.
-- Configuration/preview only. No checkout, stock, reservation, ledger, or sync changes.

CREATE TABLE IF NOT EXISTS public.inventory_bundle_rule_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type           text NOT NULL
                        CHECK (action_type IN ('create', 'update', 'disable', 'delete')),
  rule_id               uuid,
  bundle_variant_id     uuid,
  component_variant_id  uuid,
  old_values            jsonb,
  new_values            jsonb,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_bundle_rule_actions IS
  'Audit log for bundle rule configuration changes (Phase 10B). Workflow/config only.';

CREATE INDEX IF NOT EXISTS idx_bundle_rule_actions_bundle
  ON public.inventory_bundle_rule_actions (bundle_variant_id);

CREATE INDEX IF NOT EXISTS idx_bundle_rule_actions_created
  ON public.inventory_bundle_rule_actions (created_at DESC);

ALTER TABLE public.inventory_bundle_rule_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_bundle_rule_actions_service_role_all
  ON public.inventory_bundle_rule_actions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_bundle_rule_actions_authenticated_select
  ON public.inventory_bundle_rule_actions FOR SELECT TO authenticated USING (true);

CREATE POLICY inventory_bundle_rule_actions_authenticated_insert
  ON public.inventory_bundle_rule_actions FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON public.inventory_bundle_rule_actions TO authenticated;
GRANT ALL ON public.inventory_bundle_rule_actions TO service_role;

CREATE OR REPLACE FUNCTION public.log_inventory_bundle_rule_action(
  p_action_type          text,
  p_rule_id              uuid,
  p_bundle_variant_id    uuid,
  p_component_variant_id uuid,
  p_old_values           jsonb DEFAULT NULL,
  p_new_values           jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.inventory_bundle_rule_actions (
    action_type, rule_id, bundle_variant_id, component_variant_id,
    old_values, new_values, created_by
  ) VALUES (
    p_action_type, p_rule_id, p_bundle_variant_id, p_component_variant_id,
    p_old_values, p_new_values, auth.uid()
  );
END;
$$;

-- Enhanced summary preview with stocked vs virtual comparison fields.
CREATE OR REPLACE VIEW public.v_inventory_bundle_summary_preview AS
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
active_rules AS (
  SELECT
    bundle_variant_id,
    COUNT(*) FILTER (WHERE is_active) AS active_rule_count,
    COUNT(*) AS total_rule_count
  FROM public.inventory_bundle_rules
  GROUP BY bundle_variant_id
),
virtual_avail AS (
  SELECT
    p.bundle_variant_id,
    MIN(p.max_bundle_available_from_component) FILTER (
      WHERE p.is_active AND p.preview_status IN ('ready', 'component_shortage')
    )::integer AS virtual_bundle_available,
    BOOL_OR(p.preview_status = 'component_shortage' AND p.is_active) AS has_component_shortage,
    BOOL_OR(p.preview_status = 'missing_component' AND p.is_active) AS has_missing_component,
    BOOL_OR(p.preview_status = 'self_reference_error') AS has_self_reference,
    BOOL_OR(p.preview_status = 'inactive_rule') AS has_inactive_rules
  FROM public.v_inventory_bundle_availability_preview p
  GROUP BY p.bundle_variant_id
),
bundle_heads AS (
  SELECT DISTINCT bundle_variant_id FROM public.inventory_bundle_rules
  UNION
  SELECT variant_id FROM public.v_inventory_bundle_like_variants
)
SELECT
  bh.bundle_variant_id,
  COALESCE(NULLIF(BTRIM(p.name), ''), 'Unknown') AS bundle_label,
  COALESCE(NULLIF(BTRIM(pv.sku), ''), NULLIF(BTRIM(pv.title), ''), pv.option_value, '—') AS bundle_sku,
  COALESCE(pv.stock, 0) AS bundle_on_hand,
  CASE
    WHEN COALESCE(ar.active_rule_count, 0) > 0 THEN 'model_b_virtual_preview'
    ELSE 'model_a_separate_stocked'
  END AS current_model,
  COALESCE(ar.active_rule_count, 0)::integer AS component_count,
  va.virtual_bundle_available,
  (
    SELECT p2.component_product_label
    FROM public.v_inventory_bundle_availability_preview p2
    WHERE p2.bundle_variant_id = bh.bundle_variant_id
      AND p2.is_active
      AND p2.limiting_component = true
    LIMIT 1
  ) AS limiting_component_label,
  CASE
    WHEN COALESCE(va.has_self_reference, false) THEN
      'Preview: self-reference rule detected — fix configuration'
    WHEN COALESCE(va.has_missing_component, false) THEN
      'Preview: missing or inactive component variant'
    WHEN COALESCE(ar.active_rule_count, 0) = 0 THEN
      'Separate stocked SKU (Model A default) — no virtual rules configured'
    WHEN COALESCE(ar.active_rule_count, 0) > 0 AND COALESCE(pv.stock, 0) > 0 THEN
      'Warning: bundle has independent stock AND virtual rules — preview only until Phase 10C cutover'
    WHEN COALESCE(va.has_component_shortage, false) OR COALESCE(va.virtual_bundle_available, 0) <= 0 THEN
      'Preview: component shortage would limit virtual bundle availability'
    WHEN va.virtual_bundle_available IS NOT NULL
      AND va.virtual_bundle_available <> (COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0)) THEN
      'Preview: virtual availability differs from current bundle available (not live yet)'
    ELSE
      'Preview: virtual availability computed from components (not live)'
  END AS preview_warning,
  COALESCE(bl.detection_reason, 'configured_rule') AS detection_reason,
  COALESCE(bl.on_ebay, false) AS on_ebay,
  COALESCE(bl.on_amazon, false) AS on_amazon,
  COALESCE(vr.reserved_qty, 0) AS bundle_reserved,
  COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0) AS bundle_available,
  CASE
    WHEN COALESCE(va.has_self_reference, false) THEN 'self_reference_error'
    WHEN COALESCE(va.has_missing_component, false) THEN 'missing_component'
    WHEN COALESCE(ar.active_rule_count, 0) = 0 THEN 'no_rules'
    WHEN COALESCE(va.has_component_shortage, false) OR COALESCE(va.virtual_bundle_available, 0) <= 0 THEN 'component_shortage'
    WHEN COALESCE(va.has_inactive_rules, false) AND COALESCE(ar.active_rule_count, 0) = 0 THEN 'inactive_rule'
    ELSE 'ready'
  END AS preview_status,
  (COALESCE(ar.active_rule_count, 0) > 0 AND COALESCE(pv.stock, 0) > 0) AS has_independent_stock_warning,
  CASE
    WHEN va.virtual_bundle_available IS NULL THEN NULL
    ELSE va.virtual_bundle_available - (COALESCE(pv.stock, 0) - COALESCE(vr.reserved_qty, 0))
  END AS virtual_vs_stocked_delta
FROM bundle_heads bh
JOIN public.product_variants pv ON pv.id = bh.bundle_variant_id
JOIN public.products p ON p.id = pv.product_id
LEFT JOIN variant_reserved vr ON vr.variant_id = bh.bundle_variant_id
LEFT JOIN active_rules ar ON ar.bundle_variant_id = bh.bundle_variant_id
LEFT JOIN virtual_avail va ON va.bundle_variant_id = bh.bundle_variant_id
LEFT JOIN public.v_inventory_bundle_like_variants bl ON bl.variant_id = bh.bundle_variant_id;

COMMENT ON VIEW public.v_inventory_bundle_summary_preview IS
  'Bundle summary preview with stocked vs virtual comparison (Phase 10B).';

-- Replace upsert with audit logging.
CREATE OR REPLACE FUNCTION public.upsert_inventory_bundle_rule(
  p_bundle_variant_id    uuid,
  p_component_variant_id uuid,
  p_component_qty        numeric,
  p_rule_type            text DEFAULT 'virtual_bundle',
  p_is_active            boolean DEFAULT true,
  p_notes                text DEFAULT NULL,
  p_rule_id              uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_is_admin boolean := false;
  v_id       uuid;
  v_old      jsonb;
  v_action   text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_bundle_variant_id = p_component_variant_id THEN
    RAISE EXCEPTION 'Bundle and component must differ' USING ERRCODE = 'P0001';
  END IF;

  IF p_component_qty IS NULL OR p_component_qty <= 0 THEN
    RAISE EXCEPTION 'component_qty must be positive' USING ERRCODE = 'P0001';
  END IF;

  IF p_rule_type NOT IN ('virtual_bundle', 'separate_stocked') THEN
    RAISE EXCEPTION 'Invalid rule_type' USING ERRCODE = 'P0001';
  END IF;

  IF p_rule_id IS NOT NULL THEN
    SELECT to_jsonb(r) INTO v_old
    FROM public.inventory_bundle_rules r WHERE r.id = p_rule_id;

    UPDATE public.inventory_bundle_rules
    SET
      bundle_variant_id = p_bundle_variant_id,
      component_variant_id = p_component_variant_id,
      component_qty = p_component_qty,
      rule_type = p_rule_type,
      is_active = COALESCE(p_is_active, true),
      notes = p_notes,
      updated_at = now()
    WHERE id = p_rule_id
    RETURNING id INTO v_id;

    v_action := 'update';
  ELSE
    SELECT to_jsonb(r) INTO v_old
    FROM public.inventory_bundle_rules r
    WHERE r.bundle_variant_id = p_bundle_variant_id
      AND r.component_variant_id = p_component_variant_id;

    INSERT INTO public.inventory_bundle_rules (
      bundle_variant_id, component_variant_id, component_qty,
      rule_type, is_active, notes, created_by
    ) VALUES (
      p_bundle_variant_id, p_component_variant_id, p_component_qty,
      p_rule_type, COALESCE(p_is_active, true), p_notes, v_actor
    )
    ON CONFLICT ON CONSTRAINT inventory_bundle_rules_unique_component
    DO UPDATE SET
      component_qty = EXCLUDED.component_qty,
      rule_type = EXCLUDED.rule_type,
      is_active = EXCLUDED.is_active,
      notes = EXCLUDED.notes,
      updated_at = now()
    RETURNING id INTO v_id;

    v_action := CASE WHEN v_old IS NULL THEN 'create' ELSE 'update' END;
  END IF;

  PERFORM public.log_inventory_bundle_rule_action(
    v_action,
    v_id,
    p_bundle_variant_id,
    p_component_variant_id,
    v_old,
    jsonb_build_object(
      'component_qty', p_component_qty,
      'rule_type', p_rule_type,
      'is_active', COALESCE(p_is_active, true),
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object('ok', true, 'rule_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_inventory_bundle_rule_active(
  p_rule_id   uuid,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_is_admin boolean := false;
  v_old      jsonb;
  v_row      public.inventory_bundle_rules%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.inventory_bundle_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rule not found' USING ERRCODE = 'P0001';
  END IF;

  v_old := to_jsonb(v_row);

  UPDATE public.inventory_bundle_rules
  SET is_active = p_is_active, updated_at = now()
  WHERE id = p_rule_id;

  PERFORM public.log_inventory_bundle_rule_action(
    CASE WHEN p_is_active THEN 'update' ELSE 'disable' END,
    p_rule_id,
    v_row.bundle_variant_id,
    v_row.component_variant_id,
    v_old,
    jsonb_build_object('is_active', p_is_active)
  );

  RETURN jsonb_build_object('ok', true, 'rule_id', p_rule_id, 'is_active', p_is_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_inventory_bundle_rule(p_rule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_is_admin boolean := false;
  v_old      jsonb;
  v_row      public.inventory_bundle_rules%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.inventory_bundle_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rule not found' USING ERRCODE = 'P0001';
  END IF;

  v_old := to_jsonb(v_row);

  DELETE FROM public.inventory_bundle_rules WHERE id = p_rule_id;

  PERFORM public.log_inventory_bundle_rule_action(
    'delete',
    p_rule_id,
    v_row.bundle_variant_id,
    v_row.component_variant_id,
    v_old,
    NULL
  );

  RETURN jsonb_build_object('ok', true, 'rule_id', p_rule_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_inventory_bundle_rule_active TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_inventory_bundle_rule TO authenticated;
