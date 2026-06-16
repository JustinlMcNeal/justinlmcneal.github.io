-- Phase 10W — Returns/restock scheduled digest (read-only reporting; no stock mutations).

CREATE OR REPLACE VIEW public.v_inventory_returns_restock_digest_summary AS
SELECT
  ds.open_return_workflows AS open_returns,
  ds.received_not_restocked,
  ds.ready_to_restock,
  ds.stale_observations,
  ds.open_channel_followups,
  ds.sync_needed_after_restock AS sync_review_suggested,
  ds.blocked_manual_review,
  (
    SELECT COUNT(*)::integer FROM public.inventory_bundle_component_restock_actions ra
    WHERE ra.status = 'applied' AND ra.created_at > now() - interval '24 hours'
  ) AS recent_restocks_24h,
  ds.recent_restocks_count AS recent_restocks_7d,
  ds.recent_restocked_qty AS recent_restocked_qty_7d,
  (
    SELECT COUNT(*)::integer FROM public.v_inventory_restock_followup_candidates fc
    WHERE COALESCE(fc.workflow_status, 'open') = 'open'
      AND fc.followup_status IN ('needs_channel_review', 'needs_amazon_review', 'needs_ebay_review')
      AND fc.restock_created_at < now() - interval '7 days'
  ) AS overdue_followups,
  qs.oldest_stale_observation_age_hours AS oldest_stale_observation_age_hours,
  ds.dashboard_attention_count,
  now() AS generated_at
FROM public.v_inventory_returns_restock_dashboard_summary ds
CROSS JOIN public.v_inventory_marketplace_restock_assist_queue_summary qs;

COMMENT ON VIEW public.v_inventory_returns_restock_digest_summary IS
  'Phase 10W: compact digest KPIs for returns/restock admin notifications.';

GRANT SELECT ON public.v_inventory_returns_restock_digest_summary TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_inventory_returns_restock_digest_items AS
SELECT * FROM (
  SELECT
    'ready_restock'::text AS digest_section,
    w.row_id,
    w.row_type,
    w.priority,
    w.source_channel,
    w.source_order_id,
    w.source_order_item_id,
    w.reservation_id,
    w.restock_action_id,
    w.component_sku,
    w.component_title,
    w.parent_bundle_sku,
    w.parent_bundle_title,
    w.status,
    w.reason,
    w.recommended_action,
    w.is_observation_stale,
    w.observation_age_hours,
    w.suggested_restock_qty,
    w.max_restockable_qty,
    w.event_at
  FROM public.v_inventory_returns_restock_dashboard_worklist w
  WHERE w.row_type = 'restock_assist' AND w.status = 'ready_to_restock'
  ORDER BY w.priority ASC, w.component_sku ASC NULLS LAST
  LIMIT 10
) ready_restock
UNION ALL
SELECT * FROM (
  SELECT
    'stale_observation'::text,
    w.row_id, w.row_type, w.priority, w.source_channel, w.source_order_id, w.source_order_item_id,
    w.reservation_id, w.restock_action_id, w.component_sku, w.component_title, w.parent_bundle_sku,
    w.parent_bundle_title, w.status, w.reason, w.recommended_action, w.is_observation_stale,
    w.observation_age_hours, w.suggested_restock_qty, w.max_restockable_qty, w.event_at
  FROM public.v_inventory_returns_restock_dashboard_worklist w
  WHERE w.is_observation_stale = true
  ORDER BY w.observation_age_hours DESC NULLS LAST, w.priority ASC
  LIMIT 10
) stale_observation
UNION ALL
SELECT * FROM (
  SELECT
    'open_followup'::text,
    w.row_id, w.row_type, w.priority, w.source_channel, w.source_order_id, w.source_order_item_id,
    w.reservation_id, w.restock_action_id, w.component_sku, w.component_title, w.parent_bundle_sku,
    w.parent_bundle_title, w.status, w.reason, w.recommended_action, w.is_observation_stale,
    w.observation_age_hours, w.suggested_restock_qty, w.max_restockable_qty, w.event_at
  FROM public.v_inventory_returns_restock_dashboard_worklist w
  WHERE w.row_type = 'channel_followup'
  ORDER BY w.priority ASC, w.event_at DESC NULLS LAST
  LIMIT 10
) open_followup
UNION ALL
SELECT * FROM (
  SELECT
    'manual_review'::text,
    w.row_id, w.row_type, w.priority, w.source_channel, w.source_order_id, w.source_order_item_id,
    w.reservation_id, w.restock_action_id, w.component_sku, w.component_title, w.parent_bundle_sku,
    w.parent_bundle_title, w.status, w.reason, w.recommended_action, w.is_observation_stale,
    w.observation_age_hours, w.suggested_restock_qty, w.max_restockable_qty, w.event_at
  FROM public.v_inventory_returns_restock_dashboard_worklist w
  WHERE w.row_type = 'manual_review'
     OR (w.row_type = 'restock_assist' AND w.status IN ('manual_review', 'blocked'))
  ORDER BY w.priority ASC, w.component_sku ASC NULLS LAST
  LIMIT 10
) manual_review;

COMMENT ON VIEW public.v_inventory_returns_restock_digest_items IS
  'Phase 10W: top digest rows by section (ready, stale, follow-up, manual review).';

GRANT SELECT ON public.v_inventory_returns_restock_digest_items TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.inventory_returns_restock_digest_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type         text NOT NULL CHECK (run_type IN ('daily', 'weekly', 'manual')),
  schedule_window  text NOT NULL,
  delivery_channel text,
  recipient        text,
  status           text NOT NULL CHECK (status IN ('preview', 'sent', 'failed', 'skipped_duplicate')),
  summary_counts   jsonb,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_returns_restock_digest_runs_sent_window_idx
  ON public.inventory_returns_restock_digest_runs (run_type, schedule_window)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS inventory_returns_restock_digest_runs_created_idx
  ON public.inventory_returns_restock_digest_runs (created_at DESC);

COMMENT ON TABLE public.inventory_returns_restock_digest_runs IS
  'Phase 10W: audit log for returns/restock digest preview and send runs — no inventory mutations.';

ALTER TABLE public.inventory_returns_restock_digest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_returns_restock_digest_runs_select_authenticated
  ON public.inventory_returns_restock_digest_runs FOR SELECT TO authenticated USING (true);

CREATE POLICY inventory_returns_restock_digest_runs_service_all
  ON public.inventory_returns_restock_digest_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.inventory_returns_restock_digest_runs TO authenticated;
GRANT ALL ON public.inventory_returns_restock_digest_runs TO service_role;
