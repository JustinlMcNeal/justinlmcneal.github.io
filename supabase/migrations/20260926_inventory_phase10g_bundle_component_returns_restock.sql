-- Phase 10G — Admin-confirmed returns/restock for finalized live bundle component lines.

CREATE TABLE IF NOT EXISTS public.inventory_bundle_component_restock_actions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id          uuid NOT NULL REFERENCES public.inventory_reservations(id) ON DELETE RESTRICT,
  component_variant_id    uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  parent_bundle_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  source_order_id         text NOT NULL,
  source_order_item_id    text,
  restock_qty             integer NOT NULL CHECK (restock_qty > 0),
  reason                  text NOT NULL DEFAULT 'customer_return',
  note                    text,
  ledger_id               uuid REFERENCES public.stock_ledger(id) ON DELETE SET NULL,
  stock_before            integer,
  stock_after             integer,
  idempotency_key         text,
  actor_id                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status                  text NOT NULL DEFAULT 'applied'
                          CHECK (status IN ('applied', 'rejected', 'idempotent')),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bundle_component_restock_idempotency
  ON public.inventory_bundle_component_restock_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bundle_component_restock_reservation
  ON public.inventory_bundle_component_restock_actions (reservation_id, created_at DESC);

ALTER TABLE public.inventory_bundle_component_restock_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_bundle_component_restock_actions_service_all
  ON public.inventory_bundle_component_restock_actions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_bundle_component_restock_actions_authenticated_select
  ON public.inventory_bundle_component_restock_actions FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.inventory_bundle_component_restock_actions TO authenticated;
GRANT ALL ON public.inventory_bundle_component_restock_actions TO service_role;

CREATE OR REPLACE VIEW public.v_inventory_bundle_component_return_candidates AS
WITH restocked AS (
  SELECT
    ra.reservation_id,
    COALESCE(SUM(ra.restock_qty) FILTER (WHERE ra.status IN ('applied', 'idempotent')), 0)::integer AS qty_restocked
  FROM public.inventory_bundle_component_restock_actions ra
  GROUP BY ra.reservation_id
)
SELECT
  ir.id AS reservation_id,
  ir.parent_bundle_variant_id,
  ir.parent_order_item_id,
  ir.order_id AS source_order_id,
  ir.order_item_id AS source_order_item_id,
  ir.variant_id AS component_variant_id,
  COALESCE(NULLIF(BTRIM(comp_p.name), ''), 'Unknown') AS component_product_label,
  COALESCE(NULLIF(BTRIM(comp_pv.sku), ''), NULLIF(BTRIM(comp_pv.option_value), ''), '—') AS component_sku,
  COALESCE(NULLIF(BTRIM(bundle_p.name), ''), 'Unknown') AS parent_bundle_label,
  ir.quantity AS quantity_finalized,
  COALESCE(rs.qty_restocked, 0) AS quantity_already_restocked,
  GREATEST(ir.quantity - COALESCE(rs.qty_restocked, 0), 0)::integer AS quantity_available_to_restock,
  ir.updated_at AS finalized_at,
  ir.finalize_ledger_id AS matching_ledger_id,
  o.refund_status,
  NULL::text AS return_status,
  CASE
    WHEN ir.reservation_kind <> 'bundle_component' THEN 'manual_review'
    WHEN ir.status <> 'finalized' THEN 'not_finalized'
    WHEN COALESCE(rs.qty_restocked, 0) >= ir.quantity THEN 'already_restocked'
    WHEN ir.status = 'finalized'
      AND GREATEST(ir.quantity - COALESCE(rs.qty_restocked, 0), 0) > 0
      AND COALESCE(o.refund_status, '') IN ('full', 'partial') THEN 'refunded_no_return'
    WHEN ir.status = 'finalized'
      AND GREATEST(ir.quantity - COALESCE(rs.qty_restocked, 0), 0) > 0
      AND COALESCE(o.refund_status, '') NOT IN ('full', 'partial') THEN 'eligible_restock'
    WHEN ir.status = 'finalized'
      AND GREATEST(ir.quantity - COALESCE(rs.qty_restocked, 0), 0) > 0 THEN 'manual_review'
    ELSE 'manual_review'
  END AS suggested_action
