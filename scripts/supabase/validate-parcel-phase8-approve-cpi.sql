-- Parcel Imports Phase 8 — approve_parcel_import_cpi validation
-- Run: npx supabase db query --linked -f scripts/supabase/validate-parcel-phase8-approve-cpi.sql
--
-- Functional approval requires auth.uid(); run browser/script test separately.

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
  WHERE n.nspname = 'public' AND p.proname = 'approve_parcel_import_cpi'
  LIMIT 1;

  IF NOT coalesce(v_found, false) THEN
    RAISE EXCEPTION 'FAIL: approve_parcel_import_cpi function not found';
  END IF;

  IF NOT v_invoker THEN
    RAISE EXCEPTION 'FAIL: approve_parcel_import_cpi is SECURITY DEFINER (expected INVOKER)';
  END IF;

  RAISE NOTICE 'PASS: approve_parcel_import_cpi exists with SECURITY INVOKER';
END $$;

-- ── 2. Grants: authenticated yes, anon no ────────────────────────
DO $$
DECLARE
  v_auth boolean;
  v_anon boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'approve_parcel_import_cpi'
      AND grantee = 'authenticated'
      AND privilege_type = 'EXECUTE'
  ) INTO v_auth;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'approve_parcel_import_cpi'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ) INTO v_anon;

  IF NOT v_auth THEN
    RAISE EXCEPTION 'FAIL: authenticated missing EXECUTE on approve_parcel_import_cpi';
  END IF;

  IF v_anon THEN
    RAISE EXCEPTION 'FAIL: anon should not have EXECUTE on approve_parcel_import_cpi';
  END IF;

  RAISE NOTICE 'PASS: grants — authenticated EXECUTE yes, anon EXECUTE no';
END $$;

-- ── 3. Auth gate (no JWT in SQL editor) ──────────────────────────
DO $$
BEGIN
  PERFORM public.approve_parcel_import_cpi(gen_random_uuid());
  RAISE EXCEPTION 'FAIL: RPC call unexpectedly succeeded without auth';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM ILIKE '%authentication required%' THEN
      RAISE NOTICE 'PASS: auth gate rejects null auth.uid()';
    ELSE
      RAISE EXCEPTION 'FAIL: unexpected error on auth gate test: %', SQLERRM;
    END IF;
END $$;

-- ── 4. Forbidden writes grep (migration file only) ───────────────
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'approve_parcel_import_cpi'
  LIMIT 1;

  IF v_body ILIKE '%INSERT INTO stock_ledger%' THEN
    RAISE EXCEPTION 'FAIL: RPC references stock_ledger insert';
  END IF;

  IF v_body ILIKE '%INSERT INTO expenses%' THEN
    RAISE EXCEPTION 'FAIL: RPC references expenses insert';
  END IF;

  IF v_body ILIKE '%inventory_receipt%' THEN
    RAISE EXCEPTION 'FAIL: RPC references inventory_receipt';
  END IF;

  IF v_body ~* 'UPDATE\s+public\.product_variants[\s\S]*\bSET\s+stock\s*=' THEN
    RAISE EXCEPTION 'FAIL: RPC updates product_variants.stock';
  END IF;

  IF v_body NOT ILIKE '%unit_cost_override_cents%' THEN
    RAISE EXCEPTION 'FAIL: RPC missing variant cost update';
  END IF;

  RAISE NOTICE 'PASS: forbidden-write grep — no stock/expense/inventory; cost updates present';
END $$;

-- ── 5. Idempotent approved fixture (deferred functional) ─────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.parcel_imports (parcel_id, status, approved_at, approved_by)
  VALUES ('phase8-val-approved', 'approved', now(), NULL)
  RETURNING id INTO v_id;

  BEGIN
    PERFORM public.approve_parcel_import_cpi(v_id);
    RAISE EXCEPTION 'FAIL: approved import RPC succeeded without auth';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM ILIKE '%authentication required%' THEN
        RAISE NOTICE 'PASS: approved idempotency test deferred — auth required (import % created for browser test)', v_id;
      ELSE
        RAISE EXCEPTION 'FAIL: unexpected error: %', SQLERRM;
      END IF;
  END;

  DELETE FROM public.parcel_imports WHERE id = v_id;
  RAISE NOTICE 'PASS: approved fixture cleaned up';
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Phase 8 SQL validation complete. Run scripts/verify-parcel-phase8-approve-cpi.mjs for functional test.';
END $$;
