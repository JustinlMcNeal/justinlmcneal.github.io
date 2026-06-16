-- Phase 10S — Restock assist audit viewer + queue analytics (no stock mutations).

-- Extend audit action types for snooze/dismiss triage.
ALTER TABLE public.marketplace_restock_assist_actions
  DROP CONSTRAINT IF EXISTS marketplace_restock_assist_actions_action_type_check;

ALTER TABLE public.marketplace_restock_assist_actions
  ADD CONSTRAINT marketplace_restock_assist_actions_action_type_check
  CHECK (action_type IN (
    'reviewed', 'physical_return_confirmed', 'restock_confirmed',
    'skipped', 'blocked', 'refreshed_observation',
    'snoozed', 'unsnoozed', 'dismissed'
  ));

-- Lightweight triage state (does not affect stock or bucket assignment).
CREATE TABLE IF NOT EXISTS public.marketplace_restock_assist_queue_states (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  uuid NOT NULL REFERENCES public.inventory_reservations(id) ON DELETE CASCADE,
  observation_id  uuid REFERENCES public.marketplace_refund_observations(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'snoozed', 'dismissed')),
  snoozed_until   timestamptz,
  note            text,
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id, observation_id)
);

CREATE INDEX IF NOT EXISTS marketplace_restock_assist_queue_states_reservation_idx
  ON public.marketplace_restock_assist_queue_states (reservation_id, updated_at DESC);

COMMENT ON TABLE public.marketplace_restock_assist_queue_states IS
  'Phase 10S: triage state for restock assist queue — snooze/review/dismiss only; no stock changes.';

ALTER TABLE public.marketplace_restock_assist_queue_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketplace_restock_assist_queue_states_select_authenticated
  ON public.marketplace_restock_assist_queue_states FOR SELECT TO authenticated USING (true);

CREATE POLICY marketplace_restock_assist_queue_states_service_all
  ON public.marketplace_restock_assist_queue_states FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.marketplace_restock_assist_queue_states TO authenticated;
