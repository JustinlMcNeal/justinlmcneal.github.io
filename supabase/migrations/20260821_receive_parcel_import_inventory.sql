-- ================================================================
-- Parcel Imports — Migration 004: Receive Inventory RPC
-- Source: docs/pages/admin/parcelImport/implementation/016_phase_11_inventory_receiving_plan.md
--
-- Adds inventory_received_* columns and receive_parcel_import_inventory RPC.
-- Updates product_variants.stock + stock_ledger only inside this RPC.
-- Does NOT: expenses, CPI/cost updates, inventory_receipts table.
-- ================================================================

ALTER TABLE public.parcel_imports
  ADD COLUMN IF NOT EXISTS inventory_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS inventory_received_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inventory_receive_idempotency_key text;

COMMENT ON COLUMN public.parcel_imports.inventory_received_at IS
  'Timestamp when stock was received into product_variants for this import.';

COMMENT ON COLUMN public.parcel_imports.inventory_received_by IS
  'Authenticated user who received inventory for this import.';

COMMENT ON COLUMN public.parcel_imports.inventory_receive_idempotency_key IS
  'Client-supplied idempotency key for inventory receive; partial unique when set.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_imports_inventory_receive_idempotency
  ON public.parcel_imports (inventory_receive_idempotency_key)
  WHERE inventory_receive_idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.receive_parcel_import_inventory(
  p_import_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_actor                    uuid := auth.uid();
  v_import                   public.parcel_imports%ROWTYPE;
  v_unmapped_business        integer := 0;
  v_rows_received            integer := 0;
  v_variants_updated         integer := 0;
  v_total_units              integer := 0;
  v_rec                      record;
  v_stock_before             integer;
  v_stock_after              integer;
  v_product_id               uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_import_id IS NULL THEN
    RAISE EXCEPTION 'import_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_import
  FROM public.parcel_imports
  WHERE id = p_import_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import not found: %', p_import_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_import.status <> 'approved' THEN
    RAISE EXCEPTION 'Import must be approved before receiving inventory (status: %)', v_import.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_import.inventory_received_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'import_id', p_import_id,
      'received', true,
      'already_received', true,
      'variants_updated', 0,
      'total_units_received', 0,
      'rows_received', 0
    );
  END IF;

  SELECT count(*)
  INTO v_unmapped_business
  FROM public.parcel_import_item_mappings m
  WHERE m.parcel_import_id = p_import_id
    AND m.row_type = 'business_inventory'
    AND (
      m.mapping_status <> 'matched'
      OR m.product_variant_id IS NULL
    );

  IF v_unmapped_business > 0 THEN
    RAISE EXCEPTION 'Unmapped business inventory rows remain (%). Complete mapping before receiving.', v_unmapped_business
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_rows_received
  FROM public.parcel_import_items i
  JOIN public.parcel_import_item_mappings m
    ON m.parcel_import_item_id = i.id
  WHERE i.parcel_import_id = p_import_id
    AND m.row_type = 'business_inventory'
    AND m.mapping_status = 'matched'
    AND m.product_variant_id IS NOT NULL
    AND coalesce(i.quantity, 0) > 0;

  IF v_rows_received = 0 THEN
    RAISE EXCEPTION 'No receivable inventory rows — map business rows with quantity > 0.'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_rec IN
    SELECT
      m.product_variant_id,
      sum(i.quantity)::integer AS qty
    FROM public.parcel_import_items i
    JOIN public.parcel_import_item_mappings m
      ON m.parcel_import_item_id = i.id
    WHERE i.parcel_import_id = p_import_id
      AND m.row_type = 'business_inventory'
      AND m.mapping_status = 'matched'
      AND m.product_variant_id IS NOT NULL
      AND coalesce(i.quantity, 0) > 0
    GROUP BY m.product_variant_id
    HAVING sum(i.quantity) > 0
  LOOP
    SELECT pv.stock, pv.product_id
    INTO v_stock_before, v_product_id
    FROM public.product_variants pv
    WHERE pv.id = v_rec.product_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product variant not found: %', v_rec.product_variant_id
        USING ERRCODE = 'P0001';
    END IF;

    v_stock_after := coalesce(v_stock_before, 0) + v_rec.qty;

    UPDATE public.product_variants
    SET stock = v_stock_after
    WHERE id = v_rec.product_variant_id;

    INSERT INTO public.stock_ledger (
      variant_id,
      product_id,
      change,
      reason,
      reference_id,
      stock_before,
      stock_after
    ) VALUES (
      v_rec.product_variant_id,
      v_product_id,
      v_rec.qty,
      'parcel_receive',
      p_import_id::text,
      coalesce(v_stock_before, 0),
      v_stock_after
    );

    v_variants_updated := v_variants_updated + 1;
    v_total_units := v_total_units + v_rec.qty;
  END LOOP;

  UPDATE public.parcel_imports
  SET
    inventory_received_at = now(),
    inventory_received_by = v_actor,
    inventory_receive_idempotency_key = nullif(btrim(p_idempotency_key), '')
  WHERE id = p_import_id;

  INSERT INTO public.parcel_import_events (
    parcel_import_id, event_type, event_message, event_payload, actor_id
  ) VALUES (
    p_import_id,
    'inventory_received',
    'Inventory received into product variant stock',
    jsonb_build_object(
      'variantsUpdated', v_variants_updated,
      'totalUnitsReceived', v_total_units,
      'rowsReceived', v_rows_received,
      'idempotencyKey', nullif(btrim(p_idempotency_key), '')
    ),
    v_actor
  );

  RETURN jsonb_build_object(
    'import_id', p_import_id,
    'received', true,
    'already_received', false,
    'variants_updated', v_variants_updated,
    'total_units_received', v_total_units,
    'rows_received', v_rows_received
  );
END;
$$;

COMMENT ON FUNCTION public.receive_parcel_import_inventory(uuid, text) IS
  'Receive approved parcel import inventory into product_variants.stock with stock_ledger audit. Requires authenticated caller.';

REVOKE ALL ON FUNCTION public.receive_parcel_import_inventory(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receive_parcel_import_inventory(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.receive_parcel_import_inventory(uuid, text) TO authenticated;
