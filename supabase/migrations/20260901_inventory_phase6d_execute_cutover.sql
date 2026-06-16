-- 20260901_inventory_phase6d_execute_cutover.sql
--
-- Phase 6D Execute — KK reserve-only cutover RPC + rollback helper.
-- Promotes shadow reservations, backfills pre-6C paid/unshipped stock, flips mode.

ALTER TABLE public.inventory_cutover_settings
  ADD COLUMN IF NOT EXISTS cutover_executed_at timestamptz;

COMMENT ON COLUMN public.inventory_cutover_settings.cutover_executed_at IS
  'Timestamp when execute_kk_reservation_cutover last completed successfully.';

-- ════════════════════════════════════════════════════════════════
-- execute_kk_reservation_cutover — idempotent admin/service cutover
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.execute_kk_reservation_cutover()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode_before          text;
  v_mode_after           text := 'reserve_only';
  v_is_admin             boolean := false;
  v_ready                record;
  v_candidate            record;
  v_promoted             integer := 0;
  v_inserted             integer := 0;
  v_backfill_variants    integer := 0;
  v_backfill_units       integer := 0;
  v_skipped              integer := 0;
  v_idempotency_key      text;
  v_backfill_key         text;
  v_res_id               uuid;
  v_stock_before         integer;
  v_stock_after          integer;
  v_ledger_id            uuid;
  v_existing_ledger      uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Admin only'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT kk_reservation_mode INTO v_mode_before
  FROM public.inventory_cutover_settings
  WHERE id = 1
  FOR UPDATE;

  IF v_mode_before IS NULL THEN
    RAISE EXCEPTION 'inventory_cutover_settings row missing'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_mode_before = v_mode_after THEN
    RETURN jsonb_build_object(
      'promoted_shadow_count', 0,
      'inserted_active_reservation_count', 0,
      'backfilled_variant_count', 0,
      'backfilled_units', 0,
      'skipped_existing_count', 0,
      'mode_before', v_mode_before,
      'mode_after', v_mode_after,
      'already_executed', true
    );
  END IF;

  IF v_mode_before <> 'shadow' THEN
    RAISE EXCEPTION 'Cutover requires kk_reservation_mode=shadow (current: %)', v_mode_before
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ready FROM public.v_inventory_cutover_readiness_summary LIMIT 1;

  IF NOT COALESCE(v_ready.safe_to_proceed_hint, false) THEN
    RAISE EXCEPTION 'Cutover readiness not safe (post_6c=% blockers=%)',
      v_ready.post_6c_matched_lines, v_ready.active_cutover_blocker_count
      USING ERRCODE = 'P0001';
  END IF;

  -- 1) Promote matched shadow reservations → active
  UPDATE public.inventory_reservations ir
  SET
    is_shadow = false,
    notes = COALESCE(ir.notes, '') || ' | Promoted to active at Phase 6D cutover',
    updated_at = now()
  FROM public.v_inventory_kk_paid_unshipped_reservation_candidates c
  WHERE c.backfill_action_needed = 'promote_shadow_at_cutover'
    AND ir.channel = 'kk'
    AND ir.order_id = c.order_id
    AND ir.order_item_id = c.order_item_id
    AND ir.status = 'reserved'
    AND COALESCE(ir.is_shadow, false) = true;

  GET DIAGNOSTICS v_promoted = ROW_COUNT;

  -- 2) Insert active reservations + backfill stock for pre-6C paid/unshipped lines
  FOR v_candidate IN
    SELECT *
    FROM public.v_inventory_kk_paid_unshipped_reservation_candidates c
    WHERE c.variant_id IS NOT NULL
      AND c.backfill_action_needed IN (
        'insert_active_reservation_and_backfill_stock',
        'insert_active_reservation_only'
      )
    ORDER BY c.paid_at, c.order_id, c.order_item_id
  LOOP
    v_idempotency_key := format('kk:%s:%s:reserve', v_candidate.order_id, v_candidate.order_item_id);
    v_backfill_key := format('cutover_backfill:kk:%s:%s', v_candidate.order_id, v_candidate.order_item_id);

    IF EXISTS (
      SELECT 1 FROM public.inventory_reservations ir
      WHERE ir.idempotency_key = v_idempotency_key
        AND ir.status = 'reserved'
        AND COALESCE(ir.is_shadow, false) = false
    ) THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO public.inventory_reservations (
        channel,
        order_id,
        order_item_id,
        variant_id,
        product_id,
        quantity,
        status,
        is_shadow,
        idempotency_key,
        source_reference,
        notes
      ) VALUES (
        'kk',
        v_candidate.order_id,
        v_candidate.order_item_id,
        v_candidate.variant_id,
        v_candidate.product_id,
        v_candidate.quantity,
        'reserved',
        false,
        v_idempotency_key,
        'kk_reservation_cutover',
        'Active reservation inserted at Phase 6D cutover for paid/unshipped order line'
      )
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
      DO UPDATE SET
        is_shadow = false,
        status = 'reserved',
        source_reference = COALESCE(public.inventory_reservations.source_reference, EXCLUDED.source_reference),
        updated_at = now()
      RETURNING id INTO v_res_id;

      IF v_res_id IS NOT NULL THEN
        v_inserted := v_inserted + 1;
      END IF;
    END IF;

    IF v_candidate.backfill_action_needed = 'insert_active_reservation_and_backfill_stock' THEN
      SELECT id INTO v_existing_ledger
      FROM public.stock_ledger
      WHERE idempotency_key = v_backfill_key
      LIMIT 1;

      IF v_existing_ledger IS NULL THEN
        SELECT COALESCE(pv.stock, 0) INTO v_stock_before
        FROM public.product_variants pv
        WHERE pv.id = v_candidate.variant_id
        FOR UPDATE;

        v_stock_after := v_stock_before + v_candidate.quantity;

        UPDATE public.product_variants
        SET stock = v_stock_after
        WHERE id = v_candidate.variant_id;

        INSERT INTO public.stock_ledger (
          variant_id,
          product_id,
          change,
          reason,
          reference_id,
          stock_before,
          stock_after,
          note,
          source,
          reference_type,
          idempotency_key
        ) VALUES (
          v_candidate.variant_id,
          v_candidate.product_id,
          v_candidate.quantity,
          'cutover_backfill',
          v_candidate.kk_order_id,
          v_stock_before,
          v_stock_after,
          format(
            'Phase 6D cutover backfill: restore %s units to on_hand for paid/unshipped %s while active reservation preserves availability.',
            v_candidate.quantity,
            v_candidate.kk_order_id
          ),
          'inventory_cutover',
          'kk_reservation_cutover',
          v_backfill_key
        )
        RETURNING id INTO v_ledger_id;

        v_backfill_units := v_backfill_units + v_candidate.quantity;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    END IF;
  END LOOP;

  SELECT COUNT(DISTINCT sl.variant_id)::integer INTO v_backfill_variants
  FROM public.stock_ledger sl
  WHERE sl.reason = 'cutover_backfill'
    AND sl.source = 'inventory_cutover';

  UPDATE public.inventory_cutover_settings
  SET
    kk_reservation_mode = v_mode_after,
    cutover_executed_at = now(),
    notes = 'Phase 6D execute: reserve-only mode active. Stripe webhook reads this row.',
    updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'promoted_shadow_count', v_promoted,
    'inserted_active_reservation_count', v_inserted,
    'backfilled_variant_count', v_backfill_variants,
    'backfilled_units', v_backfill_units,
    'skipped_existing_count', v_skipped,
    'mode_before', v_mode_before,
    'mode_after', v_mode_after,
    'already_executed', false
  );