FROM public.inventory_reservations ir
LEFT JOIN restocked rs ON rs.reservation_id = ir.id
LEFT JOIN public.orders_raw o ON o.stripe_checkout_session_id = ir.order_id
LEFT JOIN public.product_variants comp_pv ON comp_pv.id = ir.variant_id
LEFT JOIN public.products comp_p ON comp_p.id = comp_pv.product_id
LEFT JOIN public.product_variants bundle_pv ON bundle_pv.id = ir.parent_bundle_variant_id
LEFT JOIN public.products bundle_p ON bundle_p.id = bundle_pv.product_id
WHERE ir.channel = 'kk'
  AND ir.reservation_kind = 'bundle_component'
  AND COALESCE(ir.is_shadow, false) = false;

COMMENT ON VIEW public.v_inventory_bundle_component_return_candidates IS
  'Phase 10G: finalized live bundle component lines eligible for admin-confirmed restock.';

GRANT SELECT ON public.v_inventory_bundle_component_return_candidates TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.restock_bundle_component_line(
  p_restock_qty             integer,
  p_reservation_id          uuid DEFAULT NULL,
  p_source_order_id         text DEFAULT NULL,
  p_source_order_item_id    text DEFAULT NULL,
  p_component_variant_id    uuid DEFAULT NULL,
  p_reason                  text DEFAULT 'customer_return',
  p_note                    text DEFAULT NULL,
  p_idempotency_key         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor           uuid := auth.uid();
  v_is_admin        boolean := false;
  v_res             public.inventory_reservations%ROWTYPE;
  v_cand            record;
  v_restocked       integer := 0;
  v_available       integer := 0;
  v_stock_before    integer;
  v_stock_after     integer;
  v_ledger_id       uuid;
  v_audit_id        uuid;
  v_idem            text;
  v_ledger_note     text;
  v_existing_audit  uuid;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_is_admin;
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_restock_qty IS NULL OR p_restock_qty <= 0 THEN
    RAISE EXCEPTION 'restock_qty must be positive' USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    SELECT ra.id, ra.ledger_id INTO v_existing_audit, v_ledger_id
    FROM public.inventory_bundle_component_restock_actions ra
    WHERE ra.idempotency_key = btrim(p_idempotency_key)
    LIMIT 1;
    IF v_existing_audit IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true, 'idempotent', true,
        'audit_id', v_existing_audit, 'ledger_id', v_ledger_id,
        'message', 'Restock already applied for this idempotency key'
      );
    END IF;
  END IF;

  IF p_reservation_id IS NOT NULL THEN
    SELECT * INTO v_res FROM public.inventory_reservations WHERE id = p_reservation_id FOR UPDATE;
  ELSE
    SELECT * INTO v_res
    FROM public.inventory_reservations
    WHERE order_id = p_source_order_id
      AND (p_source_order_item_id IS NULL OR order_item_id = p_source_order_item_id)
      AND (p_component_variant_id IS NULL OR variant_id = p_component_variant_id)
      AND reservation_kind = 'bundle_component'
    ORDER BY updated_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bundle component reservation not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_res.reservation_kind <> 'bundle_component' THEN
    RAISE EXCEPTION 'Not a bundle_component reservation' USING ERRCODE = 'P0001';
  END IF;

  IF v_res.status <> 'finalized' THEN
    RAISE EXCEPTION 'Reservation is not finalized — use release flow for pre-finalize refunds' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cand
  FROM public.v_inventory_bundle_component_return_candidates c
  WHERE c.reservation_id = v_res.id;

  v_available := COALESCE(v_cand.quantity_available_to_restock, 0);
  v_restocked := COALESCE(v_cand.quantity_already_restocked, 0);

  IF p_restock_qty > v_available THEN
    INSERT INTO public.inventory_bundle_live_issues (
      issue_type, bundle_variant_id, order_id, order_item_id,
      component_variant_id, details
    ) VALUES (
      'bundle_component_over_restock_attempt',
      v_res.parent_bundle_variant_id, v_res.order_id, v_res.order_item_id,
      v_res.variant_id,
      jsonb_build_object(
        'requested', p_restock_qty, 'available', v_available,
        'reservation_id', v_res.id
      )
    );
    RAISE EXCEPTION 'Restock qty % exceeds available %', p_restock_qty, v_available USING ERRCODE = 'P0001';
  END IF;

  v_idem := COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    format('bundle_component_return:%s:%s', v_res.id, gen_random_uuid()::text)
  );

  SELECT COALESCE(pv.stock, 0) INTO v_stock_before
  FROM public.product_variants pv
  WHERE pv.id = v_res.variant_id
  FOR UPDATE;

  v_stock_after := v_stock_before + p_restock_qty;
  v_ledger_note := format(
    'Bundle component return restock (parent bundle %s, order %s, line %s). %s',
    COALESCE(v_res.parent_bundle_variant_id::text, '?'),
    v_res.order_id,
    COALESCE(v_res.order_item_id, '?'),
    COALESCE(NULLIF(btrim(p_note), ''), '')
  );

  UPDATE public.product_variants SET stock = v_stock_after WHERE id = v_res.variant_id;

  INSERT INTO public.stock_ledger (
    variant_id, product_id, change, reason, reference_id,
    stock_before, stock_after, note, source, reference_type, idempotency_key, created_by
  ) VALUES (
    v_res.variant_id, v_res.product_id, p_restock_qty, 'return_restock',
    v_res.order_id, v_stock_before, v_stock_after, v_ledger_note,
    'bundle_component_return', 'bundle_component_return', v_idem, v_actor
  )
  RETURNING id INTO v_ledger_id;

  INSERT INTO public.inventory_bundle_component_restock_actions (
    reservation_id, component_variant_id, parent_bundle_variant_id,
    source_order_id, source_order_item_id, restock_qty, reason, note,
    ledger_id, stock_before, stock_after, idempotency_key, actor_id, status
  ) VALUES (
    v_res.id, v_res.variant_id, v_res.parent_bundle_variant_id,
    v_res.order_id, v_res.order_item_id, p_restock_qty,
    COALESCE(NULLIF(btrim(p_reason), ''), 'customer_return'),
    p_note, v_ledger_id, v_stock_before, v_stock_after, v_idem, v_actor, 'applied'
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'audit_id', v_audit_id,
    'ledger_id', v_ledger_id,
    'reservation_id', v_res.id,
    'component_variant_id', v_res.variant_id,
    'restock_qty', p_restock_qty,
    'quantity_already_restocked', v_restocked + p_restock_qty,
    'quantity_available_to_restock', v_available - p_restock_qty,
    'stock_before', v_stock_before,
    'stock_after', v_stock_after,
    'message', 'Component stock restored — parent bundle stock unchanged'
  );
END;
$$;

COMMENT ON FUNCTION public.restock_bundle_component_line IS
  'Phase 10G: admin-confirmed restock for finalized bundle_component reservations only.';

GRANT EXECUTE ON FUNCTION public.restock_bundle_component_line TO authenticated;

-- Extend live issue types for over-restock attempts.
ALTER TABLE public.inventory_bundle_live_issues
  DROP CONSTRAINT IF EXISTS inventory_bundle_live_issues_issue_type_check;

ALTER TABLE public.inventory_bundle_live_issues
  ADD CONSTRAINT inventory_bundle_live_issues_issue_type_check
  CHECK (issue_type IN (
    'bundle_component_reservation_failed',
    'bundle_component_finalize_failed',
    'bundle_live_readiness_blocked',
    'bundle_component_shortage_live',
    'bundle_component_over_restock_attempt',
    'bundle_component_restock_manual_review'
  ));
