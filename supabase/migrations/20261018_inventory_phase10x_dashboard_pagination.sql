-- Phase 10X — Server-side paginated returns/restock dashboard worklist (read-only).

CREATE OR REPLACE FUNCTION public.get_returns_restock_dashboard_worklist_page(
  p_tab             text DEFAULT 'worklist',
  p_channel         text DEFAULT NULL,
  p_status          text DEFAULT NULL,
  p_priority_max    integer DEFAULT NULL,
  p_stale_only      boolean DEFAULT false,
  p_q               text DEFAULT NULL,
  p_row_type        text DEFAULT NULL,
  p_offset          integer DEFAULT 0,
  p_limit           integer DEFAULT 50,
  p_reservation_id  uuid DEFAULT NULL,
  p_order_id        text DEFAULT NULL,
  p_observation_id  uuid DEFAULT NULL,
  p_restock_action_id uuid DEFAULT NULL,
  p_followup_id     uuid DEFAULT NULL,
  p_seek_target     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin       boolean := false;
  v_limit       integer;
  v_offset      integer;
  v_target_uuid uuid;
  v_total       integer;
  v_target_rn   integer;
  v_target_row  jsonb;
  v_rows        jsonb;
  v_buckets     jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_admin;
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 250);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_target_uuid := COALESCE(p_restock_action_id, p_followup_id);

  DROP TABLE IF EXISTS pg_temp._rrd_worklist;
  CREATE TEMP TABLE pg_temp._rrd_worklist ON COMMIT DROP AS
  WITH base AS (
    SELECT w.*
    FROM public.v_inventory_returns_restock_dashboard_worklist w
  ),
  pre_filter AS (
    SELECT b.*
    FROM base b
    WHERE (p_channel IS NULL OR btrim(p_channel) = '' OR b.source_channel = p_channel)
      AND (p_status IS NULL OR btrim(p_status) = '' OR b.status = p_status)
      AND (p_row_type IS NULL OR btrim(p_row_type) = '' OR b.row_type = p_row_type)
      AND (NOT COALESCE(p_stale_only, false) OR b.is_observation_stale = true)
      AND (p_priority_max IS NULL OR b.priority <= p_priority_max)
      AND (
        p_q IS NULL OR btrim(p_q) = '' OR
        b.component_sku ILIKE '%' || p_q || '%' OR
        b.component_title ILIKE '%' || p_q || '%' OR
        b.parent_bundle_title ILIKE '%' || p_q || '%'
      )
  ),
  tab_filtered AS (
    SELECT pf.*
    FROM pre_filter pf
    WHERE CASE COALESCE(NULLIF(btrim(p_tab), ''), 'worklist')
      WHEN 'ready' THEN pf.row_type = 'restock_assist' AND pf.status = 'ready_to_restock'
      WHEN 'returns' THEN pf.row_type = 'return_workflow'
      WHEN 'followup' THEN pf.row_type = 'channel_followup'
      WHEN 'audit' THEN pf.row_type = 'audit'
      ELSE true
    END
  )
  SELECT
    tf.*,
    row_number() OVER (
      ORDER BY tf.priority ASC, tf.event_at DESC NULLS LAST, tf.row_id ASC
    ) AS rn
  FROM tab_filtered tf;

  SELECT r.rn, to_jsonb(r) - 'rn'
  INTO v_target_rn, v_target_row
  FROM pg_temp._rrd_worklist r
  WHERE (p_reservation_id IS NOT NULL AND r.reservation_id = p_reservation_id)
     OR (p_order_id IS NOT NULL AND btrim(p_order_id) <> '' AND r.source_order_id = p_order_id)
     OR (p_observation_id IS NOT NULL AND r.observation_id = p_observation_id)
     OR (v_target_uuid IS NOT NULL AND r.restock_action_id = v_target_uuid)
  ORDER BY r.rn
  LIMIT 1;

  IF COALESCE(p_seek_target, false) AND v_target_rn IS NOT NULL THEN
    v_offset := ((v_target_rn - 1) / v_limit) * v_limit;
  END IF;

  SELECT COUNT(*)::integer INTO v_total FROM pg_temp._rrd_worklist;

  SELECT COALESCE(jsonb_agg(to_jsonb(p) - 'rn' ORDER BY p.rn), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT r.*
    FROM pg_temp._rrd_worklist r
    WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit
    ORDER BY r.rn
  ) p;

  WITH pre_filter AS (
    SELECT w.*
    FROM public.v_inventory_returns_restock_dashboard_worklist w
    WHERE (p_channel IS NULL OR btrim(p_channel) = '' OR w.source_channel = p_channel)
      AND (p_status IS NULL OR btrim(p_status) = '' OR w.status = p_status)
      AND (p_row_type IS NULL OR btrim(p_row_type) = '' OR w.row_type = p_row_type)
      AND (NOT COALESCE(p_stale_only, false) OR w.is_observation_stale = true)
      AND (p_priority_max IS NULL OR w.priority <= p_priority_max)
      AND (
        p_q IS NULL OR btrim(p_q) = '' OR
        w.component_sku ILIKE '%' || p_q || '%' OR
        w.component_title ILIKE '%' || p_q || '%' OR
        w.parent_bundle_title ILIKE '%' || p_q || '%'
      )
  )
  SELECT jsonb_build_object(
    'tab_worklist', (SELECT COUNT(*)::integer FROM pre_filter),
    'tab_ready', (SELECT COUNT(*)::integer FROM pre_filter WHERE row_type = 'restock_assist' AND status = 'ready_to_restock'),
    'tab_returns', (SELECT COUNT(*)::integer FROM pre_filter WHERE row_type = 'return_workflow'),
    'tab_followup', (SELECT COUNT(*)::integer FROM pre_filter WHERE row_type = 'channel_followup'),
    'tab_audit', (SELECT COUNT(*)::integer FROM pre_filter WHERE row_type = 'audit'),
    'stale_only', (SELECT COUNT(*)::integer FROM pre_filter WHERE is_observation_stale = true),
    'by_channel', COALESCE((
      SELECT jsonb_object_agg(ch, cnt)
      FROM (
        SELECT pf.source_channel AS ch, COUNT(*)::integer AS cnt
        FROM pre_filter pf
        WHERE pf.source_channel IS NOT NULL
        GROUP BY pf.source_channel
      ) ch
    ), '{}'::jsonb),
    'by_row_type', COALESCE((
      SELECT jsonb_object_agg(rt, cnt)
      FROM (
        SELECT pf.row_type AS rt, COUNT(*)::integer AS cnt
        FROM pre_filter pf
        GROUP BY pf.row_type
      ) rt
    ), '{}'::jsonb),
    'by_status', COALESCE((
      SELECT jsonb_object_agg(st, cnt)
      FROM (
        SELECT pf.status AS st, COUNT(*)::integer AS cnt
        FROM pre_filter pf
        WHERE pf.status IS NOT NULL
        GROUP BY pf.status
      ) st
    ), '{}'::jsonb)
  ) INTO v_buckets;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'page_count', CASE WHEN v_total = 0 THEN 0 ELSE CEIL(v_total::numeric / v_limit)::integer END,
    'offset', v_offset,
    'limit', v_limit,
    'has_more', (v_offset + v_limit) < v_total,
    'next_offset', CASE WHEN (v_offset + v_limit) < v_total THEN v_offset + v_limit ELSE NULL END,
    'prev_offset', CASE WHEN v_offset > 0 THEN GREATEST(v_offset - v_limit, 0) ELSE NULL END,
    'bucket_counts', v_buckets,
    'target_found', v_target_rn IS NOT NULL,
    'target_offset', CASE WHEN v_target_rn IS NOT NULL THEN ((v_target_rn - 1) / v_limit) * v_limit ELSE NULL END,
    'target_row', v_target_row,
    'target_rn', v_target_rn
  );
END;
$$;

COMMENT ON FUNCTION public.get_returns_restock_dashboard_worklist_page IS
  'Phase 10X: paginated read-only returns/restock dashboard worklist with counts and target lookup.';

GRANT EXECUTE ON FUNCTION public.get_returns_restock_dashboard_worklist_page TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS inventory_bundle_component_restock_actions_created_idx
  ON public.inventory_bundle_component_restock_actions (created_at DESC)
  WHERE status = 'applied';
