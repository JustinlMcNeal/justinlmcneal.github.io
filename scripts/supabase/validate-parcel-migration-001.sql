-- Parcel Imports Migration 001 validation (rolls back all test data)
-- Run: npx supabase db query --linked -f scripts/supabase/validate-parcel-migration-001.sql

DO $$
DECLARE
  v_import_id       uuid;
  v_item_b_id       uuid;
  v_cascade_item_id uuid;
  v_count           integer;
  v_items           integer;
  v_maps            integer;
  v_allocs          integer;
  v_events          integer;
BEGIN
  -- Constraint: invalid status rejected
  BEGIN
    INSERT INTO public.parcel_imports (parcel_id, status)
    VALUES ('val-001', 'bogus_status');
    RAISE EXCEPTION 'FAIL: invalid status accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: invalid status rejected';
  END;

  -- Constraint: negative actual_shipment_fee_cny rejected
  BEGIN
    INSERT INTO public.parcel_imports (parcel_id, actual_shipment_fee_cny)
    VALUES ('val-002', -1);
    RAISE EXCEPTION 'FAIL: negative actual_shipment_fee_cny accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS: negative actual_shipment_fee_cny rejected';
  END;

  -- Parent import for child tests
  INSERT INTO public.parcel_imports (parcel_id)
  VALUES ('val-cascade-227461')
  RETURNING id INTO v_import_id;

  INSERT INTO public.parcel_import_items (
    parcel_import_id, row_number, source_item_name
  ) VALUES (
    v_import_id, 1, 'test item A'
  );

  -- Constraint: duplicate row_number rejected
  BEGIN
    INSERT INTO public.parcel_import_items (
      parcel_import_id, row_number, source_item_name
    ) VALUES (v_import_id, 1, 'duplicate row');
    RAISE EXCEPTION 'FAIL: duplicate row_number accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: duplicate row_number rejected';
  END;

  -- Constraint: duplicate parcel_import_item_id on mappings
  INSERT INTO public.parcel_import_items (
    parcel_import_id, row_number, source_item_name
  ) VALUES (v_import_id, 2, 'test item B')
  RETURNING id INTO v_item_b_id;

  INSERT INTO public.parcel_import_item_mappings (
    parcel_import_item_id, parcel_import_id, row_type, mapping_status
  ) VALUES (
    v_item_b_id, v_import_id, 'unknown', 'needs_mapping'
  );

  BEGIN
    INSERT INTO public.parcel_import_item_mappings (
      parcel_import_item_id, parcel_import_id, row_type, mapping_status
    ) VALUES (v_item_b_id, v_import_id, 'unknown', 'needs_mapping');
    RAISE EXCEPTION 'FAIL: duplicate parcel_import_item_id accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: duplicate parcel_import_item_id rejected';
  END;

  -- Constraint: duplicate approval_idempotency_key when not null
  INSERT INTO public.parcel_imports (parcel_id, approval_idempotency_key)
  VALUES ('val-idem-1', 'idem-key-001');

  BEGIN
    INSERT INTO public.parcel_imports (parcel_id, approval_idempotency_key)
    VALUES ('val-idem-2', 'idem-key-001');
    RAISE EXCEPTION 'FAIL: duplicate approval_idempotency_key accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'PASS: duplicate approval_idempotency_key rejected';
  END;

  -- Constraint: duplicate parcel_id allowed
  INSERT INTO public.parcel_imports (parcel_id)
  VALUES ('val-cascade-227461');

  SELECT COUNT(*) INTO v_count
  FROM public.parcel_imports
  WHERE parcel_id = 'val-cascade-227461';

  IF v_count < 2 THEN
    RAISE EXCEPTION 'FAIL: duplicate parcel_id not allowed (count=%)', v_count;
  END IF;
  RAISE NOTICE 'PASS: duplicate parcel_id allowed (count=%)', v_count;

  -- FK cascade: delete parent removes children
  INSERT INTO public.parcel_import_items (
    parcel_import_id, row_number, source_item_name
  ) VALUES (v_import_id, 10, 'cascade item')
  RETURNING id INTO v_cascade_item_id;

  INSERT INTO public.parcel_import_item_mappings (
    parcel_import_item_id, parcel_import_id, row_type, mapping_status
  ) VALUES (
    v_cascade_item_id, v_import_id, 'business_inventory', 'needs_mapping'
  );

  INSERT INTO public.parcel_import_cost_allocations (
    parcel_import_id, parcel_import_item_id,
    allocation_run_type, allocation_method, landed_total_cny
  ) VALUES (
    v_import_id, v_cascade_item_id, 'preview', 'weight_based', 12.34
  );

  INSERT INTO public.parcel_import_events (
    parcel_import_id, event_type, event_message
  ) VALUES (
    v_import_id, 'draft_saved', 'validation smoke'
  );

  DELETE FROM public.parcel_imports WHERE id = v_import_id;

  SELECT COUNT(*) INTO v_items FROM public.parcel_import_items
  WHERE parcel_import_id = v_import_id;
  SELECT COUNT(*) INTO v_maps FROM public.parcel_import_item_mappings
  WHERE parcel_import_id = v_import_id;
  SELECT COUNT(*) INTO v_allocs FROM public.parcel_import_cost_allocations
  WHERE parcel_import_id = v_import_id;
  SELECT COUNT(*) INTO v_events FROM public.parcel_import_events
  WHERE parcel_import_id = v_import_id;

  IF v_items > 0 OR v_maps > 0 OR v_allocs > 0 OR v_events > 0 THEN
    RAISE EXCEPTION 'FAIL: cascade delete left children (items=%, maps=%, allocs=%, events=%)',
      v_items, v_maps, v_allocs, v_events;
  END IF;
  RAISE NOTICE 'PASS: FK cascade delete removed all children';

  -- Cleanup all validation rows (DO block is auto-committed; explicit delete)
  DELETE FROM public.parcel_imports
  WHERE parcel_id IN ('val-001', 'val-002', 'val-idem-1', 'val-idem-2', 'val-cascade-227461')
     OR approval_idempotency_key = 'idem-key-001';

  RAISE NOTICE 'DONE: all validation checks completed';
END $$;
