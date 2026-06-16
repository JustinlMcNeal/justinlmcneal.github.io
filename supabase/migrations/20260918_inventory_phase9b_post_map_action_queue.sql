-- Phase 9B — Post-map action queue (workflow/todo layer only).
-- No auto reservation retry, manual finalize, stock/reservation/ledger, or channel writes.

CREATE TABLE IF NOT EXISTS public.inventory_post_map_action_queue (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel        text NOT NULL,
  source_order_id       text NOT NULL,
  source_order_item_id  text NOT NULL,
  mapping_action_id     uuid REFERENCES public.inventory_mapping_assist_actions(id) ON DELETE SET NULL,
  mapping_batch_id      uuid REFERENCES public.inventory_mapping_assist_batches(id) ON DELETE SET NULL,
  product_id            uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id            uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_label         text,
  internal_sku          text,
  quantity              integer NOT NULL DEFAULT 0,
  next_step             text NOT NULL
                        CHECK (next_step IN (
                          'reservation_retry',
                          'shipped_finalize_audit',
                          'manual_finalize_possible',
                          'already_accounted_for',
                          'skipped_afn',
                          'skipped_refunded',
                          'skipped_canceled',
                          'manual_review'
                        )),
  status                text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'reviewed', 'snoozed', 'done', 'ignored')),
  snoozed_until         timestamptz,
  reason                text,
  action_target         jsonb,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  CONSTRAINT inventory_post_map_queue_unique_line_step
    UNIQUE (source_channel, source_order_id, source_order_item_id, next_step)
);

COMMENT ON TABLE public.inventory_post_map_action_queue IS
  'Workflow queue for post-map follow-up todos (Phase 9B). Not inventory truth.';

CREATE INDEX IF NOT EXISTS idx_post_map_queue_status
  ON public.inventory_post_map_action_queue (status);

CREATE INDEX IF NOT EXISTS idx_post_map_queue_next_step
  ON public.inventory_post_map_action_queue (next_step);

CREATE INDEX IF NOT EXISTS idx_post_map_queue_snoozed_until
  ON public.inventory_post_map_action_queue (snoozed_until)
  WHERE snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_post_map_queue_created
  ON public.inventory_post_map_action_queue (created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'inventory_post_map_queue_set_updated_at'
  ) THEN
    CREATE TRIGGER inventory_post_map_queue_set_updated_at
      BEFORE UPDATE ON public.inventory_post_map_action_queue
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ALTER TABLE public.inventory_post_map_action_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_post_map_queue_service_role_all
  ON public.inventory_post_map_action_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY inventory_post_map_queue_authenticated_select
  ON public.inventory_post_map_action_queue FOR SELECT TO authenticated USING (true);

CREATE POLICY inventory_post_map_queue_authenticated_insert
  ON public.inventory_post_map_action_queue FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY inventory_post_map_queue_authenticated_update
  ON public.inventory_post_map_action_queue FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.inventory_post_map_action_queue TO authenticated;
GRANT ALL ON public.inventory_post_map_action_queue TO service_role;

-- Idempotent upsert from checklist rows (actionable steps only).
CREATE OR REPLACE FUNCTION public.upsert_post_map_queue_from_checklist(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     uuid := auth.uid();
  v_is_admin  boolean := false;
  v_item      jsonb;
  v_step      text;
  v_inserted  integer := 0;
  v_updated   integer := 0;
  v_skipped   integer := 0;
  v_actionable text[] := ARRAY[
    'reservation_retry',
    'shipped_finalize_audit',
    'manual_finalize_possible',
    'manual_review'
  ];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', true, 'inserted', 0, 'updated', 0, 'skipped', 0);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_step := NULLIF(BTRIM(v_item->>'next_step'), '');
    IF v_step IS NULL OR NOT (v_step = ANY (v_actionable)) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF NULLIF(BTRIM(v_item->>'source_order_id'), '') IS NULL
      OR NULLIF(BTRIM(v_item->>'source_order_item_id'), '') IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.inventory_post_map_action_queue (
      source_channel, source_order_id, source_order_item_id,
      mapping_action_id, mapping_batch_id,
      product_id, variant_id, product_label, internal_sku,
      quantity, next_step, status, reason, action_target, created_by, updated_by
    ) VALUES (
      COALESCE(NULLIF(BTRIM(v_item->>'source_channel'), ''), 'unknown'),
      v_item->>'source_order_id',
      v_item->>'source_order_item_id',
      NULLIF(v_item->>'mapping_action_id', '')::uuid,
      NULLIF(v_item->>'mapping_batch_id', '')::uuid,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      NULLIF(BTRIM(v_item->>'product_label'), ''),
      NULLIF(BTRIM(v_item->>'internal_sku'), ''),
      COALESCE((v_item->>'quantity')::integer, 0),
      v_step,
      'open',
      NULLIF(BTRIM(v_item->>'reason'), ''),
      COALESCE(v_item->'action_target', jsonb_build_object('type', v_item->>'action_target')),
      v_actor,
      v_actor
    )
    ON CONFLICT ON CONSTRAINT inventory_post_map_queue_unique_line_step
    DO UPDATE SET
      mapping_action_id = COALESCE(EXCLUDED.mapping_action_id, inventory_post_map_action_queue.mapping_action_id),
      mapping_batch_id = COALESCE(EXCLUDED.mapping_batch_id, inventory_post_map_action_queue.mapping_batch_id),
      product_id = COALESCE(EXCLUDED.product_id, inventory_post_map_action_queue.product_id),
      variant_id = COALESCE(EXCLUDED.variant_id, inventory_post_map_action_queue.variant_id),
      product_label = COALESCE(EXCLUDED.product_label, inventory_post_map_action_queue.product_label),
      internal_sku = COALESCE(EXCLUDED.internal_sku, inventory_post_map_action_queue.internal_sku),
      quantity = EXCLUDED.quantity,
      reason = COALESCE(EXCLUDED.reason, inventory_post_map_action_queue.reason),
      action_target = COALESCE(EXCLUDED.action_target, inventory_post_map_action_queue.action_target),
      updated_by = v_actor,
      updated_at = now()
    WHERE inventory_post_map_action_queue.status IN ('open', 'reviewed', 'snoozed');

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted > 0 THEN
      v_updated := v_updated + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_post_map_queue_from_checklist IS
  'Admin-only idempotent queue upsert from post-map checklist. Skips done/ignored rows.';

GRANT EXECUTE ON FUNCTION public.upsert_post_map_queue_from_checklist TO authenticated;

CREATE OR REPLACE FUNCTION public.update_post_map_queue_item(
  p_id             uuid,
  p_status         text,
  p_snoozed_until  timestamptz DEFAULT NULL,
  p_reason         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_is_admin boolean := false;
  v_row public.inventory_post_map_action_queue%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
  END IF;

  IF p_status NOT IN ('open', 'reviewed', 'snoozed', 'done', 'ignored') THEN
    RAISE EXCEPTION 'Invalid status' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.inventory_post_map_action_queue
  SET
    status = p_status,
    snoozed_until = CASE WHEN p_status = 'snoozed' THEN p_snoozed_until ELSE NULL END,
    reason = COALESCE(p_reason, reason),
    updated_by = v_actor,
    updated_at = now(),
    completed_at = CASE
      WHEN p_status IN ('done', 'ignored') THEN COALESCE(completed_at, now())
      ELSE NULL
    END
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Queue item not found' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_post_map_queue_item TO authenticated;
