-- Phase 10R — Marketplace restock assist batch queue + audit trail (no auto-restock).

CREATE TABLE IF NOT EXISTS public.marketplace_restock_assist_actions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id      uuid REFERENCES public.inventory_reservations(id) ON DELETE SET NULL,
  return_workflow_id  uuid REFERENCES public.inventory_return_workflow(id) ON DELETE SET NULL,
  observation_id      uuid REFERENCES public.marketplace_refund_observations(id) ON DELETE SET NULL,
  action_type         text NOT NULL CHECK (action_type IN (
    'reviewed', 'physical_return_confirmed', 'restock_confirmed',
    'skipped', 'blocked', 'refreshed_observation'
  )),
  qty                 integer,
  previous_status     text,
  next_status         text,
  note                text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  raw_context         jsonb
);

CREATE INDEX IF NOT EXISTS marketplace_restock_assist_actions_reservation_idx
  ON public.marketplace_restock_assist_actions (reservation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_restock_assist_actions_observation_idx
  ON public.marketplace_restock_assist_actions (observation_id, created_at DESC)
  WHERE observation_id IS NOT NULL;

COMMENT ON TABLE public.marketplace_restock_assist_actions IS
  'Phase 10R: audit trail for marketplace restock assist queue actions — does not mutate stock.';

ALTER TABLE public.marketplace_restock_assist_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketplace_restock_assist_actions_select_authenticated
  ON public.marketplace_restock_assist_actions FOR SELECT TO authenticated USING (true);

CREATE POLICY marketplace_restock_assist_actions_service_all
  ON public.marketplace_restock_assist_actions FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.marketplace_restock_assist_actions TO authenticated;
GRANT ALL ON public.marketplace_restock_assist_actions TO service_role;

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
    'skipped', 'blocked', 'refreshed_observation'
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

GRANT EXECUTE ON FUNCTION public.log_marketplace_restock_assist_action TO authenticated;

-- Batch queue view (guidance-only; stock via restock_bundle_component_line).
CREATE OR REPLACE VIEW public.v_inventory_marketplace_restock_assist_queue AS
WITH enriched AS (
  SELECT
    c.*,
    bundle_pv.sku AS parent_bundle_sku,
    CASE
      WHEN c.observation_observed_at IS NOT NULL THEN
        ROUND((EXTRACT(EPOCH FROM (now() - c.observation_observed_at)) / 3600.0)::numeric, 1)
      ELSE NULL
    END AS observation_age_hours,
    (
      c.observation_observed_at IS NOT NULL
      AND c.observation_observed_at < now() - interval '48 hours'
    ) AS is_observation_stale
  FROM public.v_inventory_marketplace_restock_assist_candidates c
  LEFT JOIN public.product_variants bundle_pv
    ON bundle_pv.id = c.parent_bundle_variant_id
)
SELECT
  reservation_id,
  workflow_id AS return_workflow_id,
  observation_id,
  source_channel,
  source_order_id,
  source_order_item_id,
  parent_bundle_variant_id,
  component_variant_id,
  component_title,
  component_sku,
  parent_bundle_title,
  parent_bundle_sku,
  finalized_qty,
  already_restocked_qty,
  max_restockable_qty,
  suggested_restock_qty,
  observation_confidence,
  observation_age_hours,
  is_observation_stale,
  physical_return_confirmed_at,
  physical_return_confirmed_by,
  physical_return_confirmed_note,
  workflow_status,
  workflow_condition,
  assist_status,
  assist_reason,
  observation_observed_at,
  observation_sync_source,
  observation_source_channel,
  CASE
    WHEN max_restockable_qty <= 0 THEN 'already_done'
    WHEN assist_status IN ('not_finalized', 'afn_external_review')
      OR workflow_condition IN ('damaged', 'missing') THEN 'blocked'
    WHEN is_observation_stale AND max_restockable_qty > 0 THEN 'stale_observation'
    WHEN observation_confidence = 'line_confirmed'
      AND max_restockable_qty > 0
      AND NOT is_observation_stale
      AND (
        physical_return_confirmed_at IS NOT NULL
        OR (workflow_status = 'inspected' AND workflow_condition = 'resellable')
      )
      AND COALESCE(workflow_condition, 'unknown') IN ('resellable', 'unknown') THEN 'ready_to_restock'
    WHEN assist_status = 'needs_physical_return_confirmation' THEN 'needs_physical_confirmation'
    WHEN assist_status = 'needs_rma_workflow' THEN 'needs_rma'
    WHEN assist_status IN ('sku_inferred_manual_review', 'order_level_manual_review') THEN 'manual_review'
    ELSE 'manual_review'
  END AS queue_bucket,
  CASE
    WHEN max_restockable_qty <= 0 THEN 900
    WHEN assist_status IN ('not_finalized', 'afn_external_review')
      OR workflow_condition IN ('damaged', 'missing') THEN 600
    WHEN is_observation_stale AND max_restockable_qty > 0 THEN 400
    WHEN observation_confidence = 'line_confirmed'
      AND max_restockable_qty > 0
      AND NOT is_observation_stale
      AND (
        physical_return_confirmed_at IS NOT NULL
        OR (workflow_status = 'inspected' AND workflow_condition = 'resellable')
      )
      AND COALESCE(workflow_condition, 'unknown') IN ('resellable', 'unknown') THEN 100
    WHEN assist_status = 'needs_physical_return_confirmation' THEN 200
    WHEN assist_status = 'needs_rma_workflow' THEN 300
    ELSE 500
  END AS queue_priority
FROM enriched;

COMMENT ON VIEW public.v_inventory_marketplace_restock_assist_queue IS
  'Phase 10R: batch marketplace restock assist queue buckets (admin-confirmed restock only).';

GRANT SELECT ON public.v_inventory_marketplace_restock_assist_queue TO authenticated, service_role;
