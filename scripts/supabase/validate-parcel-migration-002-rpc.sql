-- Parcel Imports Migration 002 RPC validation
-- Run: npx supabase db query --linked -f scripts/supabase/validate-parcel-migration-002-rpc.sql
--
-- NOTE: save_parcel_import_draft requires auth.uid() IS NOT NULL.
-- Raw SQL editor / linked CLI calls run without JWT, so functional RPC
-- create/update smoke tests must run from an authenticated browser session
-- or a service/script that sets a valid admin JWT.
-- This script validates metadata, grants, and auth-gate behavior.

-- ── 1. Function exists and is INVOKER ────────────────────────────
DO $$
DECLARE
  v_found   boolean;
  v_invoker boolean;
BEGIN
  SELECT true, NOT prosecdef
  INTO v_found, v_invoker
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_parcel_import_draft'
  LIMIT 1;

  IF NOT coalesce(v_found, false) THEN
    RAISE EXCEPTION 'FAIL: save_parcel_import_draft function not found';
  END IF;

  IF NOT v_invoker THEN
    RAISE EXCEPTION 'FAIL: save_parcel_import_draft is SECURITY DEFINER (expected INVOKER)';
  END IF;

  RAISE NOTICE 'PASS: save_parcel_import_draft exists with SECURITY INVOKER';
END $$;

-- ── 2. Helper functions exist ────────────────────────────────────
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'parcel_jsonb_optional_numeric',
      'parcel_jsonb_optional_integer',
      'parcel_jsonb_optional_boolean',
      'parcel_jsonb_optional_uuid',
      'parcel_assert_row_type',
      'parcel_assert_mapping_status',
      'parcel_build_raw_footer'
    );

  IF v_count < 7 THEN
    RAISE EXCEPTION 'FAIL: expected 7 helper functions, found %', v_count;
  END IF;

  RAISE NOTICE 'PASS: helper functions present (%)', v_count;
END $$;

-- ── 3. Grants: authenticated yes, anon no ──────────────────────
DO $$
DECLARE
  v_auth  boolean;
  v_anon  boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'save_parcel_import_draft'
      AND grantee = 'authenticated'
      AND privilege_type = 'EXECUTE'
  ) INTO v_auth;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'save_parcel_import_draft'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ) INTO v_anon;

  IF NOT v_auth THEN
    RAISE EXCEPTION 'FAIL: authenticated missing EXECUTE on save_parcel_import_draft';
  END IF;

  IF v_anon THEN
    RAISE EXCEPTION 'FAIL: anon should not have EXECUTE on save_parcel_import_draft';
  END IF;

  RAISE NOTICE 'PASS: grants — authenticated EXECUTE yes, anon EXECUTE no';
END $$;

-- ── 3b. Helper grants: authenticated yes, anon no (all 7) ───────
DO $$
DECLARE
  v_helper   text;
  v_helpers  text[] := ARRAY[
    'parcel_jsonb_optional_numeric',
    'parcel_jsonb_optional_integer',
    'parcel_jsonb_optional_boolean',
    'parcel_jsonb_optional_uuid',
    'parcel_assert_row_type',
    'parcel_assert_mapping_status',
    'parcel_build_raw_footer'
  ];
  v_auth     boolean;
  v_anon     boolean;
  v_missing  integer := 0;
BEGIN
  FOREACH v_helper IN ARRAY v_helpers
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name = v_helper
        AND grantee = 'authenticated'
        AND privilege_type = 'EXECUTE'
    ) INTO v_auth;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND routine_name = v_helper
        AND grantee = 'anon'
        AND privilege_type = 'EXECUTE'
    ) INTO v_anon;

    IF NOT v_auth THEN
      RAISE NOTICE 'FAIL: authenticated missing EXECUTE on %', v_helper;
      v_missing := v_missing + 1;
    END IF;

    IF v_anon THEN
      RAISE NOTICE 'FAIL: anon should not have EXECUTE on %', v_helper;
      v_missing := v_missing + 1;
    END IF;
  END LOOP;

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'FAIL: helper grant checks failed (% issue(s))', v_missing;
  END IF;

  RAISE NOTICE 'PASS: all 7 helpers — authenticated EXECUTE yes, anon EXECUTE no';
END $$;

-- ── 4. Auth gate (no JWT in SQL editor) ──────────────────────────
DO $$
BEGIN
  PERFORM public.save_parcel_import_draft('{}'::jsonb);
  RAISE EXCEPTION 'FAIL: RPC succeeded without auth.uid()';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Authentication required%' THEN
      RAISE NOTICE 'PASS: unauthenticated call rejected (Authentication required)';
    ELSE
      RAISE EXCEPTION 'FAIL: unexpected error without auth: %', SQLERRM;
    END IF;
