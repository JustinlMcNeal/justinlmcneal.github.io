-- Phase 10J — RMA / return workflow for finalized bundle component reservations (workflow-only; no stock mutations).

CREATE TABLE IF NOT EXISTS public.inventory_return_workflow (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel            text NOT NULL DEFAULT 'kk',
  source_order_id           text NOT NULL,
  source_order_item_id      text,
  reservation_id            uuid REFERENCES public.inventory_reservations(id) ON DELETE SET NULL,
  parent_bundle_variant_id  uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  component_variant_id      uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity_expected         integer NOT NULL CHECK (quantity_expected > 0),
  quantity_received         integer NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_restocked        integer NOT NULL DEFAULT 0 CHECK (quantity_restocked >= 0),
  status                    text NOT NULL DEFAULT 'open'
                            CHECK (status IN (
                              'open', 'return_expected', 'received', 'partially_received',
                              'inspected', 'restocked', 'closed', 'canceled'
                            )),
  condition                 text NOT NULL DEFAULT 'unknown'
                            CHECK (condition IN ('unknown', 'resellable', 'damaged', 'missing', 'partial')),
  rma_number                text,
  tracking_number           text,
  note                      text,
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  closed_at                 timestamptz
);

CREATE INDEX IF NOT EXISTS idx_inventory_return_workflow_reservation
  ON public.inventory_return_workflow (reservation_id, updated_at DESC)
  WHERE reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_return_workflow_order
  ON public.inventory_return_workflow (source_order_id, source_order_item_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_return_workflow_status
  ON public.inventory_return_workflow (status, updated_at DESC)
  WHERE status NOT IN ('closed', 'canceled');

ALTER TABLE public.inventory_return_workflow ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_return_workflow_service_all
  ON public.inventory_return_workflow FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY inventory_return_workflow_authenticated_select
  ON public.inventory_return_workflow FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.inventory_return_workflow TO authenticated;
GRANT ALL ON public.inventory_return_workflow TO service_role;

COMMENT ON TABLE public.inventory_return_workflow IS
  'Phase 10J: admin RMA/return workflow tracking — does not mutate stock or reservations.';

-- Populate return_status on candidates from latest active workflow.
CREATE OR REPLACE VIEW public.v_inventory_bundle_component_return_candidates AS
WITH restocked AS (
  SELECT
    ra.reservation_id,
    COALESCE(SUM(ra.restock_qty) FILTER (WHERE ra.status IN ('applied', 'idempotent')), 0)::integer AS qty_restocked
  FROM public.inventory_bundle_component_restock_actions ra
  GROUP BY ra.reservation_id
),
latest_workflow AS (
  SELECT DISTINCT ON (rw.reservation_id)
    rw.reservation_id,
    rw.id AS workflow_id,
    rw.status AS workflow_status,
    rw.condition AS workflow_condition
  FROM public.inventory_return_workflow rw
  WHERE rw.reservation_id IS NOT NULL
    AND rw.status NOT IN ('closed', 'canceled')
  ORDER BY rw.reservation_id, rw.updated_at DESC
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
  lw.workflow_status AS return_status,
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
LEFT JOIN latest_workflow lw ON lw.reservation_id = ir.id
LEFT JOIN public.product_variants comp_pv ON comp_pv.id = ir.variant_id
LEFT JOIN public.products comp_p ON comp_p.id = comp_pv.product_id
LEFT JOIN public.product_variants bundle_pv ON bundle_pv.id = ir.parent_bundle_variant_id
LEFT JOIN public.products bundle_p ON bundle_p.id = bundle_pv.product_id
WHERE ir.channel = 'kk'
  AND ir.reservation_kind = 'bundle_component'
  AND COALESCE(ir.is_shadow, false) = false;

COMMENT ON VIEW public.v_inventory_bundle_component_return_candidates IS
  'Phase 10G+10J: finalized live bundle component lines with return workflow status.';

GRANT SELECT ON public.v_inventory_bundle_component_return_candidates TO authenticated, service_role;

-- Companion view: guidance + workflow fields + next action.
CREATE OR REPLACE VIEW public.v_inventory_bundle_component_return_workflow_guidance AS
WITH latest_workflow AS (
  SELECT DISTINCT ON (rw.reservation_id)
    rw.*
  FROM public.inventory_return_workflow rw
  WHERE rw.reservation_id IS NOT NULL
    AND rw.status NOT IN ('canceled')
  ORDER BY rw.reservation_id, rw.updated_at DESC
)
SELECT
  g.*,
  w.condition AS workflow_condition,
  w.quantity_expected AS workflow_quantity_expected,
  w.quantity_received AS workflow_quantity_received,
  w.quantity_restocked AS workflow_quantity_restocked,
  w.rma_number AS workflow_rma_number,
  w.tracking_number AS workflow_tracking_number,
  w.note AS workflow_note,
  w.closed_at AS workflow_closed_at,
  CASE
    WHEN w.id IS NULL AND g.max_restockable_qty > 0 THEN 'create_rma'
    WHEN w.status IN ('open', 'return_expected') THEN 'wait_for_return'
    WHEN w.status IN ('received', 'partially_received') THEN 'inspect_return'
    WHEN w.status = 'inspected'
      AND w.condition = 'resellable'
      AND g.max_restockable_qty > 0 THEN 'restock_received'
    WHEN w.status = 'restocked' OR w.status = 'closed' THEN 'close_return'
    WHEN w.condition IN ('damaged', 'missing') THEN 'manual_review'
    WHEN w.status = 'inspected' AND g.max_restockable_qty <= 0 THEN 'close_return'
    ELSE 'manual_review'
  END AS workflow_next_action
FROM public.v_inventory_bundle_component_return_guidance g
LEFT JOIN latest_workflow w ON w.reservation_id = g.reservation_id;

COMMENT ON VIEW public.v_inventory_bundle_component_return_workflow_guidance IS
  'Phase 10J: return guidance plus RMA workflow status and recommended next action (read-only).';

GRANT SELECT ON public.v_inventory_bundle_component_return_workflow_guidance TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_inventory_return_workflow(
  p_reservation_id          uuid,
  p_quantity_expected       integer DEFAULT NULL,
  p_source_channel          text DEFAULT 'kk',
  p_rma_number              text DEFAULT NULL,
  p_tracking_number         text DEFAULT NULL,
  p_note                    text DEFAULT NULL,
  p_status                  text DEFAULT 'return_expected'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_admin   boolean := false;
  v_res     public.inventory_reservations%ROWTYPE;
  v_qty     integer;
  v_id      uuid;
  v_status  text := COALESCE(NULLIF(btrim(p_status), ''), 'return_expected');
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

  IF v_status NOT IN ('open', 'return_expected', 'received', 'partially_received', 'inspected', 'restocked', 'closed', 'canceled') THEN
    RAISE EXCEPTION 'Invalid workflow status' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_res FROM public.inventory_reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_res.reservation_kind <> 'bundle_component' OR v_res.status <> 'finalized' THEN
    RAISE EXCEPTION 'Return workflow requires a finalized bundle_component reservation' USING ERRCODE = 'P0001';
  END IF;

  v_qty := COALESCE(p_quantity_expected, v_res.quantity);
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'quantity_expected must be positive' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.inventory_return_workflow (
    source_channel, source_order_id, source_order_item_id,
    reservation_id, parent_bundle_variant_id, component_variant_id,
    quantity_expected, status, rma_number, tracking_number, note,
    created_by, updated_by
  ) VALUES (
    COALESCE(NULLIF(btrim(p_source_channel), ''), 'kk'),
    v_res.order_id,
    v_res.order_item_id,
    v_res.id,
    v_res.parent_bundle_variant_id,
    v_res.variant_id,
    v_qty,
    v_status,
    NULLIF(btrim(p_rma_number), ''),
    NULLIF(btrim(p_tracking_number), ''),
    NULLIF(btrim(p_note), ''),
    v_actor,
    v_actor
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'workflow_id', v_id,
    'reservation_id', v_res.id,
    'status', v_status,
    'quantity_expected', v_qty,
    'message', 'Return workflow created — no stock changed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_inventory_return_workflow(
  p_workflow_id             uuid,
  p_status                  text DEFAULT NULL,
  p_condition               text DEFAULT NULL,
  p_quantity_received       integer DEFAULT NULL,
  p_quantity_restocked      integer DEFAULT NULL,
  p_rma_number              text DEFAULT NULL,
  p_tracking_number         text DEFAULT NULL,
  p_note                    text DEFAULT NULL,
  p_override_note           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_admin   boolean := false;
  v_row     public.inventory_return_workflow%ROWTYPE;
  v_recv    integer;
  v_rest    integer;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_admin;
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_workflow_id IS NULL THEN
    RAISE EXCEPTION 'workflow_id is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.inventory_return_workflow WHERE id = p_workflow_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return workflow not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status IN ('closed', 'canceled') THEN
    RAISE EXCEPTION 'Cannot update a closed or canceled workflow' USING ERRCODE = 'P0001';
  END IF;

  v_recv := COALESCE(p_quantity_received, v_row.quantity_received);
  v_rest := COALESCE(p_quantity_restocked, v_row.quantity_restocked);

  IF v_recv > v_row.quantity_expected THEN
    RAISE EXCEPTION 'quantity_received cannot exceed quantity_expected' USING ERRCODE = 'P0001';
  END IF;

  IF v_rest > v_recv THEN
    IF p_override_note IS NULL OR btrim(p_override_note) = '' THEN
      RAISE EXCEPTION 'quantity_restocked exceeds quantity_received — provide override note' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_status IS NOT NULL AND btrim(p_status) <> '' THEN
    IF p_status NOT IN ('open', 'return_expected', 'received', 'partially_received', 'inspected', 'restocked', 'closed', 'canceled') THEN
      RAISE EXCEPTION 'Invalid workflow status' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_condition IS NOT NULL AND btrim(p_condition) <> '' THEN
    IF p_condition NOT IN ('unknown', 'resellable', 'damaged', 'missing', 'partial') THEN
      RAISE EXCEPTION 'Invalid workflow condition' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.inventory_return_workflow SET
    status = COALESCE(NULLIF(btrim(p_status), ''), status),
    condition = COALESCE(NULLIF(btrim(p_condition), ''), condition),
    quantity_received = v_recv,
    quantity_restocked = v_rest,
    rma_number = COALESCE(NULLIF(btrim(p_rma_number), ''), rma_number),
    tracking_number = COALESCE(NULLIF(btrim(p_tracking_number), ''), tracking_number),
    note = CASE
      WHEN p_note IS NOT NULL AND btrim(p_note) <> '' THEN
        CASE WHEN note IS NULL OR note = '' THEN btrim(p_note)
        ELSE note || E'\n' || btrim(p_note) END
      ELSE note
    END,
    updated_by = v_actor,
    updated_at = now(),
    closed_at = CASE
      WHEN COALESCE(NULLIF(btrim(p_status), ''), status) IN ('closed', 'canceled') THEN now()
      ELSE closed_at
    END
  WHERE id = p_workflow_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'workflow_id', v_row.id,
    'status', v_row.status,
    'condition', v_row.condition,
    'quantity_received', v_row.quantity_received,
    'quantity_restocked', v_row.quantity_restocked,
    'message', 'Return workflow updated — no stock changed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_inventory_return_workflow(
  p_workflow_id             uuid,
  p_note                    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_admin boolean := false;
  v_row   public.inventory_return_workflow%ROWTYPE;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_admin;
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.inventory_return_workflow SET
    status = 'closed',
    note = CASE
      WHEN p_note IS NOT NULL AND btrim(p_note) <> '' THEN
        CASE WHEN note IS NULL OR note = '' THEN btrim(p_note)
        ELSE note || E'\n[closed] ' || btrim(p_note) END
      ELSE note
    END,
    updated_by = v_actor,
    updated_at = now(),
    closed_at = now()
  WHERE id = p_workflow_id
    AND status NOT IN ('closed', 'canceled')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return workflow not found or already closed' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'workflow_id', v_row.id,
    'status', v_row.status,
    'message', 'Return workflow closed — no stock changed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.link_return_workflow_restock(
  p_workflow_id             uuid,
  p_restock_qty             integer,
  p_reservation_id          uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_admin   boolean := false;
  v_row     public.inventory_return_workflow%ROWTYPE;
  v_new_rest integer;
  v_new_status text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(public.is_admin(), false) INTO v_admin;
    IF NOT v_admin THEN
      RAISE EXCEPTION 'Admin only' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_restock_qty IS NULL OR p_restock_qty <= 0 THEN
    RAISE EXCEPTION 'restock_qty must be positive' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.inventory_return_workflow WHERE id = p_workflow_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return workflow not found' USING ERRCODE = 'P0001';
  END IF;

  IF p_reservation_id IS NOT NULL AND v_row.reservation_id IS DISTINCT FROM p_reservation_id THEN
    RAISE EXCEPTION 'Workflow reservation mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status IN ('closed', 'canceled') THEN
    RAISE EXCEPTION 'Cannot link restock to closed workflow' USING ERRCODE = 'P0001';
  END IF;

  v_new_rest := v_row.quantity_restocked + p_restock_qty;

  IF v_new_rest > GREATEST(v_row.quantity_received, v_row.quantity_expected) THEN
    RAISE EXCEPTION 'Workflow restock qty exceeds received/expected — update received first or use override note via update RPC' USING ERRCODE = 'P0001';
  END IF;

  v_new_status := CASE
    WHEN v_new_rest >= v_row.quantity_expected THEN 'restocked'
    WHEN v_row.quantity_received > 0 AND v_new_rest < v_row.quantity_received THEN 'partially_received'
    ELSE v_row.status
  END;

  UPDATE public.inventory_return_workflow SET
    quantity_restocked = v_new_rest,
    status = v_new_status,
    updated_by = v_actor,
    updated_at = now()
  WHERE id = p_workflow_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'workflow_id', v_row.id,
    'status', v_row.status,
    'quantity_restocked', v_row.quantity_restocked,
    'message', 'Return workflow linked to restock — no additional stock changed'
  );
END;
$$;

COMMENT ON FUNCTION public.create_inventory_return_workflow IS
  'Phase 10J: create RMA/return workflow row only — no stock/reservation mutations.';
COMMENT ON FUNCTION public.update_inventory_return_workflow IS
  'Phase 10J: update return workflow status/qty — no stock mutations.';
COMMENT ON FUNCTION public.close_inventory_return_workflow IS
  'Phase 10J: close return workflow — no stock mutations.';
COMMENT ON FUNCTION public.link_return_workflow_restock IS
  'Phase 10J: record restock qty on workflow after confirmed restock RPC — no stock mutations.';

GRANT EXECUTE ON FUNCTION public.create_inventory_return_workflow TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory_return_workflow TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_inventory_return_workflow TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_return_workflow_restock TO authenticated;
