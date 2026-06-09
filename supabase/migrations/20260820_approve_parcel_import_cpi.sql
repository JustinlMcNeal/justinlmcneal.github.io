-- ================================================================
-- Parcel Imports — Migration 003: Approve + Update CPI RPC
-- Source: docs/pages/admin/parcelImport/implementation/012_phase_8_approve_cpi_plan.md
--
-- Creates public.approve_parcel_import_cpi for atomic approval,
-- product/variant cost updates, final allocation snapshot, and events.
-- Does NOT: stock, stock_ledger, expenses, inventory receipt.
-- ================================================================

CREATE OR REPLACE FUNCTION public.approve_parcel_import_cpi(
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
  v_status                   text;
  v_import                   public.parcel_imports%ROWTYPE;
  v_preview_count            integer;
  v_final_exists             integer;
  v_bad_business             integer;
  v_matched_business         integer;
  v_products_updated         integer := 0;
  v_variants_updated         integer := 0;
  v_rows_applied             integer := 0;
  v_rows_excluded            integer := 0;
  v_total_allocated_cny      numeric(12,4) := 0;
  v_weighted_cpi_cny         numeric(12,4);
  v_weighted_cpi_usd         numeric(12,4);
  v_fulfilled_preview_usd    numeric(12,4);
  v_total_qty                numeric(12,4) := 0;
  v_sum_cpi_cny              numeric(18,6) := 0;
  v_rec                      record;
  v_old_cost                 numeric(12,6);
  v_new_avg                  numeric(12,6);
  v_stock                    integer;
  v_variant_override_cents   integer;
  v_product_unit_cost        numeric(12,6);
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

  v_status := v_import.status;

  IF v_status IN ('voided', 'error') THEN
    RAISE EXCEPTION 'Import cannot be approved: status is %', v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status = 'approved' THEN
    RETURN jsonb_build_object(
      'import_id', p_import_id,
      'approved', true,
      'already_approved', true,
      'products_updated', 0,
      'variants_updated', 0,
      'rows_applied', coalesce(v_import.products_affected_count, 0),
      'rows_excluded', coalesce(v_import.rows_excluded_count, 0)
    );
  END IF;

  IF v_status <> 'ready_to_approve' THEN
    RAISE EXCEPTION 'Import must be ready_to_approve (current: %)', v_status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_preview_count
  FROM public.parcel_import_cost_allocations
  WHERE parcel_import_id = p_import_id
    AND allocation_run_type = 'preview';

  IF v_preview_count = 0 THEN
    RAISE EXCEPTION 'No preview allocations — save draft first'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_bad_business
  FROM public.parcel_import_item_mappings
  WHERE parcel_import_id = p_import_id
    AND row_type = 'business_inventory'
    AND mapping_status IN ('needs_mapping', 'variant_uncertain', 'parser_warning');

  IF v_bad_business > 0 THEN
    RAISE EXCEPTION 'Business rows still need mapping (% row(s))', v_bad_business
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_matched_business
  FROM public.parcel_import_item_mappings
  WHERE parcel_import_id = p_import_id
    AND row_type = 'business_inventory'
    AND mapping_status = 'matched'
    AND product_id IS NOT NULL
    AND product_variant_id IS NOT NULL;

  IF v_matched_business = 0 THEN
    RAISE EXCEPTION 'At least one matched business row with product and variant is required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_final_exists
  FROM public.parcel_import_cost_allocations
  WHERE parcel_import_id = p_import_id
    AND allocation_run_type = 'final';

  IF v_final_exists > 0 THEN
    RAISE EXCEPTION 'Final allocations already exist — import may already be approved'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Aggregate CPI targets and update product costs ─────────────
  FOR v_rec IN
    WITH cpi_rows AS (
      SELECT
        m.product_id,
        m.product_variant_id,
        coalesce(i.quantity, 0) AS quantity,
        coalesce(
          a.landed_cpi_usd,
          CASE
            WHEN a.landed_cpi_cny IS NOT NULL
              AND coalesce(a.effective_fx_rate, v_import.effective_fx_rate) > 0
            THEN a.landed_cpi_cny / coalesce(a.effective_fx_rate, v_import.effective_fx_rate)
            ELSE NULL
          END
        ) AS landed_cpi_usd,
        a.landed_cpi_cny,
        a.landed_total_cny
      FROM public.parcel_import_cost_allocations a
      INNER JOIN public.parcel_import_items i
        ON i.id = a.parcel_import_item_id
      INNER JOIN public.parcel_import_item_mappings m
        ON m.parcel_import_item_id = i.id
      WHERE a.parcel_import_id = p_import_id
        AND a.allocation_run_type = 'preview'
        AND m.row_type = 'business_inventory'
        AND m.mapping_status = 'matched'
        AND m.product_id IS NOT NULL
        AND m.product_variant_id IS NOT NULL
        AND coalesce(i.quantity, 0) > 0
    ),
    aggregated AS (
      SELECT
        product_id,
        product_variant_id,
        SUM(quantity)::numeric AS imported_qty,
        SUM(landed_cpi_usd * quantity) / NULLIF(SUM(quantity), 0) AS new_landed_cpi_usd
      FROM cpi_rows
      GROUP BY product_id, product_variant_id
    )
    SELECT *
    FROM aggregated
    WHERE new_landed_cpi_usd IS NOT NULL
  LOOP
    v_old_cost := NULL;
    v_stock := 0;
    v_variant_override_cents := NULL;
    v_product_unit_cost := NULL;

    SELECT
      coalesce(pv.stock, 0),
      pv.unit_cost_override_cents,
      p.unit_cost
    INTO v_stock, v_variant_override_cents, v_product_unit_cost
    FROM public.product_variants pv
    INNER JOIN public.products p ON p.id = pv.product_id
    WHERE pv.id = v_rec.product_variant_id
      AND pv.product_id = v_rec.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product variant not found: %', v_rec.product_variant_id
        USING ERRCODE = 'P0001';
    END IF;

    IF v_variant_override_cents IS NOT NULL THEN
      v_old_cost := v_variant_override_cents::numeric / 100.0;
    ELSIF v_product_unit_cost IS NOT NULL THEN
      v_old_cost := v_product_unit_cost;
    ELSE
      v_old_cost := v_rec.new_landed_cpi_usd;
    END IF;

    IF coalesce(v_stock, 0) > 0 THEN
      v_new_avg :=
        (
          (v_old_cost * v_stock) +
          (v_rec.new_landed_cpi_usd * v_rec.imported_qty)
        ) / (v_stock + v_rec.imported_qty);
    ELSE
      v_new_avg := v_rec.new_landed_cpi_usd;
    END IF;

    UPDATE public.product_variants
    SET unit_cost_override_cents = round(v_new_avg * 100)::integer
    WHERE id = v_rec.product_variant_id
      AND product_id = v_rec.product_id;

    v_variants_updated := v_variants_updated + 1;
    v_rows_applied := v_rows_applied + 1;
  END LOOP;

  -- Product-level fallback for matched business rows without variant (should not occur in v1)
  FOR v_rec IN
    WITH cpi_rows AS (
      SELECT
        m.product_id,
        coalesce(i.quantity, 0) AS quantity,
        coalesce(
          a.landed_cpi_usd,
          CASE
            WHEN a.landed_cpi_cny IS NOT NULL
              AND coalesce(a.effective_fx_rate, v_import.effective_fx_rate) > 0
            THEN a.landed_cpi_cny / coalesce(a.effective_fx_rate, v_import.effective_fx_rate)
            ELSE NULL
          END
        ) AS landed_cpi_usd
      FROM public.parcel_import_cost_allocations a
      INNER JOIN public.parcel_import_items i ON i.id = a.parcel_import_item_id
      INNER JOIN public.parcel_import_item_mappings m ON m.parcel_import_item_id = i.id
      WHERE a.parcel_import_id = p_import_id
        AND a.allocation_run_type = 'preview'
        AND m.row_type = 'business_inventory'
        AND m.mapping_status = 'matched'
        AND m.product_id IS NOT NULL
        AND m.product_variant_id IS NULL
        AND coalesce(i.quantity, 0) > 0
    ),
    aggregated AS (
      SELECT
        product_id,
        SUM(quantity)::numeric AS imported_qty,
        SUM(landed_cpi_usd * quantity) / NULLIF(SUM(quantity), 0) AS new_landed_cpi_usd
      FROM cpi_rows
      GROUP BY product_id
    )
    SELECT *
    FROM aggregated
    WHERE new_landed_cpi_usd IS NOT NULL
  LOOP
    SELECT p.unit_cost, coalesce(SUM(pv.stock), 0)::integer
    INTO v_product_unit_cost, v_stock
    FROM public.products p
    LEFT JOIN public.product_variants pv ON pv.product_id = p.id
    WHERE p.id = v_rec.product_id
    GROUP BY p.unit_cost;

    IF v_product_unit_cost IS NOT NULL THEN
      v_old_cost := v_product_unit_cost;
    ELSE
      v_old_cost := v_rec.new_landed_cpi_usd;
    END IF;

    IF coalesce(v_stock, 0) > 0 THEN
      v_new_avg :=
        (
          (v_old_cost * v_stock) +
          (v_rec.new_landed_cpi_usd * v_rec.imported_qty)
        ) / (v_stock + v_rec.imported_qty);
    ELSE
      v_new_avg := v_rec.new_landed_cpi_usd;
    END IF;

    UPDATE public.products
    SET unit_cost = v_new_avg
    WHERE id = v_rec.product_id;

    v_products_updated := v_products_updated + 1;
    v_rows_applied := v_rows_applied + 1;
  END LOOP;

  IF v_variants_updated + v_products_updated = 0 THEN
    RAISE EXCEPTION 'No product CPI targets updated — check FX rate and matched row allocations'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Snapshot totals from CPI-included preview rows ─────────────
  SELECT
    coalesce(SUM(a.landed_total_cny), 0),
    coalesce(SUM(
      CASE
        WHEN coalesce(i.quantity, 0) > 0 AND a.landed_cpi_cny IS NOT NULL
        THEN a.landed_cpi_cny * i.quantity
        ELSE 0
      END
    ), 0),
    coalesce(SUM(
      CASE
        WHEN coalesce(i.quantity, 0) > 0 AND a.landed_cpi_cny IS NOT NULL
        THEN i.quantity
        ELSE 0
      END
    ), 0)
  INTO v_total_allocated_cny, v_sum_cpi_cny, v_total_qty
  FROM public.parcel_import_cost_allocations a
  INNER JOIN public.parcel_import_items i ON i.id = a.parcel_import_item_id
  INNER JOIN public.parcel_import_item_mappings m ON m.parcel_import_item_id = i.id
  WHERE a.parcel_import_id = p_import_id
    AND a.allocation_run_type = 'preview'
    AND m.row_type = 'business_inventory'
    AND m.mapping_status = 'matched'
    AND m.product_id IS NOT NULL;

  IF v_total_qty > 0 THEN
    v_weighted_cpi_cny := v_sum_cpi_cny / v_total_qty;
    IF v_import.effective_fx_rate IS NOT NULL AND v_import.effective_fx_rate > 0 THEN
      v_weighted_cpi_usd := v_weighted_cpi_cny / v_import.effective_fx_rate;
      v_fulfilled_preview_usd := v_weighted_cpi_usd + 5;
    END IF;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_rows_excluded
  FROM public.parcel_import_item_mappings
  WHERE parcel_import_id = p_import_id
    AND row_type IN ('personal_excluded', 'supplies');

  -- ── Copy preview → final allocations ───────────────────────────
  INSERT INTO public.parcel_import_cost_allocations (
    parcel_import_id,
    parcel_import_item_id,
    allocation_run_type,
    allocation_method,
    product_cost_cny,
    seller_freight_cny,
    parcel_shipping_share_cny,
    service_share_cny,
    insurance_share_cny,
    fx_payment_share_cny,
    landed_total_cny,
    landed_cpi_cny,
    landed_cpi_usd,
    effective_fx_rate,
    included_in_product_cpi_preview,
    included_in_final_product_cpi,
    warnings
  )
  SELECT
    a.parcel_import_id,
    a.parcel_import_item_id,
    'final',
    a.allocation_method,
    a.product_cost_cny,
    a.seller_freight_cny,
    a.parcel_shipping_share_cny,
    a.service_share_cny,
    a.insurance_share_cny,
    a.fx_payment_share_cny,
    a.landed_total_cny,
    a.landed_cpi_cny,
    a.landed_cpi_usd,
    a.effective_fx_rate,
    a.included_in_product_cpi_preview,
    (
      m.row_type = 'business_inventory'
      AND m.mapping_status = 'matched'
      AND m.product_id IS NOT NULL
    ),
    a.warnings
  FROM public.parcel_import_cost_allocations a
  INNER JOIN public.parcel_import_items i ON i.id = a.parcel_import_item_id
  LEFT JOIN public.parcel_import_item_mappings m ON m.parcel_import_item_id = i.id
  WHERE a.parcel_import_id = p_import_id
    AND a.allocation_run_type = 'preview';

  -- ── Mark import approved ───────────────────────────────────────
  UPDATE public.parcel_imports
  SET
    status = 'approved',
    approved_at = now(),
    approved_by = v_actor,
    final_total_allocated_cny = NULLIF(v_total_allocated_cny, 0),
    final_weighted_landed_cpi_cny = v_weighted_cpi_cny,
    final_weighted_landed_cpi_usd = v_weighted_cpi_usd,
    final_fulfilled_cpi_preview_usd = v_fulfilled_preview_usd,
    products_affected_count = v_rows_applied,
    rows_excluded_count = v_rows_excluded,
    rows_needing_mapping_count = 0,
    cpi_update_applied_at = now(),
    approval_idempotency_key = nullif(btrim(p_idempotency_key), '')
  WHERE id = p_import_id;

  INSERT INTO public.parcel_import_events (
    parcel_import_id, event_type, event_message, event_payload, actor_id
  ) VALUES (
    p_import_id,
    'approved',
    'Parcel import approved',
    jsonb_build_object(
      'productsUpdated', v_products_updated,
      'variantsUpdated', v_variants_updated,
      'rowsApplied', v_rows_applied,
      'rowsExcluded', v_rows_excluded
    ),
    v_actor
  );

  INSERT INTO public.parcel_import_events (
    parcel_import_id, event_type, event_message, event_payload, actor_id
  ) VALUES (
    p_import_id,
    'cpi_update_applied',
    'Product CPI updated from parcel import',
    jsonb_build_object(
      'productsUpdated', v_products_updated,
      'variantsUpdated', v_variants_updated,
      'weightedLandedCpiUsd', v_weighted_cpi_usd,
      'idempotencyKey', nullif(btrim(p_idempotency_key), '')
    ),
    v_actor
  );

  RETURN jsonb_build_object(
    'import_id', p_import_id,
    'approved', true,
    'already_approved', false,
    'products_updated', v_products_updated,
    'variants_updated', v_variants_updated,
    'rows_applied', v_rows_applied,
    'rows_excluded', v_rows_excluded
  );
END;
$$;

COMMENT ON FUNCTION public.approve_parcel_import_cpi(uuid, text) IS
  'Approve a ready_to_approve parcel import, apply weighted CPI to mapped products/variants, snapshot final allocations. Requires authenticated caller.';

REVOKE ALL ON FUNCTION public.approve_parcel_import_cpi(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_parcel_import_cpi(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_parcel_import_cpi(uuid, text) TO authenticated;