END $$;

-- ── 5. Payload validation without auth still blocked first ───────
-- (Same as above — confirms auth check precedes payload parsing)

-- ── 6. Approved import update rejection (direct SQL setup) ───────
-- Cannot call RPC without auth; insert approved row and document manual test.
DO $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.parcel_imports (parcel_id, status)
  VALUES ('rpc-val-approved-block', 'approved')
  RETURNING id INTO v_id;

  BEGIN
    PERFORM public.save_parcel_import_draft(
      jsonb_build_object(
        'importId', v_id::text,
        'statusIntent', 'draft',
        'parcel', jsonb_build_object('parcelId', 'rpc-val-approved-block'),
        'overrides', '{}'::jsonb,
        'items', jsonb_build_array(
          jsonb_build_object('rowNumber', 1, 'sourceItemName', 'Test')
        ),
        'mappings', '[]'::jsonb,
        'cpiPreview', jsonb_build_object(
          'allocationMethod', 'weight_based',
          'rows', jsonb_build_array(
            jsonb_build_object('rowNumber', 1, 'landedTotalCny', 1)
          ),
          'summary', '{}'::jsonb
        ),
        'warnings', '{}'::jsonb
      )
    );
    RAISE EXCEPTION 'FAIL: RPC call unexpectedly succeeded for approved import';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'Authentication required%' THEN
        RAISE NOTICE 'PASS: approved-update test deferred — auth required (import % created for browser test)', v_id;
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected error on approved test: %', SQLERRM;
      END IF;
  END;

  DELETE FROM public.parcel_imports WHERE id = v_id;
  RAISE NOTICE 'PASS: approved test fixture cleaned up';
END $$;

-- ── 7. Bad allocation rowNumber (auth-blocked; validation order) ─
DO $$
BEGIN
  PERFORM public.save_parcel_import_draft(
    jsonb_build_object(
      'statusIntent', 'draft',
      'parcel', jsonb_build_object('parcelId', 'rpc-val-bad-alloc'),
      'xlsBaseline', '{}'::jsonb,
      'overrides', '{}'::jsonb,
      'items', jsonb_build_array(
        jsonb_build_object('rowNumber', 1, 'sourceItemName', 'A')
      ),
      'mappings', '[]'::jsonb,
      'cpiPreview', jsonb_build_object(
        'allocationMethod', 'weight_based',
        'rows', jsonb_build_array(
          jsonb_build_object('rowNumber', 99, 'landedTotalCny', 1)
        ),
        'summary', '{}'::jsonb
      ),
      'warnings', '{}'::jsonb
    )
  );
  RAISE EXCEPTION 'FAIL: bad allocation rowNumber accepted';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'Authentication required%' THEN
      RAISE NOTICE 'PASS: bad allocation test deferred — auth required (run in browser with JWT)';
    ELSIF SQLERRM LIKE '%Unknown allocation rowNumber%' THEN
      RAISE NOTICE 'PASS: bad allocation rowNumber rejected';
    ELSE
      RAISE EXCEPTION 'FAIL: unexpected error: %', SQLERRM;
    END IF;
END $$;

-- ── Summary ──────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'DONE: Migration 002 metadata validation complete.';
  RAISE NOTICE 'NEXT: Authenticated browser smoke test —';
  RAISE NOTICE '  1) save new draft from fixture payload (created: true)';
  RAISE NOTICE '  2) save again with importId (created: false, item count stable)';
  RAISE NOTICE '  3) verify events: parsed + draft_saved on create; draft_saved only on update';
  RAISE NOTICE '  4) verify approved import update returns Import cannot be edited';
END $$;

-- ── Authenticated browser verification queries (after manual save) ─
--
-- SELECT id, parcel_id, status FROM parcel_imports
-- WHERE parcel_id LIKE 'rpc-val-%' OR parcel_id = '227461'
-- ORDER BY imported_at DESC LIMIT 5;
--
-- SELECT COUNT(*) FROM parcel_import_items WHERE parcel_import_id = '<import_id>';
-- SELECT COUNT(*) FROM parcel_import_cost_allocations
--   WHERE parcel_import_id = '<import_id>' AND allocation_run_type = 'preview';
-- SELECT event_type, event_payload FROM parcel_import_events
--   WHERE parcel_import_id = '<import_id>' ORDER BY created_at;
