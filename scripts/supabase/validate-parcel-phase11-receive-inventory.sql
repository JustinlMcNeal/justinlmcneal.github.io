-- Parcel Imports Phase 11 — receive_parcel_import_inventory validation
-- Run: npx supabase db query --linked -f scripts/supabase/validate-parcel-phase11-receive-inventory.sql

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
  WHERE n.nspname = 'public' AND p.proname = 'receive_parcel_import_inventory'
  LIMIT 1;

  IF NOT coalesce(v_found, false) THEN
    RAISE EXCEPTION 'FAIL: receive_parcel_import_inventory function not found';
  END IF;

  IF NOT v_invoker THEN
    RAISE EXCEPTION 'FAIL: receive_parcel_import_inventory is SECURITY DEFINER (expected INVOKER)';
  END IF;

  RAISE NOTICE 'PASS: receive_parcel_import_inventory exists with SECURITY INVOKER';
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
      AND routine_name = 'receive_parcel_import_inventory'
      AND grantee = 'authenticated'
      AND privilege_type = 'EXECUTE'
  ) INTO v_auth;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'receive_parcel_import_inventory'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ) INTO v_anon;

  IF NOT v_auth THEN
    RAISE EXCEPTION 'FAIL: authenticated missing EXECUTE on receive_parcel_import_inventory';
  END IF;

  IF v_anon THEN
    RAISE EXCEPTION 'FAIL: anon should not have EXECUTE on receive_parcel_import_inventory';
  END IF;

  RAISE NOTICE 'PASS: grants — authenticated EXECUTE yes, anon EXECUTE no';
END $$;

-- ── 3. Auth gate ─────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM public.receive_parcel_import_inventory(gen_random_uuid());
  RAISE EXCEPTION 'FAIL: RPC call unexpectedly succeeded without auth';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM ILIKE '%authentication required%' THEN
      RAISE NOTICE 'PASS: auth gate rejects null auth.uid()';
    ELSE
      RAISE EXCEPTION 'FAIL: unexpected error on auth gate test: %', SQLERRM;
    END IF;
END $$;

-- ── 4. New columns exist ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parcel_imports'
      AND column_name = 'inventory_received_at'
  ) THEN
    RAISE EXCEPTION 'FAIL: parcel_imports.inventory_received_at missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parcel_imports'
      AND column_name = 'inventory_received_by'
  ) THEN
    RAISE EXCEPTION 'FAIL: parcel_imports.inventory_received_by missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'parcel_imports'
      AND column_name = 'inventory_receive_idempotency_key'
  ) THEN
    RAISE EXCEPTION 'FAIL: parcel_imports.inventory_receive_idempotency_key missing';
  END IF;

  RAISE NOTICE 'PASS: inventory_received_* columns exist';
END $$;

-- ── 5. Forbidden writes grep (RPC body) ──────────────────────────
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'receive_parcel_import_inventory'
  LIMIT 1;

  IF v_body ILIKE '%INSERT INTO expenses%' OR v_body ILIKE '%INSERT INTO public.expenses%' THEN
    RAISE EXCEPTION 'FAIL: RPC references expenses insert';
  END IF;

  IF v_body ILIKE '%inventory_receipt%' THEN
    RAISE EXCEPTION 'FAIL: RPC references inventory_receipt';
  END IF;

  IF v_body ILIKE '%unit_cost_override_cents%' THEN
    RAISE EXCEPTION 'FAIL: RPC references unit_cost_override_cents';
  END IF;

  IF v_body ~* 'UPDATE\s+public\.products[\s\S]*\bunit_cost\b' THEN
    RAISE EXCEPTION 'FAIL: RPC updates products.unit_cost';
  END IF;

  IF v_body NOT ILIKE '%INSERT INTO%stock_ledger%' THEN
    RAISE EXCEPTION 'FAIL: RPC missing stock_ledger insert';
  END IF;

  IF v_body NOT ILIKE '%parcel_receive%' THEN
    RAISE EXCEPTION 'FAIL: RPC missing parcel_receive reason';
  END IF;

  IF v_body NOT ILIKE '%SET stock =%' THEN
    RAISE EXCEPTION 'FAIL: RPC missing product_variants.stock update';
  END IF;

  RAISE NOTICE 'PASS: receive RPC body — stock+ledger only; no expense/cost writes';
END $$;

-- ── 6. Approve RPC still has no stock writes ─────────────────────
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
    RAISE EXCEPTION 'FAIL: approve RPC unexpectedly references stock_ledger';
  END IF;

  IF v_body ILIKE '%SET stock =%' THEN
    RAISE EXCEPTION 'FAIL: approve RPC unexpectedly updates product_variants.stock';
  END IF;

  RAISE NOTICE 'PASS: approve_parcel_import_cpi still has no stock writes';
END $$;

SELECT 'Phase 11 receive inventory validation complete' AS result;