GRANT ALL ON public.marketplace_restock_assist_queue_states TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_marketplace_restock_assist_queue_state(
  p_reservation_id  uuid,
  p_observation_id  uuid DEFAULT NULL,
  p_status          text DEFAULT 'open',
  p_snoozed_until   timestamptz DEFAULT NULL,
  p_note            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_admin boolean := false;
  v_id    uuid;
  v_status text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_admin;
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'reservation_id is required' USING ERRCODE = 'P0001';
  END IF;

  v_status := COALESCE(NULLIF(btrim(p_status), ''), 'open');
  IF v_status NOT IN ('open', 'reviewed', 'snoozed', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid triage status' USING ERRCODE = 'P0001';
  END IF;

  IF v_status = 'snoozed' AND p_snoozed_until IS NULL THEN
    RAISE EXCEPTION 'snoozed_until required when status is snoozed' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.marketplace_restock_assist_queue_states (
    reservation_id, observation_id, status, snoozed_until, note, updated_by, updated_at
  ) VALUES (
    p_reservation_id, p_observation_id, v_status,
    CASE WHEN v_status = 'snoozed' THEN p_snoozed_until ELSE NULL END,
    NULLIF(btrim(p_note), ''), v_actor, now()
  )
  ON CONFLICT (reservation_id, observation_id) DO UPDATE SET
    status = EXCLUDED.status,
    snoozed_until = EXCLUDED.snoozed_until,
    note = COALESCE(EXCLUDED.note, marketplace_restock_assist_queue_states.note),
    updated_by = v_actor,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'state_id', v_id,
    'status', v_status,
    'message', 'Queue triage state updated — no stock changed'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_marketplace_restock_assist_queue_state TO authenticated;

-- Queue rows enriched with triage (bucket logic unchanged from 10R).
CREATE OR REPLACE VIEW public.v_inventory_marketplace_restock_assist_queue_with_triage AS
SELECT
  q.*,
  COALESCE(st.status, 'open') AS triage_status,
  st.snoozed_until AS triage_snoozed_until,
  st.note AS triage_note,
  st.updated_at AS triage_updated_at,
  (
    COALESCE(st.status, 'open') = 'snoozed'
    AND st.snoozed_until IS NOT NULL
    AND st.snoozed_until > now()
  ) AS is_actively_snoozed,
  (COALESCE(st.status, 'open') = 'dismissed') AS is_dismissed
FROM public.v_inventory_marketplace_restock_assist_queue q
LEFT JOIN public.marketplace_restock_assist_queue_states st
  ON st.reservation_id = q.reservation_id
 AND st.observation_id IS NOT DISTINCT FROM q.observation_id;

COMMENT ON VIEW public.v_inventory_marketplace_restock_assist_queue_with_triage IS
  'Phase 10S: queue rows with optional snooze/review/dismiss triage overlay.';

GRANT SELECT ON public.v_inventory_marketplace_restock_assist_queue_with_triage TO authenticated, service_role;

-- Single-row KPI summary.
CREATE OR REPLACE VIEW public.v_inventory_marketplace_restock_assist_queue_summary AS
SELECT
  COUNT(*) FILTER (
    WHERE queue_bucket = 'ready_to_restock' AND NOT is_actively_snoozed AND NOT is_dismissed
  )::integer AS ready_to_restock,
  COUNT(*) FILTER (
    WHERE queue_bucket = 'needs_physical_confirmation' AND NOT is_actively_snoozed AND NOT is_dismissed
  )::integer AS needs_physical_confirmation,
  COUNT(*) FILTER (
    WHERE queue_bucket = 'needs_rma' AND NOT is_actively_snoozed AND NOT is_dismissed
  )::integer AS needs_rma,
  COUNT(*) FILTER (
    WHERE queue_bucket = 'stale_observation' AND NOT is_actively_snoozed AND NOT is_dismissed
  )::integer AS stale_observation,
  COUNT(*) FILTER (
    WHERE queue_bucket = 'manual_review' AND NOT is_actively_snoozed AND NOT is_dismissed
  )::integer AS manual_review,
  COUNT(*) FILTER (
    WHERE queue_bucket = 'blocked' AND NOT is_actively_snoozed AND NOT is_dismissed
  )::integer AS blocked,
  COUNT(*) FILTER (WHERE queue_bucket = 'already_done')::integer AS already_done,
  COUNT(*) FILTER (WHERE is_actively_snoozed)::integer AS snoozed,
  COUNT(*) FILTER (
    WHERE queue_bucket <> 'already_done' AND NOT is_actively_snoozed AND NOT is_dismissed
  )::integer AS total_open_queue_items,
  MAX(observation_age_hours) FILTER (WHERE is_observation_stale)::numeric AS oldest_stale_observation_age_hours,
  COALESCE(SUM(max_restockable_qty) FILTER (WHERE queue_bucket <> 'already_done'), 0)::integer AS total_restockable_qty,
  COALESCE(SUM(COALESCE(suggested_restock_qty, max_restockable_qty)) FILTER (
    WHERE queue_bucket = 'ready_to_restock' AND NOT is_actively_snoozed AND NOT is_dismissed
  ), 0)::integer AS estimated_pending_component_qty
FROM public.v_inventory_marketplace_restock_assist_queue_with_triage;

COMMENT ON VIEW public.v_inventory_marketplace_restock_assist_queue_summary IS
  'Phase 10S: aggregate KPIs for marketplace restock assist queue.';

GRANT SELECT ON public.v_inventory_marketplace_restock_assist_queue_summary TO authenticated, service_role;

-- Read-only audit history with denormalized context.
CREATE OR REPLACE VIEW public.v_inventory_marketplace_restock_assist_audit AS
SELECT
  a.id AS action_id,
  a.action_type,
  a.created_at,
  a.created_by,
  a.reservation_id,
  a.return_workflow_id,
  a.observation_id,
  COALESCE(c.source_channel, q.source_channel) AS source_channel,
  COALESCE(c.source_order_id, q.source_order_id) AS source_order_id,
  COALESCE(c.source_order_item_id, q.source_order_item_id) AS source_order_item_id,
  COALESCE(c.parent_bundle_variant_id, q.parent_bundle_variant_id) AS parent_bundle_variant_id,
  COALESCE(c.component_variant_id, q.component_variant_id) AS component_variant_id,
  COALESCE(c.component_sku, q.component_sku) AS component_sku,
  COALESCE(c.component_title, q.component_title) AS component_title,
  COALESCE(c.parent_bundle_title, q.parent_bundle_title) AS parent_bundle_title,
  bundle_pv.sku AS parent_bundle_sku,
  a.qty,
  a.previous_status,
  a.next_status,
  a.note,
  a.raw_context,
  COALESCE(
    a.raw_context->>'ledger_id',
    a.raw_context->'restock_result'->>'ledger_id'
  ) AS ledger_id,
  a.raw_context->'restock_result' AS restock_result
FROM public.marketplace_restock_assist_actions a
LEFT JOIN public.v_inventory_marketplace_restock_assist_candidates c
  ON c.reservation_id = a.reservation_id
 AND (c.observation_id IS NOT DISTINCT FROM a.observation_id OR a.observation_id IS NULL)
LEFT JOIN public.v_inventory_marketplace_restock_assist_queue q
  ON q.reservation_id = a.reservation_id
 AND q.observation_id IS NOT DISTINCT FROM a.observation_id
LEFT JOIN public.product_variants bundle_pv
  ON bundle_pv.id = COALESCE(c.parent_bundle_variant_id, q.parent_bundle_variant_id);

COMMENT ON VIEW public.v_inventory_marketplace_restock_assist_audit IS
  'Phase 10S: read-only audit history for marketplace restock assist actions.';

GRANT SELECT ON public.v_inventory_marketplace_restock_assist_audit TO authenticated, service_role;

-- Extend log RPC for new action types.
CREATE OR REPLACE FUNCTION public.log_marketplace_restock_assist_action(
  p_reservation_id      uuid DEFAULT NULL,
  p_return_workflow_id  uuid DEFAULT NULL,
  p_observation_id      uuid DEFAULT NULL,
  p_action_type         text DEFAULT NULL,
  p_qty                 integer DEFAULT NULL,
  p_previous_status     text DEFAULT NULL,
  p_next_status         text DEFAULT NULL,
  p_note                text DEFAULT NULL,
  p_raw_context         jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_admin boolean := false;
  v_id    uuid;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_admin;
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_action_type IS NULL OR btrim(p_action_type) = '' THEN
    RAISE EXCEPTION 'action_type is required' USING ERRCODE = 'P0001';
  END IF;

  IF p_action_type NOT IN (
    'reviewed', 'physical_return_confirmed', 'restock_confirmed',
    'skipped', 'blocked', 'refreshed_observation',
    'snoozed', 'unsnoozed', 'dismissed'
  ) THEN
    RAISE EXCEPTION 'Invalid action_type' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.marketplace_restock_assist_actions (
    reservation_id, return_workflow_id, observation_id,
    action_type, qty, previous_status, next_status, note, created_by, raw_context
  ) VALUES (
    p_reservation_id, p_return_workflow_id, p_observation_id,
    p_action_type, p_qty, p_previous_status, p_next_status, p_note, v_actor, p_raw_context
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'audit_id', v_id,
    'action_type', p_action_type,
    'message', 'Assist action logged — no stock changed'
  );
END;
$$;