END;
$$;

COMMENT ON FUNCTION public.execute_kk_reservation_cutover() IS
  'Phase 6D: promote shadow reservations, insert active reservations for paid/unshipped lines, backfill on_hand stock, flip kk_reservation_mode to reserve_only. Idempotent.';

REVOKE ALL ON FUNCTION public.execute_kk_reservation_cutover() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_kk_reservation_cutover() FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_kk_reservation_cutover() TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_kk_reservation_cutover() TO service_role;

-- ════════════════════════════════════════════════════════════════
-- rollback_kk_reservation_cutover — guarded emergency rollback
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rollback_kk_reservation_cutover()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode_before          text;
  v_is_admin             boolean := false;
  v_released             integer := 0;
  v_demoted              integer := 0;
  v_reversed_units       integer := 0;
  v_ledger               record;
  v_stock_before         integer;
  v_stock_after          integer;
  v_reverse_key          text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Admin only'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT kk_reservation_mode INTO v_mode_before
  FROM public.inventory_cutover_settings
  WHERE id = 1
  FOR UPDATE;

  IF v_mode_before <> 'reserve_only' THEN
    RAISE EXCEPTION 'Rollback requires kk_reservation_mode=reserve_only (current: %)', v_mode_before
      USING ERRCODE = 'P0001';
  END IF;

  -- Release active reservations created/promoted at cutover (not finalized)
  UPDATE public.inventory_reservations ir
  SET
    status = 'canceled',
    notes = COALESCE(ir.notes, '') || ' | Canceled by Phase 6D rollback',
    updated_at = now()
  WHERE ir.channel = 'kk'
    AND ir.status = 'reserved'
    AND COALESCE(ir.is_shadow, false) = false
    AND (
      ir.source_reference = 'kk_reservation_cutover'
      OR ir.notes ILIKE '%Phase 6D cutover%'
      OR ir.notes ILIKE '%Promoted to active at Phase 6D cutover%'
    );

  GET DIAGNOSTICS v_released = ROW_COUNT;

  -- Demote any remaining active kk reservations back to shadow (safety net)
  UPDATE public.inventory_reservations ir
  SET
    is_shadow = true,
    notes = COALESCE(ir.notes, '') || ' | Demoted to shadow by Phase 6D rollback',
    updated_at = now()
  WHERE ir.channel = 'kk'
    AND ir.status = 'reserved'
    AND COALESCE(ir.is_shadow, false) = false;

  GET DIAGNOSTICS v_demoted = ROW_COUNT;

  -- Reverse cutover backfill ledger entries (idempotent per backfill row)
  FOR v_ledger IN
    SELECT sl.id, sl.variant_id, sl.product_id, sl.change, sl.idempotency_key, sl.reference_id
    FROM public.stock_ledger sl
    WHERE sl.reason = 'cutover_backfill'
      AND sl.source = 'inventory_cutover'
      AND sl.change > 0
    ORDER BY sl.created_at
  LOOP
    v_reverse_key := 'rollback:' || v_ledger.idempotency_key;

    IF EXISTS (
      SELECT 1 FROM public.stock_ledger x WHERE x.idempotency_key = v_reverse_key
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(pv.stock, 0) INTO v_stock_before
    FROM public.product_variants pv
    WHERE pv.id = v_ledger.variant_id
    FOR UPDATE;

    v_stock_after := v_stock_before - v_ledger.change;

    UPDATE public.product_variants
    SET stock = v_stock_after
    WHERE id = v_ledger.variant_id;

    INSERT INTO public.stock_ledger (
      variant_id,
      product_id,
      change,
      reason,
      reference_id,
      stock_before,
      stock_after,
      note,
      source,
      reference_type,
      idempotency_key
    ) VALUES (
      v_ledger.variant_id,
      v_ledger.product_id,
      -v_ledger.change,
      'cutover_backfill',
      v_ledger.reference_id,
      v_stock_before,
      v_stock_after,
      'Phase 6D rollback: reverse cutover backfill',
      'inventory_cutover',
      'kk_reservation_cutover_rollback',
      v_reverse_key
    );

    v_reversed_units := v_reversed_units + v_ledger.change;
  END LOOP;

  UPDATE public.inventory_cutover_settings
  SET
    kk_reservation_mode = 'shadow',
    notes = 'Phase 6D rollback: reverted to shadow mode. Manual review required.',
    updated_at = now()
  WHERE id = 1;

  RETURN jsonb_build_object(
    'released_reservation_count', v_released,
    'demoted_reservation_count', v_demoted,
    'reversed_backfill_units', v_reversed_units,
    'mode_before', v_mode_before,
    'mode_after', 'shadow'
  );
END;
$$;

COMMENT ON FUNCTION public.rollback_kk_reservation_cutover() IS
  'Emergency rollback: cancel cutover active reservations, reverse cutover_backfill stock, flip mode back to shadow. Does not restore legacy order deduct semantics.';

REVOKE ALL ON FUNCTION public.rollback_kk_reservation_cutover() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rollback_kk_reservation_cutover() FROM anon;
GRANT EXECUTE ON FUNCTION public.rollback_kk_reservation_cutover() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_kk_reservation_cutover() TO service_role;

-- Update KPI view comment (behavior unchanged — already excludes shadow)
COMMENT ON VIEW public.v_inventory_kpis IS
  'Official KPIs. reserved = active (non-shadow) inventory_reservations. available = on_hand - reserved.';
