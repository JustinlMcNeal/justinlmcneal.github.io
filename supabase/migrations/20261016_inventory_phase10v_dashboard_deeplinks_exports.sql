-- Phase 10V — Returns/restock dashboard metrics (read-only reporting).

CREATE OR REPLACE VIEW public.v_inventory_returns_restock_dashboard_metrics AS
WITH restock_stats AS (
  SELECT
    COUNT(*) FILTER (WHERE ra.created_at > now() - interval '7 days')::integer AS restocks_7d,
    COUNT(*) FILTER (WHERE ra.created_at > now() - interval '30 days')::integer AS restocks_30d,
    COALESCE(SUM(ra.restock_qty) FILTER (WHERE ra.created_at > now() - interval '7 days'), 0)::integer
      AS qty_restocked_7d,
    COALESCE(SUM(ra.restock_qty) FILTER (WHERE ra.created_at > now() - interval '30 days'), 0)::integer
      AS qty_restocked_30d
  FROM public.inventory_bundle_component_restock_actions ra
  WHERE ra.status = 'applied'
),
followup_stats AS (
  SELECT
    COUNT(*) FILTER (
      WHERE COALESCE(fs.status, 'open') = 'open'
        AND fc.followup_status IN ('needs_channel_review', 'needs_amazon_review', 'needs_ebay_review')
    )::integer AS open_followups,
    COUNT(*) FILTER (
      WHERE fs.status IN ('reviewed', 'sync_completed', 'sync_not_needed', 'dismissed')
    )::integer AS completed_followups
  FROM public.v_inventory_restock_followup_candidates fc
  LEFT JOIN public.inventory_restock_followup_states fs ON fs.restock_action_id = fc.restock_action_id
  WHERE fc.restock_created_at > now() - interval '30 days'
),
followup_timing AS (
  SELECT
    ROUND(
      AVG(EXTRACT(EPOCH FROM (fs.updated_at - fc.restock_created_at)) / 3600.0)::numeric,
      2
    ) AS avg_hours_restock_to_followup_completion
  FROM public.v_inventory_restock_followup_candidates fc
  JOIN public.inventory_restock_followup_states fs ON fs.restock_action_id = fc.restock_action_id
  WHERE fs.status IN ('reviewed', 'sync_completed', 'sync_not_needed')
    AND fs.updated_at > fc.restock_created_at
    AND fc.restock_created_at > now() - interval '90 days'
)
SELECT
  rs.restocks_7d,
  rs.restocks_30d,
  rs.qty_restocked_7d,
  rs.qty_restocked_30d,
  fs.open_followups,
  fs.completed_followups,
  ft.avg_hours_restock_to_followup_completion,
  (SELECT stale_observations FROM public.v_inventory_returns_restock_dashboard_summary) AS stale_observation_count,
  (SELECT blocked_manual_review FROM public.v_inventory_returns_restock_dashboard_summary) AS manual_review_count
FROM restock_stats rs
CROSS JOIN followup_stats fs
CROSS JOIN followup_timing ft;

COMMENT ON VIEW public.v_inventory_returns_restock_dashboard_metrics IS
  'Phase 10V: read-only restock/follow-up metrics for returns dashboard export reporting.';

GRANT SELECT ON public.v_inventory_returns_restock_dashboard_metrics TO authenticated, service_role;
