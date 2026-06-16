-- Phase 10E part B — readiness view (requires evaluate_bundle_live_readiness from part A).

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
    e.bundle_variant_id,
    COUNT(*)::integer AS shadow_event_count,
    COUNT(*) FILTER (WHERE e.event_type = 'checkout_simulation')::integer AS simulation_count,
    COUNT(*) FILTER (WHERE e.event_type = 'reservation_shadow')::integer AS reservation_shadow_count,
    COUNT(*) FILTER (WHERE e.event_type = 'finalize_shadow')::integer AS finalize_shadow_count,
    COUNT(*) FILTER (
      WHERE COALESCE(e.simulation_result->>'result', '') = 'component_shortage'
    )::integer AS shortage_shadow_count,
    MAX(e.created_at) AS last_shadow_event_at,
    (ARRAY_AGG(e.simulation_result->>'result' ORDER BY e.created_at DESC))[1] AS last_shadow_result
  FROM public.inventory_bundle_shadow_events e
  GROUP BY e.bundle_variant_id
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
  COALESCE(vs.is_virtual_enabled, false) AS is_virtual_enabled,
  COALESCE(vs.independent_stock_acknowledged, false) AS independent_stock_acknowledged,
  vs.independent_stock_acknowledged_at,
  vs.live_requested_at,
  vs.live_request_note,
  COALESCE(vs.live_ready_acknowledged, false) AS live_ready_acknowledged,
  s.component_count AS component_count,
  (s.component_count > 0) AS has_active_rules,
  (s.preview_status = 'self_reference_error') AS has_self_reference,
  (s.preview_status = 'component_shortage') AS has_component_shortage,
  COALESCE(s.has_independent_stock_warning, false) AS has_independent_stock_warning,
  s.virtual_bundle_available AS virtual_available,
  s.bundle_available AS current_bundle_available,
  COALESCE(ss.shadow_event_count, 0) AS shadow_event_count,
  COALESCE(ss.simulation_count, 0) AS simulation_count,
  COALESCE(ss.reservation_shadow_count, 0) AS reservation_shadow_count,
  COALESCE(ss.finalize_shadow_count, 0) AS finalize_shadow_count,
  COALESCE(ss.shortage_shadow_count, 0) AS shortage_shadow_count,
  ss.last_shadow_event_at,
  ss.last_shadow_result,
  (
    s.component_count > 0
    AND s.preview_status NOT IN ('self_reference_error', 'missing_component')
    AND COALESCE(g.global_mode, 'preview_only') IN ('preview_only', 'shadow')
  ) AS is_ready_for_shadow,
  COALESCE((public.evaluate_bundle_live_readiness(s.bundle_variant_id, true)->>'is_ready_for_live_request')::boolean, false)
    AS is_ready_for_live_request,
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
  public.is_bundle_live_deduction_enabled(s.bundle_variant_id) AS live_deduction_enabled,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN s.component_count = 0 THEN 'no_active_rules' END,
    CASE WHEN s.preview_status = 'self_reference_error' THEN 'self_reference' END,
    CASE WHEN s.preview_status = 'missing_component' THEN 'missing_component' END,
    CASE WHEN s.preview_status = 'component_shortage' THEN 'component_shortage' END,
    CASE WHEN COALESCE(s.has_independent_stock_warning, false)
      AND NOT COALESCE(vs.independent_stock_acknowledged, false) THEN 'independent_stock_not_acknowledged' END,
    CASE WHEN (
      COALESCE(g.global_mode, 'preview_only') = 'shadow'
      OR (COALESCE(vs.is_virtual_enabled, false) AND COALESCE(vs.mode, 'preview_only') = 'shadow')
    ) AND COALESCE(ss.shadow_event_count, 0) = 0 THEN 'no_shadow_evidence' END,
    CASE WHEN NOT COALESCE(vs.is_virtual_enabled, false) THEN 'bundle_virtual_not_enabled' END,
    CASE WHEN COALESCE(g.global_mode, 'preview_only') <> 'live' THEN 'global_mode_not_live' END,
    CASE WHEN NOT COALESCE(g.allow_per_bundle_live, false) THEN 'per_bundle_live_disabled' END,
    CASE WHEN COALESCE(vs.mode, 'preview_only') NOT IN ('live', 'live_requested') THEN 'bundle_not_live_or_requested' END
  ], NULL) AS blocker_reasons
FROM public.v_inventory_bundle_summary_preview s
JOIN bundle_base bb ON bb.bundle_variant_id = s.bundle_variant_id
CROSS JOIN global_cfg g
LEFT JOIN public.inventory_bundle_variant_settings vs ON vs.bundle_variant_id = s.bundle_variant_id
LEFT JOIN shadow_stats ss ON ss.bundle_variant_id = s.bundle_variant_id;

COMMENT ON VIEW public.v_inventory_bundle_cutover_readiness IS
  'Phase 10E: live readiness checklist + shadow evidence (live deduction still disabled).';

GRANT SELECT ON public.v_inventory_bundle_cutover_readiness TO authenticated, service_role;
